// Pontuação 0-100 determinística e explicada. Cada ponto vem de uma regra com motivo e sinais de origem.
// Também sugere qual oferta da Sottelli encaixa: Keep (sustentação), Improve (alocação), Ágil (projeto).
import type { DB } from '../db/index.ts';
import { icp, jobWindows, RULES_VERSION } from '../config.ts';
import { countryName } from '../normalize/location.ts';

export interface BreakdownItem {
  rule: string;
  group: 'aderencia' | 'sinal' | 'dor' | 'ajuste';
  points: number;
  max: number;
  reason: string;
  signalIds: number[];
}

export type Offer = 'Keep' | 'Improve' | 'Ágil';
export interface OfferSuggestion { offer: Offer; reasons: string[] }

export interface ScoreResult {
  total: number;
  fit: number;
  signal: number;
  breakdown: BreakdownItem[];
  offers: OfferSuggestion[];
}

export interface CompanyForScore {
  sector: string | null;
  sector_source: string | null;
  size_band: string | null;
  size_source: string | null;
}

export interface SignalForScore {
  id: number;
  type: string;
  subtype: string | null;
  title: string;
  source: string;
  published_at: string | null;
  collected_at: string;
  meta: string | null;
  review_flag: string | null;
}

interface PainMeta { kind: string; label: string; evidence: string }

interface JobMeta {
  pain?: PainMeta[]; salesforce?: boolean; crms?: string[]; opsRole?: boolean; role?: string; senior?: boolean; clouds?: string[]; projectHints?: string[]; supportHints?: string[]; country?: string;
}

const DAY = 86_400_000;

export function scoreCompany(company: CompanyForScore, signals: SignalForScore[], now = new Date()): ScoreResult {
  const breakdown: BreakdownItem[] = [];
  const jobs = signals.filter((s) => s.type === 'vaga');
  const jobMeta = (s: SignalForScore): JobMeta => (s.meta ? JSON.parse(s.meta) : {});
  const ageDays = (s: SignalForScore) =>
    Math.floor((now.getTime() - new Date(s.published_at ?? s.collected_at).getTime()) / DAY);

  // ---------- Aderência ao perfil (40) ----------
  const inIcp = company.sector !== null && (icp.sectors as readonly string[]).includes(company.sector);
  const sectorInferred = company.sector_source?.startsWith('inferido') ?? true;
  breakdown.push({
    rule: 'Setor-alvo', group: 'aderencia', max: 15, signalIds: [],
    points: inIcp ? (sectorInferred ? 8 : 15) : 0,
    reason: inIcp
      ? `Setor ${label(company.sector!)} (${company.sector_source})${sectorInferred ? ' — inferido, vale metade até confirmar pelo CNAE' : ''}`
      : company.sector
        ? `Setor "${company.sector}" fora do perfil (indústria, financeiro, agro)`
        : 'Setor ainda não identificado',
  });

  const sizeOk = company.size_band === `${icp.minEmployees}+`;
  const sizeInferred = company.size_source?.startsWith('inferido') ?? true;
  breakdown.push({
    rule: `Porte ${icp.minEmployees}+ funcionários`, group: 'aderencia', max: 15, signalIds: [],
    points: sizeOk ? (sizeInferred ? 7 : 15) : 0,
    reason: sizeOk
      ? `Porte ${company.size_band} (${company.size_source})`
      : company.size_band
        ? `Porte ${company.size_band}, abaixo do perfil`
        : 'Porte ainda não verificado (enriquecimento por CNPJ em etapa futura)',
  });

  // Brasil vale cheio (a Sottelli é brasileira); outro país da América Latina vale 6.
  const brJobs = jobs.filter((s) => (jobMeta(s).country ?? 'BR') === 'BR');
  const latamJobs = jobs.filter((s) => (jobMeta(s).country ?? 'BR') !== 'BR');
  const latamNames = [...new Set(latamJobs.map((s) => countryName(jobMeta(s).country)))].join(', ');
  breakdown.push({
    rule: 'Atua no Brasil / América Latina', group: 'aderencia', max: 10,
    points: brJobs.length ? 10 : latamJobs.length ? 6 : 0,
    signalIds: (brJobs.length ? brJobs : latamJobs).slice(0, 3).map((s) => s.id),
    reason: brJobs.length
      ? `${brJobs.length} vaga(s) no Brasil${latamJobs.length ? `; também em ${latamNames}` : ''}`
      : latamJobs.length
        ? `${latamJobs.length} vaga(s) em ${latamNames} (América Latina fora do Brasil vale 6)`
        : 'Sem evidência de operação no Brasil ou na América Latina',
  });

  // ---------- Força do sinal (60) ----------
  // Vagas que só citam CRM concorrente têm regra própria; aqui contam só as de Salesforce.
  const sfJobs = jobs.filter((s) => jobMeta(s).salesforce !== false);
  const sorted = [...sfJobs].sort((a, b) => ageDays(a) - ageDays(b));
  const newest = sorted[0];
  let jobPoints = 0;
  let jobReason = 'Nenhuma vaga Salesforce encontrada';
  if (newest) {
    const age = ageDays(newest);
    jobPoints = age <= jobWindows.freshDays ? 20 : age <= jobWindows.activeDays ? 12 : 5;
    jobReason = `Vaga "${newest.title}" publicada há ${age} dia(s) (${newest.source})`;
    const seniorJobs = sfJobs.filter((s) => {
      const m = jobMeta(s);
      return m.senior || m.role === 'arquiteto' || m.role === 'tech_lead';
    });
    if (sfJobs.length >= 2 || seniorJobs.length) {
      jobPoints += 5;
      jobReason += sfJobs.length >= 2 ? `; +5 por ${sfJobs.length} vagas Salesforce` : '; +5 por vaga sênior/arquitetura';
    }
  }
  breakdown.push({
    rule: 'Vaga Salesforce ativa', group: 'sinal', max: 25, points: Math.min(jobPoints, 25),
    reason: jobReason, signalIds: sorted.slice(0, 5).map((s) => s.id),
  });

  const techSignals = signals.filter((s) => s.type === 'tecnologia' && techMeta(s).vendorKind !== 'concorrente');
  const cloudJobs = sfJobs.filter((s) => (jobMeta(s).clouds ?? []).some((c) => !c.includes('não especificada')));
  const clouds = [...new Set(cloudJobs.flatMap((s) => jobMeta(s).clouds ?? []))].filter((c) => !c.includes('não especificada'));
  breakdown.push({
    rule: 'Tecnologia Salesforce', group: 'sinal', max: 20,
    points: techSignals.length ? 20 : cloudJobs.length ? 10 : 0,
    signalIds: (techSignals.length ? techSignals : cloudJobs).slice(0, 5).map((s) => s.id),
    reason: techSignals.length
      ? `Confirmada no site/DNS: ${[...new Set(techSignals.map((s) => s.title))].join(', ')}`
      : cloudJobs.length
        ? `Uso de ${clouds.join(', ')} evidenciado em vaga (confirmação no site/DNS vale 20)`
        : 'Nenhuma tecnologia Salesforce confirmada ainda',
  });

  // ---------- CRM concorrente: candidata a migração ----------
  // Vaga pedindo HubSpot/RD Station/Dynamics... ou site/DNS com CRM concorrente. Cargo de RevOps/CRM soma 3.
  const compJobs = jobs.filter((s) => (jobMeta(s).crms ?? []).length);
  const compTech = signals.filter((s) => s.type === 'tecnologia' && techMeta(s).vendorKind === 'concorrente');
  const compNames = [...new Set([...compJobs.flatMap((s) => jobMeta(s).crms ?? []), ...compTech.map((s) => techMeta(s).vendor ?? s.title)])];
  const opsJobs = jobs.filter((s) => jobMeta(s).opsRole);
  const usesCompetitor = compJobs.length + compTech.length > 0;
  breakdown.push({
    rule: 'Usa CRM concorrente', group: 'sinal', max: 15,
    points: usesCompetitor ? Math.min(15, 12 + (opsJobs.length ? 3 : 0)) : 0,
    signalIds: [...compTech, ...compJobs].slice(0, 5).map((s) => s.id),
    reason: usesCompetitor
      ? `Usa ${compNames.join(', ')} (${compTech.length ? 'confirmado no site/DNS' : `citado em ${compJobs.length} vaga(s)`}): candidata a migração para Salesforce${opsJobs.length ? '; +3 por vaga de operação comercial/CRM' : ''}`
      : 'Nenhum CRM concorrente identificado',
  });

  const triggers = signals.filter((s) => s.type === 'gatilho' && ageDays(s) <= 90)
    .sort((a, b) => triggerPoints(b) - triggerPoints(a));
  const topTrigger = triggers[0];
  breakdown.push({
    rule: 'Gatilho recente (90 dias)', group: 'sinal', max: 15,
    points: topTrigger ? triggerPoints(topTrigger) : 0,
    signalIds: triggers.slice(0, 3).map((s) => s.id),
    reason: topTrigger
      ? `${topTrigger.title} (${triggerPoints(topTrigger)} pts; ${triggers.length} gatilho(s) em 90 dias)`
      : 'Nenhum gatilho recente coletado',
  });

  // ---------- Dor / insatisfação com o sistema atual (bônus de até 15) ----------
  // Indícios lidos na descrição das vagas: o mais forte vale pontos cheios e cada tipo extra soma 3.
  const painByKind = new Map<string, { hint: PainMeta; signalId: number }>();
  for (const s of jobs) {
    for (const h of jobMeta(s).pain ?? []) if (!painByKind.has(h.kind)) painByKind.set(h.kind, { hint: h, signalId: s.id });
  }
  const painFound = [...painByKind.values()].sort((a, b) => (PAIN_POINTS[b.hint.kind] ?? 8) - (PAIN_POINTS[a.hint.kind] ?? 8));
  breakdown.push({
    rule: 'Dor / insatisfação com o sistema atual', group: 'dor', max: 15,
    points: painFound.length ? Math.min(15, (PAIN_POINTS[painFound[0].hint.kind] ?? 8) + 3 * (painFound.length - 1)) : 0,
    signalIds: painFound.map((p) => p.signalId).slice(0, 5),
    reason: painFound.length
      ? painFound.map((p) => `${p.hint.label}: "${p.hint.evidence}"`).join(' | ')
      : 'Nenhum indício de insatisfação nas vagas (migração de CRM, sistema legado, Salesforce mal aproveitado, processo manual)',
  });

  // ---------- Ajuste: possível consultoria/recrutadora ----------
  const flagged = jobs.filter((s) => s.review_flag?.startsWith('possível consultoria'));
  if (jobs.length && flagged.length === jobs.length) {
    breakdown.push({
      rule: 'Possível consultoria/recrutadora', group: 'ajuste', max: 0, points: -30,
      signalIds: flagged.slice(0, 3).map((s) => s.id),
      reason: `Todas as vagas indicam contratação para atender clientes (${flagged[0].review_flag!.replace(/^possível consultoria\/recrutadora: /, '')}). Revise e, se for concorrente, exclua.`,
    });
  }

  const fit = sum(breakdown.filter((b) => b.group === 'aderencia'));
  const signal = sum(breakdown.filter((b) => b.group === 'sinal'));
  const dor = sum(breakdown.filter((b) => b.group === 'dor'));
  const total = Math.max(0, Math.min(100, fit + signal + dor + sum(breakdown.filter((b) => b.group === 'ajuste'))));

  const offers = suggestOffers(sfJobs, jobMeta, ageDays, triggers, painFound.map((p) => p.hint));
  if (usesCompetitor) {
    const reason = `Usa ${compNames.join(', ')}: migração/implantação de Salesforce é projeto`;
    const agil = offers.find((o) => o.offer === 'Ágil');
    if (agil) agil.reasons.push(reason);
    else offers.push({ offer: 'Ágil', reasons: [reason] });
  }
  return { total, fit, signal, breakdown, offers };
}

function suggestOffers(
  jobs: SignalForScore[],
  meta: (s: SignalForScore) => JobMeta,
  ageDays: (s: SignalForScore) => number,
  triggers: SignalForScore[] = [],
  pain: PainMeta[] = [],
): OfferSuggestion[] {
  const improve: string[] = [];
  const agil: string[] = [];
  const keep: string[] = [];

  for (const s of jobs) {
    const m = meta(s);
    const age = ageDays(s);
    if (['developer', 'admin', 'funcional', 'qa'].includes(m.role ?? '')) {
      improve.push(
        age > jobWindows.hardToFillDays
          ? `"${s.title}" aberta há ${age} dias: dificuldade de contratar; profissional alocado resolve já`
          : `"${s.title}": precisa de capacidade Salesforce; profissional alocado por horas cobre enquanto contrata`,
      );
    }
    if (m.role === 'arquiteto' || m.role === 'tech_lead') agil.push(`"${s.title}": cargo de arquitetura/liderança costuma indicar projeto novo ou reestruturação`);
    if (m.projectHints?.length) agil.push(`"${s.title}" cita ${m.projectHints.join(', ')}`);
    if (m.supportHints?.length) keep.push(`"${s.title}" cita ${m.supportHints.join(', ')}`);
    if (m.role === 'usuario_crm') keep.push(`"${s.title}": usa Salesforce no dia a dia sem contratar time técnico — sustentação externa encaixa`);
  }

  for (const h of pain) {
    if (h.kind === 'migracao_crm' || h.kind === 'sistema_legado') agil.push(`${h.label}: a vaga indica troca de sistema, que é projeto`);
    if (h.kind === 'org_mal_aproveitada') keep.push(`${h.label}: sustentação e melhoria da org existente`);
    if (h.kind === 'processo_manual') agil.push(`${h.label}: processo a automatizar no CRM`);
  }

  for (const t of triggers) {
    const m = triggerMeta(t);
    if (t.subtype === 'fusao') agil.push(`${t.title}. Integrar dois CRMs é projeto`);
    if (t.subtype === 'lideranca' && m.area) agil.push(`Troca de liderança em ${m.area}: líder novo costuma rever ferramentas e abrir projeto`);
  }

  const offers: OfferSuggestion[] = [];
  if (improve.length) offers.push({ offer: 'Improve', reasons: dedupe(improve) });
  if (agil.length) offers.push({ offer: 'Ágil', reasons: dedupe(agil) });
  if (keep.length) offers.push({ offer: 'Keep', reasons: dedupe(keep) });
  return offers.sort((a, b) => b.reasons.length - a.reasons.length);
}

const PAIN_POINTS: Record<string, number> = { migracao_crm: 15, sistema_legado: 12, org_mal_aproveitada: 12, processo_manual: 8 };

// Sinal de tecnologia (site/DNS): fornecedor e se é Salesforce ou concorrente.
function techMeta(s: SignalForScore): { vendor?: string; vendorKind?: 'salesforce' | 'concorrente' } {
  return s.meta ? JSON.parse(s.meta) : {};
}

// Peso do gatilho: o que mais indica compra de CRM vale mais.
function triggerMeta(s: SignalForScore): { area?: string | null; mentionsSalesforce?: boolean } {
  return s.meta ? JSON.parse(s.meta) : {};
}

export function triggerPoints(s: SignalForScore): number {
  const m = triggerMeta(s);
  if (s.subtype === 'fusao' || s.subtype === 'relacionamento') return 15; // relacionamento = indicação, ex-cliente, evento
  if (s.subtype === 'lideranca') return m.area || m.mentionsSalesforce ? 15 : 8;
  if (s.subtype === 'investimento') return 10;
  if (s.subtype === 'expansao') return 8;
  return 10; // gatilho de outra fonte (PNCP, CADE...)
}

const sum = (items: BreakdownItem[]) => items.reduce((acc, b) => acc + b.points, 0);
const dedupe = (xs: string[]) => [...new Set(xs)];
const label = (sector: string) => ({ industria: 'indústria', financeiro: 'serviços financeiros', agro: 'agronegócio' })[sector] ?? sector;

export function scoreAll(db: DB, now = new Date()): number {
  const companies = db.prepare('SELECT id, sector, sector_source, size_band, size_source FROM companies').all() as
    unknown as (CompanyForScore & { id: number })[];
  const signalsOf = db.prepare(
    'SELECT id, type, subtype, title, source, published_at, collected_at, meta, review_flag FROM signals WHERE company_id = ?',
  );
  const upsert = db.prepare(`
    INSERT INTO scores (company_id, total, fit, signal, offers, breakdown, rules_version, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(company_id) DO UPDATE SET
      prev_total = CASE WHEN excluded.total <> scores.total THEN scores.total ELSE scores.prev_total END,
      total = excluded.total, fit = excluded.fit, signal = excluded.signal,
      offers = excluded.offers, breakdown = excluded.breakdown, rules_version = excluded.rules_version,
      computed_at = excluded.computed_at`);
  for (const c of companies) {
    const r = scoreCompany(c, signalsOf.all(c.id) as unknown as SignalForScore[], now);
    upsert.run(c.id, r.total, r.fit, r.signal, JSON.stringify(r.offers), JSON.stringify(r.breakdown), RULES_VERSION);
  }
  return companies.length;
}
