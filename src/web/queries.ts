// Consultas do painel (lista filtrada, detalhe, exportação).
import type { DB } from '../db/index.ts';
import type { BreakdownItem, OfferSuggestion } from '../scoring/score.ts';

export interface Filters {
  q?: string;
  setor?: string;
  oferta?: string;
  sinal?: string;
  status?: string;
  excluidas?: string; // '1' mostra excluídas
  min?: string;
  visao?: string;     // triagem | aprovadas | adiadas | descartadas | tudo (padrão: tudo menos descartadas)
}

export interface CompanyRow {
  id: number;
  name: string;
  sector: string | null;
  sector_source: string | null;
  size_band: string | null;
  city: string | null;
  state: string | null;
  status: string;
  stage: string;
  excluded_reason: string | null;
  total: number | null;
  fit: number | null;
  signal: number | null;
  offers: string | null;
  breakdown: string | null;
  computed_at: string | null;
  signal_types: string | null;
  job_count: number;
  review_count: number;
  last_signal_at: string | null;
  discard_reason: string | null;
  snoozed_until: string | null;
  prev_total: number | null;
  new_signals: number;  // sinais coletados nos últimos 7 dias
  outreach: string | null;
  outreach_at: string | null;
}

export function listCompanies(db: DB, f: Filters): CompanyRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.excluidas !== '1') where.push('c.excluded_reason IS NULL');
  if (f.q) { where.push('c.name LIKE ?'); params.push(`%${f.q}%`); }
  if (f.setor) {
    if (f.setor === 'desconhecido') where.push('c.sector IS NULL');
    else { where.push('c.sector = ?'); params.push(f.setor); }
  }
  if (f.status) { where.push('c.status = ?'); params.push(f.status); }
  const visao = VISOES[f.visao as Visao] ?? (f.status ? null : VISOES.padrao);
  if (visao) where.push(visao);
  if (f.oferta) { where.push('s.offers LIKE ?'); params.push(`%"offer":"${f.oferta}"%`); }
  if (f.sinal) { where.push('EXISTS (SELECT 1 FROM signals x WHERE x.company_id = c.id AND x.type = ?)'); params.push(f.sinal); }
  if (f.min) { where.push('COALESCE(s.total, 0) >= ?'); params.push(Number(f.min) || 0); }

  return db.prepare(`
    SELECT c.id, c.name, c.sector, c.sector_source, c.size_band, c.city, c.state, c.status, c.stage, c.excluded_reason,
           c.discard_reason, c.snoozed_until, c.outreach, c.outreach_at, s.prev_total,
           (SELECT count(*) FROM signals x WHERE x.company_id = c.id AND x.collected_at >= datetime('now', '-7 days')) AS new_signals,
           s.total, s.fit, s.signal, s.offers, s.breakdown, s.computed_at,
           (SELECT group_concat(DISTINCT type) FROM signals x WHERE x.company_id = c.id) AS signal_types,
           (SELECT count(*) FROM signals x WHERE x.company_id = c.id AND x.type = 'vaga') AS job_count,
           (SELECT count(*) FROM signals x WHERE x.company_id = c.id AND x.review_flag IS NOT NULL) AS review_count,
           (SELECT max(COALESCE(published_at, collected_at)) FROM signals x WHERE x.company_id = c.id) AS last_signal_at
    FROM companies c LEFT JOIN scores s ON s.company_id = c.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(s.total, -1) DESC, c.name
  `).all(...params) as unknown as CompanyRow[];
}

// Situação da conta no fluxo de trabalho.
export type Visao = 'triagem' | 'aprovadas' | 'adiadas' | 'descartadas' | 'tudo' | 'padrao';
const SNOOZED = "c.snoozed_until IS NOT NULL AND c.snoozed_until > date('now')";
const VISOES: Record<Visao, string | null> = {
  triagem: `c.status IN ('novo', 'em_analise') AND NOT (${SNOOZED})`,
  aprovadas: "c.status IN ('qualificado', 'em_abordagem')",
  adiadas: `c.status <> 'descartado' AND ${SNOOZED}`,
  descartadas: "c.status = 'descartado'",
  tudo: null,
  padrao: "c.status <> 'descartado'",
};

export const VISAO_LABEL: [Visao, string][] = [
  ['padrao', 'Todas'], ['triagem', 'A triar'], ['aprovadas', 'Aprovadas'], ['adiadas', 'Adiadas'], ['descartadas', 'Descartadas'],
];

// Em quais abas de situação uma conta aparece (mesmas regras de VISOES, para usar no navegador).
export function visoesOf(r: { status: string; snoozed_until: string | null }, today = new Date().toISOString().slice(0, 10)): Visao[] {
  const snoozed = !!r.snoozed_until && r.snoozed_until > today;
  const out: Visao[] = [];
  if (r.status !== 'descartado') out.push('padrao');
  if ((r.status === 'novo' || r.status === 'em_analise') && !snoozed) out.push('triagem');
  if (r.status === 'qualificado' || r.status === 'em_abordagem') out.push('aprovadas');
  if (r.status !== 'descartado' && snoozed) out.push('adiadas');
  if (r.status === 'descartado') out.push('descartadas');
  return out;
}

export function visaoCounts(db: DB): Record<Visao, number> {
  const out = {} as Record<Visao, number>;
  for (const [v] of VISAO_LABEL) {
    const cond = VISOES[v];
    out[v] = (db.prepare(`SELECT count(*) n FROM companies c WHERE c.excluded_reason IS NULL${cond ? ' AND ' + cond : ''}`).get() as { n: number }).n;
  }
  return out;
}

export interface SignalRow {
  id: number;
  type: string;
  subtype: string | null;
  title: string;
  evidence: string | null;
  url: string;
  source: string;
  published_at: string | null;
  collected_at: string;
  last_seen_at: string;
  meta: string | null;
  review_flag: string | null;
}

export function getCompany(db: DB, id: number) {
  const company = db.prepare(`
    SELECT c.*, s.total, s.fit, s.signal, s.offers, s.breakdown, s.rules_version, s.computed_at
    FROM companies c LEFT JOIN scores s ON s.company_id = c.id WHERE c.id = ?`).get(id) as
    | (CompanyRow & { notes: string | null; next_action: string | null; next_action_at: string | null; rules_version: string | null; domain: string | null; cnpj: string | null })
    | undefined;
  if (!company) return null;
  const signals = db.prepare(
    'SELECT * FROM signals WHERE company_id = ? ORDER BY COALESCE(published_at, collected_at) DESC',
  ).all(id) as unknown as SignalRow[];
  const aliases = (db.prepare('SELECT alias, source FROM company_aliases WHERE company_id = ?').all(id) as { alias: string; source: string }[]);
  const contacts = db.prepare("SELECT id, name, role, since, channel, origin FROM contacts WHERE company_id = ? AND opt_out = 0 ORDER BY (origin = 'manual') DESC, since DESC")
    .all(id) as { id: number; name: string; role: string | null; since: string | null; channel: string | null; origin: string }[];
  const events = db.prepare('SELECT kind, detail, created_at FROM account_events WHERE company_id = ? ORDER BY id DESC LIMIT 50')
    .all(id) as { kind: string; detail: string | null; created_at: string }[];
  return {
    company,
    signals,
    aliases,
    events,
    contacts,
    breakdown: (company.breakdown ? JSON.parse(company.breakdown) : []) as BreakdownItem[],
    offers: (company.offers ? JSON.parse(company.offers) : []) as OfferSuggestion[],
  };
}

export const STATUSES = ['novo', 'em_analise', 'qualificado', 'em_abordagem', 'descartado'] as const;
export const STAGES = ['radar', 'aprovada', 'abordagem', 'respondeu', 'reuniao', 'proposta', 'ganha', 'perdida'] as const;

export function updateCompany(
  db: DB, id: number,
  data: { status?: string; stage?: string; notes?: string; next_action?: string; next_action_at?: string; excluded_reason?: string },
) {
  const status = STATUSES.includes(data.status as never) ? data.status! : null;
  const stage = STAGES.includes(data.stage as never) ? data.stage! : null;
  const excluded = ['cliente', 'concorrente', 'recrutadora'].includes(data.excluded_reason ?? '') ? data.excluded_reason! : null;
  const before = db.prepare('SELECT stage, status FROM companies WHERE id = ?').get(id) as { stage: string; status: string } | undefined;
  if (before && stage && stage !== before.stage) {
    db.prepare('INSERT INTO account_events (company_id, kind, detail) VALUES (?, ?, ?)').run(id, 'etapa', `${before.stage} → ${stage}`);
  }
  db.prepare(`
    UPDATE companies SET status = COALESCE(?, status), stage = COALESCE(?, stage), notes = ?, next_action = ?,
      next_action_at = ?, excluded_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, stage, data.notes ?? null, data.next_action || null, data.next_action_at || null, excluded, id);
}

export function lastRuns(db: DB) {
  return db.prepare('SELECT * FROM collection_runs ORDER BY id DESC LIMIT 5').all() as {
    id: number; collector: string; started_at: string; finished_at: string | null; stats: string | null; error: string | null;
  }[];
}
