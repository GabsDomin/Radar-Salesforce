// Modalidades do radar: cada uma é uma "forma de achar cliente" com a sua própria tela.
//   vagas      vagas Salesforce no Brasil (sem consultorias)
//   lideranca  troca de diretor/executivo, vista nas notícias
//   gatilhos   fusão, investimento, expansão (e outros gatilhos)
//   dor        indício de insatisfação com o sistema atual, lido nas vagas
import type { DB } from '../db/index.ts';
import { countryName } from '../normalize/location.ts';
import { readableEvidence } from '../tech/explain.ts';
import { tidyStoredSnippet } from '../util/excerpt.ts';
import { SOURCE_LABEL } from './sourceLabels.ts';
export { SOURCE_LABEL };

export type ModalityId = 'vagas' | 'lideranca' | 'gatilhos' | 'dor' | 'concorrente' | 'tecnologia';

export interface ModalityInfo {
  id: ModalityId;
  label: string;
  title: string;
  description: string;
  collector: 'vagas' | 'noticias' | 'tecnologia';  // qual coleta alimenta esta modalidade
  empty: string;
  facets: { key: string; label: string }[];  // filtros próprios da aba (montados a partir dos itens)
}

export const MODALITIES: ModalityInfo[] = [
  {
    id: 'vagas', label: 'Vagas', title: 'Vagas', collector: 'vagas',
    description: 'Empresas contratando para Salesforce ou CRM. Sem consultorias.',
    empty: 'Nenhuma vaga com esses filtros.',
    facets: [{ key: 'tipo', label: 'Tipo de vaga' }, { key: 'dor', label: 'Insatisfação' }, { key: 'crm', label: 'CRM' }, { key: 'cargo', label: 'Cargo' }, { key: 'pais', label: 'País' }, { key: 'fonte', label: 'Fonte' }],
  },
  {
    id: 'lideranca', label: 'Liderança', title: 'Mudança de liderança', collector: 'noticias',
    description: 'Diretor novo costuma rever as ferramentas no primeiro ano.',
    empty: 'Nenhuma troca de liderança encontrada ainda.',
    facets: [{ key: 'area', label: 'Área' }],
  },
  {
    id: 'gatilhos', label: 'Outros gatilhos', title: 'Fusões, investimentos e expansão', collector: 'noticias',
    description: 'Momentos em que a empresa costuma rever o CRM.',
    empty: 'Nenhum gatilho encontrado ainda.',
    facets: [{ key: 'tipo', label: 'Tipo' }, { key: 'fonte', label: 'Fonte' }],
  },
  {
    id: 'concorrente', label: 'CRM concorrente', title: 'Usam outro CRM', collector: 'vagas',
    description: 'Usam HubSpot, RD Station, Dynamics e outros: podem migrar para Salesforce.',
    empty: 'Nenhuma empresa com outro CRM ainda.',
    facets: [{ key: 'crm', label: 'CRM' }, { key: 'onde', label: 'Onde foi visto' }, { key: 'fonte', label: 'Fonte' }],
  },
  {
    id: 'tecnologia', label: 'Tecnologia', title: 'Tecnologia', collector: 'tecnologia',
    description: 'Ferramentas encontradas no site e no e-mail da empresa.',
    empty: 'Nenhuma tecnologia encontrada ainda.',
    facets: [{ key: 'fornecedor', label: 'Fornecedor' }, { key: 'tipo', label: 'Salesforce ou concorrente' }, { key: 'meio', label: 'Como foi detectado' }],
  },
];

export interface ModalityFilters { q?: string; min?: string; dias?: string }

export interface ModalityRow {
  signalId: number;
  companyId: number;
  company: string;
  total: number | null;
  title: string;
  detail: string;       // evidência ou trecho que comprova
  url: string;
  source: string;
  date: string | null;  // publicação, ou coleta quando a fonte não informa
  tags: string[];
  reviewFlag: string | null;
  facets: Record<string, string[]>;  // valores de cada filtro da aba para este item
}

interface RawRow {
  id: number; company_id: number; company: string; total: number | null; type: string; subtype: string | null;
  title: string; evidence: string | null; url: string; source: string; published_at: string | null;
  collected_at: string; meta: string | null; review_flag: string | null;
}

const WHERE: Record<ModalityId, string> = {
  vagas: "x.type = 'vaga'",
  concorrente: `((x.type = 'vaga' AND COALESCE(json_array_length(json_extract(x.meta, '$.crms')), 0) > 0)
    OR (x.type = 'tecnologia' AND json_extract(x.meta, '$.vendorKind') = 'concorrente'))`,
  tecnologia: "x.type = 'tecnologia'",
  lideranca: "x.type = 'gatilho' AND x.subtype = 'lideranca'",
  gatilhos: "x.type = 'gatilho' AND COALESCE(x.subtype, '') <> 'lideranca'",
  dor: "x.type = 'vaga' AND x.meta LIKE '%\"pain\":[{%'",
};

export function modalityRows(db: DB, id: ModalityId, f: ModalityFilters = {}): ModalityRow[] {
  const where = [WHERE[id], 'c.excluded_reason IS NULL'];
  const params: (string | number)[] = [];
  if (f.q) { where.push('c.name LIKE ?'); params.push(`%${f.q}%`); }
  if (f.min) { where.push('COALESCE(s.total, 0) >= ?'); params.push(Number(f.min) || 0); }
  if (f.dias && Number(f.dias) > 0) {
    where.push("COALESCE(x.published_at, x.collected_at) >= datetime('now', ?)");
    params.push(`-${Math.floor(Number(f.dias))} days`);
  }
  const raw = db.prepare(`
    SELECT x.id, x.company_id, c.name AS company, s.total, x.type, x.subtype, x.title, x.evidence, x.url, x.source,
           x.published_at, x.collected_at, x.meta, x.review_flag
    FROM signals x JOIN companies c ON c.id = x.company_id LEFT JOIN scores s ON s.company_id = c.id
    WHERE ${where.join(' AND ')}
    ORDER BY ${id === 'vagas' || id === 'dor' ? 'COALESCE(s.total, 0) DESC, ' : ''}COALESCE(x.published_at, x.collected_at) DESC, x.id DESC
  `).all(...params) as unknown as RawRow[];
  return raw.map((r) => toRow(id, r));
}

function toRow(id: ModalityId, r: RawRow): ModalityRow {
  const meta = r.meta ? JSON.parse(r.meta) : {};
  const tags: string[] = [];
  let detail = readableEvidence(r);
  if (id === 'vagas') {
    // Só o que informa: cargo conhecido e até 3 clouds citadas ("outro" e "não especificada" não dizem nada).
    if (r.subtype && r.subtype !== 'outro') tags.push(r.subtype);
    const clouds = ((meta.clouds ?? []) as string[]).filter((c) => !c.includes('não especificada'));
    tags.push(...clouds.slice(0, 3), ...(clouds.length > 3 ? [`+${clouds.length - 3}`] : []));
    if (((meta.crms ?? []) as string[]).length && meta.salesforce === false) tags.push(...(meta.crms as string[]));
  } else if (id === 'lideranca') {
    if (meta.area) tags.push(`área: ${meta.area}`);
    if (meta.mentionsSalesforce) tags.push('cita Salesforce');
  } else if (id === 'gatilhos') {
    if (r.subtype) tags.push(r.subtype);
  } else if (id === 'concorrente' || id === 'tecnologia') {
    for (const c of (meta.crms ?? []) as string[]) tags.push(c);
    if (meta.vendor) tags.push(meta.vendor);
    if (meta.how) tags.push(meta.how);
    if (meta.opsRole) tags.push('operação comercial');
  } else {
    const pain = (meta.pain ?? []) as { label: string; evidence: string }[];
    for (const p of pain) tags.push(p.label);
    detail = pain.map((p) => tidyStoredSnippet(p.evidence)).join(' | ');
  }
  return {
    signalId: r.id, companyId: r.company_id, company: r.company, total: r.total,
    title: r.title.replace(/^(Troca de liderança|Fusão\/aquisição|Investimento|Expansão): /, ''),
    detail, url: r.url, source: r.source, date: r.published_at ?? r.collected_at, tags, reviewFlag: r.review_flag,
    facets: facetsOf(id, r, meta),
  };
}

const CARGO_LABEL: Record<string, string> = {
  arquiteto: 'Arquiteto', tech_lead: 'Tech Lead', developer: 'Developer', admin: 'Admin', funcional: 'Funcional/Consultor',
  qa: 'QA', usuario_crm: 'Usuário de CRM', outro: 'Outro',
};
const KIND_LABEL: Record<string, string> = {
  fusao: 'Fusão/aquisição', investimento: 'Investimento', expansao: 'Expansão', relacionamento: 'Relacionamento (manual)',
};

function facetsOf(id: ModalityId, r: RawRow, meta: Record<string, unknown>): Record<string, string[]> {
  const crms = (meta.crms as string[] | undefined) ?? [];
  const fonte = [SOURCE_LABEL[r.source] ?? r.source];
  switch (id) {
    case 'vagas': {
      // Vaga antiga sem o campo "salesforce" era sempre de Salesforce.
      const tipo = [...(meta.salesforce !== false ? ['Vaga Salesforce'] : []), ...(crms.length ? ['Vaga de CRM concorrente'] : [])];
      const dor = ((meta.pain as unknown[] | undefined) ?? []).length ? ['Com indício de dor'] : [];
      return { tipo, dor, crm: crms, cargo: [CARGO_LABEL[r.subtype ?? ''] ?? 'Outro'], pais: [countryName((meta.country as string) ?? 'BR')], fonte };
    }
    case 'lideranca': return { area: [meta.area === 'tecnologia' ? 'Tecnologia' : meta.area === 'comercial' ? 'Comercial' : 'Outra'] };
    case 'gatilhos': return { tipo: [KIND_LABEL[r.subtype ?? ''] ?? 'Outro'], fonte };
    case 'dor': return { dor: ((meta.pain as { label: string }[] | undefined) ?? []).map((p) => p.label), fonte };
    case 'concorrente': return { crm: r.type === 'tecnologia' ? [String(meta.vendor)] : crms, onde: [r.type === 'tecnologia' ? 'Site/DNS' : 'Vaga'], fonte };
    case 'tecnologia': return {
      fornecedor: [String(meta.vendor ?? r.title)],
      tipo: [meta.vendorKind === 'concorrente' ? 'CRM concorrente' : 'Salesforce'],
      meio: [String(meta.how ?? (SOURCE_LABEL[r.source] ?? r.source))],
    };
  }
}

export function modalityCounts(db: DB): Record<ModalityId, { total: number; companies: number; recent: number }> {
  const out = {} as Record<ModalityId, { total: number; companies: number; recent: number }>;
  for (const m of MODALITIES) {
    const r = db.prepare(`
      SELECT count(*) AS total, count(DISTINCT x.company_id) AS companies,
             sum(CASE WHEN COALESCE(x.published_at, x.collected_at) >= datetime('now', '-30 days') THEN 1 ELSE 0 END) AS recent
      FROM signals x JOIN companies c ON c.id = x.company_id
      WHERE ${WHERE[m.id]} AND c.excluded_reason IS NULL`).get() as { total: number; companies: number; recent: number | null };
    out[m.id] = { total: r.total, companies: r.companies, recent: r.recent ?? 0 };
  }
  return out;
}

// Última execução da coleta que alimenta a modalidade.
export function lastRunOf(db: DB, collector: string): { finished_at: string | null; error: string | null } | null {
  return (db.prepare('SELECT finished_at, error FROM collection_runs WHERE collector = ? ORDER BY id DESC LIMIT 1')
    .get(collector) as { finished_at: string | null; error: string | null } | undefined) ?? null;
}

// Leads por aba (para esconder abas vazias).
export function tabCounts(db: DB): Record<string, number> {
  return Object.fromEntries(Object.entries(modalityCounts(db)).map(([k, v]) => [k, v.companies]));
}
