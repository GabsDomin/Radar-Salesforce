// Pontuação 0-100 determinística e explicada. Cada ponto vem de uma regra com motivo e sinais de origem.
// Também sugere qual oferta da Sottelli encaixa: Keep (sustentação), Improve (alocação), Ágil (projeto).
import type { DB } from '../db/index.ts';
import { icp, jobWindows, RULES_VERSION } from '../config.ts';

export interface BreakdownItem {
  rule: string;
  group: 'aderencia' | 'sinal' | 'ajuste';
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

interface JobMeta {
  role?: string; senior?: boolean; clouds?: string[]; projectHints?: string[]; supportHints?: string[]; country?: string;
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

  const brJobs = jobs.filter((s) => (jobMeta(s).country ?? 'BR') === 'BR');
  breakdown.push({
    rule: 'Atua no Brasil', group: 'aderencia', max: 10,
    points: brJobs.length ? 10 : 0,
    signalIds: brJobs.slice(0, 3).map((s) => s.id),
    reason: brJobs.length ? `${brJobs.length} vaga(s) no Brasil` : 'Sem evidência de operação no Brasil',
  });

  // ---------- Força do sinal (60) ----------
  const sorted = [...jobs].sort((a, b) => ageDays(a) - ageDays(b));
  const newest = sorted[0];
  let jobPoints = 0;
  let jobReason = 'Nenhuma vaga Salesforce encontrada';
  if (newest) {
    const age = ageDays(newest);
    jobPoints = age <= jobWindows.freshDays ? 20 : age <= jobWindows.activeDays ? 12 : 5;
    jobReason = `Vaga "${newest.title}" publicada há ${age} dia(s) (${newest.source})`;
    const seniorJobs = jobs.filter((s) => {
      const m = jobMeta(s);
      return m.senior || m.role === 'arquiteto' || m.role === 'tech_lead';
    });
    if (jobs.length >= 2 || seniorJobs.length) {
      jobPoints += 5;
      jobReason += jobs.length >= 2 ? `; +5 por ${jobs.length} vagas Salesforce` : '; +5 por vaga sênior/arquitetura';
    }
  }
  breakdown.push({
    rule: 'Vaga Salesforce ativa', group: 'sinal', max: 25, points: Math.min(jobPoints, 25),
    reason: jobReason, signalIds: sorted.slice(0, 5).map((s) => s.id),
  });

  const techSignals = signals.filter((s) => s.type === 'tecnologia');
  const cloudJobs = jobs.filter((s) => (jobMeta(s).clouds ?? []).some((c) => !c.includes('não especificada')));
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

  const triggers = signals.filter((s) => s.type === 'gatilho' && ageDays(s) <= 90);
  breakdown.push({
    rule: 'Gatilho recente (90 dias)', group: 'sinal', max: 15,
    points: triggers.length ? 15 : 0,
    signalIds: triggers.slice(0, 3).map((s) => s.id),
    reason: triggers.length ? `Gatilho: ${triggers[0].title}` : 'Nenhum gatilho recente coletado',
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
  const total = Math.max(0, Math.min(100, fit + signal + sum(breakdown.filter((b) => b.group === 'ajuste'))));

  return { total, fit, signal, breakdown, offers: suggestOffers(jobs, jobMeta, ageDays) };
}

function suggestOffers(
  jobs: SignalForScore[],
  meta: (s: SignalForScore) => JobMeta,
  ageDays: (s: SignalForScore) => number,
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

  const offers: OfferSuggestion[] = [];
  if (improve.length) offers.push({ offer: 'Improve', reasons: dedupe(improve) });
  if (agil.length) offers.push({ offer: 'Ágil', reasons: dedupe(agil) });
  if (keep.length) offers.push({ offer: 'Keep', reasons: dedupe(keep) });
  return offers.sort((a, b) => b.reasons.length - a.reasons.length);
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
    ON CONFLICT(company_id) DO UPDATE SET total = excluded.total, fit = excluded.fit, signal = excluded.signal,
      offers = excluded.offers, breakdown = excluded.breakdown, rules_version = excluded.rules_version,
      computed_at = excluded.computed_at`);
  for (const c of companies) {
    const r = scoreCompany(c, signalsOf.all(c.id) as unknown as SignalForScore[], now);
    upsert.run(c.id, r.total, r.fit, r.signal, JSON.stringify(r.offers), JSON.stringify(r.breakdown), RULES_VERSION);
  }
  return companies.length;
}
