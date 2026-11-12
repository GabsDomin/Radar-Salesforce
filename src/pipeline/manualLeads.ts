// Leads cadastrados à mão: indicação, ex-cliente, evento, contato próprio.
// Viram um sinal de "relacionamento" (vale como gatilho forte na nota) e entram direto como aprovados para triagem.
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import { upsertCompany, exclusionFor } from './companies.ts';
import { addEvent } from './decisions.ts';

export const MANUAL_ORIGINS: { id: string; label: string }[] = [
  { id: 'indicacao', label: 'Indicação' },
  { id: 'ex_cliente', label: 'Ex-cliente' },
  { id: 'evento', label: 'Evento (patrocinador, palestrante, conversa)' },
  { id: 'contato', label: 'Contato próprio' },
  { id: 'outro', label: 'Outro' },
];

export interface ManualLead { name: string; origin: string; detail?: string; domain?: string }

export function addManualLead(db: DB, lead: ManualLead): { ok: boolean; id?: number; error?: string } {
  const name = lead.name?.trim();
  if (!name || name.length < 2) return { ok: false, error: 'informe o nome da empresa' };
  const origin = MANUAL_ORIGINS.find((o) => o.id === lead.origin) ?? MANUAL_ORIGINS[MANUAL_ORIGINS.length - 1];
  const excluded = exclusionFor(db, name);
  if (excluded) return { ok: false, error: `${name} está na lista de exclusão (${excluded})` };
  const domain = lead.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
  const detail = lead.detail?.trim() || null;
  return tx(db, () => {
    const id = upsertCompany(db, name, 'manual');
    if (domain) db.prepare('UPDATE companies SET domain = COALESCE(domain, ?) WHERE id = ?').run(domain, id);
    db.prepare(`INSERT INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw, published_at, meta)
      VALUES (?, 'gatilho', 'relacionamento', ?, ?, ?, 'manual', ?, ?, datetime('now'), ?)`)
      .run(id, `${origin.label}${detail ? `: ${detail}` : ''}`, detail, domain ? `https://${domain}` : '',
        `${id}:${origin.id}:${Date.now()}`, name, JSON.stringify({ origin: origin.id }));
    addEvent(db, id, 'cadastrada', `${origin.label}${detail ? ` — ${detail}` : ''}`);
    return { ok: true, id };
  });
}
