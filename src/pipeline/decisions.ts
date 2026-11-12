// Decisões sobre uma conta: aprovar, descartar (com motivo), adiar e reabrir.
// Toda decisão vira um evento no histórico da conta.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import { normalizeCompanyName } from '../normalize/company.ts';
import { exclusionFor } from './companies.ts';

export type DecisionAction = 'aprovar' | 'descartar' | 'adiar' | 'reabrir';

// `exclui` = o motivo tira a empresa do radar de vez (já é cliente / é concorrente).
export const DISCARD_REASONS: { id: string; label: string; exclui?: 'cliente' | 'concorrente' }[] = [
  { id: 'fora_do_perfil', label: 'Fora do perfil (setor ou porte)' },
  { id: 'ja_e_cliente', label: 'Já é cliente da Sottelli', exclui: 'cliente' },
  { id: 'concorrente_ou_consultoria', label: 'Concorrente ou consultoria', exclui: 'concorrente' },
  { id: 'ja_atendido_por_parceiro', label: 'Já atendida por outro parceiro' },
  { id: 'sem_orcamento_ou_timing', label: 'Sem orçamento ou fora de timing' },
  { id: 'dado_incorreto', label: 'Dado incorreto (empresa ou vaga errada)' },
  { id: 'outro', label: 'Outro motivo' },
];

export const DISCARD_LABEL: Record<string, string> = Object.fromEntries(DISCARD_REASONS.map((r) => [r.id, r.label]));

export interface Decision {
  action: DecisionAction;
  reason?: string;   // descartar
  note?: string;     // observação livre, vai para o histórico
  until?: string;    // adiar: AAAA-MM-DD
}

export interface DecisionResult { ok: boolean; error?: string; status?: string; stage?: string; snoozedUntil?: string | null }

const ORIGIN = 'decisão no painel';
const DEFAULT_SNOOZE_DAYS = 14;

export function addEvent(db: DB, companyId: number, kind: string, detail: string | null) {
  db.prepare('INSERT INTO account_events (company_id, kind, detail) VALUES (?, ?, ?)').run(companyId, kind, detail);
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function decide(db: DB, companyId: number, d: Decision, now = new Date()): DecisionResult {
  const company = db.prepare('SELECT id, name, stage FROM companies WHERE id = ?').get(companyId) as
    | { id: number; name: string; stage: string } | undefined;
  if (!company) return { ok: false, error: 'conta não encontrada' };
  const note = d.note?.trim() || null;

  return tx(db, (): DecisionResult => {
    switch (d.action) {
      case 'aprovar': {
        // Só avança a etapa se ainda estava no radar; não desfaz uma etapa mais adiante do funil.
        const stage = company.stage === 'radar' ? 'aprovada' : company.stage;
        db.prepare(`UPDATE companies SET status = 'qualificado', stage = ?, discard_reason = NULL, snoozed_until = NULL,
                    decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(stage, companyId);
        addEvent(db, companyId, 'aprovada', note);
        return { ok: true, status: 'qualificado', stage, snoozedUntil: null };
      }
      case 'descartar': {
        const reason = DISCARD_REASONS.find((r) => r.id === d.reason) ?? DISCARD_REASONS[DISCARD_REASONS.length - 1];
        db.prepare(`UPDATE companies SET status = 'descartado', discard_reason = ?, snoozed_until = NULL,
                    decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(reason.id, companyId);
        if (reason.exclui) {
          // Também entra na lista de exclusão, para valer em coletas futuras e importações de CSV.
          db.prepare('INSERT OR IGNORE INTO exclusions (kind, name, normalized_name, origin) VALUES (?, ?, ?, ?)')
            .run(reason.exclui, company.name, normalizeCompanyName(company.name), ORIGIN);
          db.prepare('UPDATE companies SET excluded_reason = ? WHERE id = ?').run(reason.exclui, companyId);
        }
        addEvent(db, companyId, 'descartada', [reason.label, note].filter(Boolean).join(' — '));
        return { ok: true, status: 'descartado', stage: company.stage, snoozedUntil: null };
      }
      case 'adiar': {
        const until = d.until && /^\d{4}-\d{2}-\d{2}$/.test(d.until)
          ? d.until
          : isoDate(new Date(now.getTime() + DEFAULT_SNOOZE_DAYS * 86_400_000));
        db.prepare("UPDATE companies SET snoozed_until = ?, updated_at = datetime('now') WHERE id = ?").run(until, companyId);
        addEvent(db, companyId, 'adiada', [`até ${until}`, note].filter(Boolean).join(' — '));
        return { ok: true, status: undefined, stage: company.stage, snoozedUntil: until };
      }
      case 'reabrir': {
        // Desfaz exclusões criadas por decisão (as vindas de CSV continuam valendo).
        db.prepare('DELETE FROM exclusions WHERE origin = ? AND normalized_name = ?').run(ORIGIN, normalizeCompanyName(company.name));
        db.prepare(`UPDATE companies SET status = 'novo', stage = 'radar', discard_reason = NULL, snoozed_until = NULL,
                    updated_at = datetime('now') WHERE id = ?`).run(companyId);
        // Só esta conta: volta a depender do que sobrou na lista de exclusão (CSV importado).
        db.prepare('UPDATE companies SET excluded_reason = ? WHERE id = ?').run(exclusionFor(db, company.name), companyId);
        addEvent(db, companyId, 'reaberta', note);
        return { ok: true, status: 'novo', stage: 'radar', snoozedUntil: null };
      }
      default:
        return { ok: false, error: 'ação inválida' };
    }
  });
}

export function eventsOf(db: DB, companyId: number) {
  return db.prepare('SELECT id, kind, detail, created_at FROM account_events WHERE company_id = ? ORDER BY id DESC LIMIT 50')
    .all(companyId) as { id: number; kind: string; detail: string | null; created_at: string }[];
}
