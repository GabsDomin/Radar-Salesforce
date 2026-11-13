// Pontuação 0-100 determinística e explicada. Cada ponto vem de uma regra com motivo e sinais de origem.
// Também sugere qual oferta da Sottelli encaixa: Keep (sustentação), Improve (alocação), Ágil (projeto).
import type { DB } from '../db/index.ts';
import { icp, jobWindows, RULES_VERSION, EVERGREEN_TITLE, OPEN_AGE_BONUS, TECH_ROLES } from '../config.ts';
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
  last_seen_at?: string | null; // ausente = considerada vista agora
  meta: string | null;
  review_flag: string | null;
}

// SQLite grava "2026-11-12 10:00:00" (UTC, sem fuso); o resto vem em ISO.
function parseDbDate(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
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
    Math.max(0, Math.floor((now.getTime() - parseDbDate(s.published_at ?? s.collected_at).getTime()) / DAY));

  // ---------- Aderência ao perfil (40) ----------
  const inIcp = company.sector !== null && (icp.sectors as readonly string[]).includes(company.sector);
  const sectorInferred = company.sector_source?.startsWith('inferido') ?? true;
  breakdown.push({
    rule: 'Setor-alvo', group: 'aderencia', max: 15, signalIds: [],
    points: inIcp ? (sectorInferred ? 8 : 15) : 0,
    reason: inIcp
      ? `${cap(label(company.sector!))}${sectorInferred ? ' (a confirmar: vale metade até confirmar na Receita)' : ''}`
      : company.sector
        ? 'Setor fora do perfil (indústria, financeiro, agro)'
        : 'Setor ainda não identificado',
  });

  const sizeOk = company.size_band === `${icp.minEmployees}+`;
  const sizeInferred = company.size_source?.startsWith('inferido') ?? true;
  breakdown.push({
    rule: `Porte ${icp.minEmployees}+ funcionários`, group: 'aderencia', max: 15, signalIds: [],
    points: sizeOk ? (sizeInferred ? 7 : 15) : 0,
    reason: sizeOk
      ? (sizeInferred ? 'A confirmar: vale metade até confirmar na Receita' : 'Confirmado na Receita')
      : company.size_band
        ? `Porte ${company.size_band}, abaixo do perfil`
        : 'Porte ainda não verificado',
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
      ? `Vagas no Brasil${latamJobs.length ? ` e em ${latamNames}` : ''}`
      : latamJobs.length
        ? `Vagas em ${latamNames}`
        : 'Sem sinal de operação no Brasil ou na América Latina',
  });

  // ---------- Força do sinal (60) ----------
  // Vagas que só citam CRM concorrente têm regra própria; aqui contam só as de Salesforce.
  // Vaga aberta há mais tempo vale mais: a empresa não está conseguindo contratar, e profissional
  // alocado (Improve) resolve já. Só conta vaga ainda aberta (vista na fonte recentemente), que não seja
  // banco de talentos nem vaga "permanente" (mais de 180 dias).
  const sfJobs = jobs.filter((s) => jobMeta(s).salesforce !== false);
  const seenDaysAgo = (s: SignalForScore) =>
    s.last_seen_at ? Math.floor((now.getTime() - parseDbDate(s.last_seen_at).getTime()) / DAY) : 0;
  const openJobs = sfJobs
    .filter((s) => seenDaysAgo(s) <= jobWindows.stillOpenDays && !EVERGREEN_TITLE.test(s.title) && ageDays(s) <= jobWindows.maxRealOpenDays)
    .sort((a, b) => ageDays(b) - ageDays(a));
  // Só cargo técnico (dev, admin, funcional...) ganha bônus por tempo: é o que a Sottelli aloca.
  // Vaga de outra área que só cita Salesforce (marketing, comercial) mostra uso, não falta de gente.
  const techOpen = openJobs.filter((s) => TECH_ROLES.includes(jobMeta(s).role ?? s.subtype ?? ''));
  let jobPoints = 0;
  let jobReason = 'Nenhuma vaga Salesforce encontrada';
  const oldest = techOpen[0];
  if (!oldest && openJobs.length) {
    jobPoints = 8;
    jobReason = `"${openJobs[0].title}" cita Salesforce, mas não é vaga técnica`;
  }
  if (oldest) {
    const age = ageDays(oldest);
    const bonus = OPEN_AGE_BONUS.find(([min]) => age >= min)?.[1] ?? 0;
    jobPoints = 10 + bonus;
    jobReason = `"${oldest.title}" aberta há ${age} dia${age === 1 ? '' : 's'}`
      + (bonus ? `: difícil de contratar (+${bonus})` : '');
    const seniorJobs = techOpen.filter((s) => {
      const m = jobMeta(s);
      return m.senior || m.role === 'arquiteto' || m.role === 'tech_lead';
    });
    if (techOpen.length >= 2 || seniorJobs.length) {
      jobPoints += 5;
      jobReason += techOpen.length >= 2 ? `; ${techOpen.length} vagas técnicas abertas (+5)` : '; vaga sênior (+5)';
    }
  } else if (!openJobs.length && sfJobs.length) {
    jobPoints = 3;
    const s = sfJobs[0];
    jobReason = EVERGREEN_TITLE.test(s.title) ? `Só banco de talentos ("${s.title}")`
      : seenDaysAgo(s) > jobWindows.stillOpenDays ? `"${s.title}" saiu do ar há ${seenDaysAgo(s)} dias: provavelmente fechada`
        : `"${s.title}" aberta há ${ageDays(s)} dias: vaga permanente`;
  }
  breakdown.push({
    rule: 'Vaga Salesforce aberta', group: 'sinal', max: 40, points: Math.min(jobPoints, 40),
    reason: jobReason, signalIds: (openJobs.length ? openJobs : sfJobs).slice(0, 5).map((s) => s.id),
  });

  const techSignals = signals.filter((s) => s.type === 'tecnologia' && techMeta(s).vendorKind !== 'concorrente');
  const cloudJobs = sfJobs.filter((s) => (jobMeta(s).clouds ?? []).some((c) => !c.includes('não especificada')));
  const clouds = [...new Set(cloudJobs.flatMap((s) => jobMeta(s).clouds ?? []))].filter((c) => !c.includes('não especificada'));
  breakdown.push({
    rule: 'Tecnologia Salesforce', group: 'sinal', max: 20,
    points: techSignals.length ? 20 : cloudJobs.length ? 10 : 0,
    signalIds: (techSignals.length ? techSignals : cloudJobs).slice(0, 5).map((s) => s.id),
    reason: techSignals.length
      ? `Já usa ${[...new Set(techSignals.map((s) => s.title.replace(/ \(e-mail da plataforma\)| \(caso de cliente publicado\)/, '')))].join(', ')}`
      : cloudJobs.length
        ? `Vaga cita ${clouds.slice(0, 3).join(', ')}${clouds.length > 3 ? ` e mais ${clouds.length - 3}` : ''}`
        : 'Nenhum uso de Salesforce confirmado ainda',
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
      ? `Usa ${compNames.join(', ')}: pode migrar para Salesforce${opsJobs.length ? '; vaga de operação comercial (+3)' : ''}`
      : 'Nenhum outro CRM identificado',
  });

  const triggers = signals.filter((s) => s.type === 'gatilho' && ageDays(s) <= 90)
    .sort((a, b) => triggerPoints(b) - triggerPoints(a));
  const topTrigger = triggers[0];
  breakdown.push({
    rule: 'Momento da empresa', group: 'sinal', max: 15,
    points: topTrigger ? triggerPoints(topTrigger) : 0,
    signalIds: triggers.slice(0, 3).map((s) => s.id),
    reason: topTrigger
      ? `${topTrigger.title}${triggers.length > 1 ? ` (e mais ${triggers.length - 1})` : ''}`
      : 'Nenhuma mudança recente (diretoria, fusão, investimento)',
  });

  // ---------- Dor / insatisfação com o sistema atual (bônus de até 15) ----------
  // Indícios lidos na descrição das vagas: o mais forte vale pontos cheios e cada tipo extra soma 3.
  const painByKind = new Map<string, { hint: PainMeta; signalId: number }>();
  for (const s of jobs) {
    for (const h of jobMeta(s).pain ?? []) if (!painByKind.has(h.kind)) painByKind.set(h.kind, { hint: h, signalId: s.id });
  }
  const painFound = [...painByKind.values()].sort((a, b) => (PAIN_POINTS[b.hint.kind] ?? 8) - (PAIN_POINTS[a.hint.kind] ?? 8));
  breakdown.push({
    rule: 'Insatisfação com o sistema', group: 'dor', max: 15,
    points: painFound.length ? Math.min(15, (PAIN_POINTS[painFound[0].hint.kind] ?? 8) + 3 * (painFound.length - 1)) : 0,
    signalIds: painFound.map((p) => p.signalId).slice(0, 5),
    reason: painFound.length
      ? painFound.map((p) => `${p.hint.label}: "${p.hint.evidence}"`).join(' | ')
      : 'Nenhum sinal de insatisfação nas vagas',
  });

  // ---------- Ajuste: possível consultoria/recrutadora ----------
  const flagged = jobs.filter((s) => s.review_flag?.startsWith('possível consultoria'));
  if (jobs.length && flagged.length === jobs.length) {
    breakdown.push({
      rule: 'Possível consultoria/recrutadora', group: 'ajuste', max: 0, points: -30,
      signalIds: flagged.slice(0, 3).map((s) => s.id),
      reason: `Parece consultoria (${flagged[0].review_flag!.replace(/^possível consultoria\/recrutadora: /, '')}). Confira e descarte se for.`,
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
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (sector: string) => ({ industria: 'indústria', financeiro: 'serviços financeiros', agro: 'agronegócio' })[sector] ?? sector;

export function scoreAll(db: DB, now = new Date()): number {
  const companies = db.prepare('SELECT id, sector, sector_source, size_band, size_source FROM companies').all() as
    unknown as (CompanyForScore & { id: number })[];
  const signalsOf = db.prepare(
    'SELECT id, type, subtype, title, source, published_at, collected_at, last_seen_at, meta, review_flag FROM signals WHERE company_id = ?',
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
