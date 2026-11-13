// Dashboard: números-resumo, distribuições, gatilhos recentes e histórico de execuções.
import type { DB } from '../db/index.ts';
import { STAGES } from './queries.ts';
import { modalityCounts, type ModalityId } from './modalities.ts';
import { visaoCounts, type Visao } from './queries.ts';
import { DISCARD_LABEL } from '../pipeline/decisions.ts';

export interface DashboardData {
  generatedAt: string;
  queue: Record<Visao, number>;
  nextActions: { id: number; name: string; next_action: string | null; next_action_at: string; due: number }[];
  discardReasons: { label: string; count: number }[];
  // Resultado por fonte de origem do lead: mostra, com o tempo, qual fonte traz reunião (e cliente).
  bySourceOutcome: { source: string; leads: number; aprovados: number; contatados: number; responderam: number; reunioes: number }[];
  modalities: Record<ModalityId, { total: number; companies: number; recent: number }>;
  totals: { accounts: number; withPain: number; hot: number; newLast7: number; withTrigger: number; jobsActive: number; excluded: number };
  scoreBuckets: { label: string; count: number }[];
  bySector: { label: string; count: number }[];
  byOffer: { label: string; count: number }[];
  funnel: { stage: string; count: number }[];
  bySource: { label: string; count: number }[];
  topAccounts: { id: number; name: string; total: number; offers: string[]; why: string }[];
  recentTriggers: { id: number; company_id: number; company: string; subtype: string | null; title: string; url: string; published_at: string | null }[];
  runs: { collector: string; started_at: string; finished_at: string | null; ok: boolean; summary: string }[];
}

const SECTOR_LABEL: Record<string, string> = { industria: 'Indústria', financeiro: 'Serv. financeiros', agro: 'Agronegócio' };

const one = <T>(db: DB, sql: string, ...p: (string | number)[]) => db.prepare(sql).get(...p) as T;
const all = <T>(db: DB, sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as T[];

export function dashboardData(db: DB, hotThreshold = 50): DashboardData {
  const visible = 'c.excluded_reason IS NULL';
  const n = (sql: string, ...p: (string | number)[]) => one<{ n: number }>(db, sql, ...p).n;

  const totals = {
    accounts: n(`SELECT count(*) n FROM companies c WHERE ${visible}`),
    withPain: all<{ breakdown: string }>(db, `SELECT s.breakdown FROM companies c JOIN scores s ON s.company_id = c.id WHERE ${visible}`)
      .filter((r) => (JSON.parse(r.breakdown) as { group: string; points: number }[]).some((b) => b.group === 'dor' && b.points > 0)).length,
    hot: n(`SELECT count(*) n FROM companies c JOIN scores s ON s.company_id = c.id WHERE ${visible} AND s.total >= ?`, hotThreshold),
    newLast7: n(`SELECT count(*) n FROM companies c WHERE ${visible} AND c.created_at >= datetime('now', '-7 days')`),
    withTrigger: n(`SELECT count(DISTINCT x.company_id) n FROM signals x JOIN companies c ON c.id = x.company_id
                    WHERE ${visible} AND x.type = 'gatilho' AND COALESCE(x.published_at, x.collected_at) >= datetime('now', '-90 days')`),
    jobsActive: n(`SELECT count(*) n FROM signals x JOIN companies c ON c.id = x.company_id WHERE ${visible} AND x.type = 'vaga'`),
    excluded: n('SELECT count(*) n FROM companies c WHERE c.excluded_reason IS NOT NULL'),
  };

  const bucketDefs: [string, number, number][] = [['0–19', 0, 19], ['20–39', 20, 39], ['40–59', 40, 59], ['60–79', 60, 79], ['80–100', 80, 100]];
  const scoreBuckets = bucketDefs.map(([label, lo, hi]) => ({
    label,
    count: n(`SELECT count(*) n FROM companies c JOIN scores s ON s.company_id = c.id WHERE ${visible} AND s.total BETWEEN ? AND ?`, lo, hi),
  }));

  const bySector = all<{ sector: string | null; n: number }>(db,
    `SELECT c.sector, count(*) n FROM companies c WHERE ${visible} GROUP BY c.sector ORDER BY n DESC`)
    .map((r) => ({ label: r.sector ? (SECTOR_LABEL[r.sector] ?? r.sector) : 'Não identificado', count: r.n }));

  const offerCount: Record<string, number> = {};
  for (const r of all<{ offers: string }>(db, `SELECT s.offers FROM scores s JOIN companies c ON c.id = s.company_id WHERE ${visible}`)) {
    for (const o of JSON.parse(r.offers) as { offer: string }[]) offerCount[o.offer] = (offerCount[o.offer] ?? 0) + 1;
  }
  const byOffer = ['Keep', 'Improve', 'Ágil'].map((label) => ({ label, count: offerCount[label] ?? 0 }));

  const stageCount = Object.fromEntries(all<{ stage: string; n: number }>(db,
    `SELECT c.stage, count(*) n FROM companies c WHERE ${visible} GROUP BY c.stage`).map((r) => [r.stage, r.n]));
  const funnel = STAGES.map((stage) => ({ stage, count: stageCount[stage] ?? 0 }));

  const bySource = all<{ source: string; n: number }>(db,
    `SELECT x.source, count(*) n FROM signals x JOIN companies c ON c.id = x.company_id WHERE ${visible} GROUP BY x.source ORDER BY n DESC`)
    .map((r) => ({ label: r.source, count: r.n }));

  const topAccounts = all<{ id: number; name: string; total: number; offers: string; breakdown: string }>(db,
    `SELECT c.id, c.name, s.total, s.offers, s.breakdown FROM companies c JOIN scores s ON s.company_id = c.id
     WHERE ${visible} ORDER BY s.total DESC, c.name LIMIT 8`).map((r) => {
    const top = (JSON.parse(r.breakdown) as { rule: string; points: number }[]).filter((b) => b.points > 0).sort((a, b) => b.points - a.points)[0];
    return {
      id: r.id, name: r.name, total: r.total,
      offers: (JSON.parse(r.offers) as { offer: string }[]).map((o) => o.offer),
      why: top ? `+${top.points} ${top.rule}` : '—',
    };
  });

  const recentTriggers = all<DashboardData['recentTriggers'][number]>(db,
    `SELECT x.id, x.company_id, c.name AS company, x.subtype, x.title, x.url, x.published_at
     FROM signals x JOIN companies c ON c.id = x.company_id
     WHERE ${visible} AND x.type = 'gatilho' ORDER BY COALESCE(x.published_at, x.collected_at) DESC LIMIT 8`);

  const runs = all<{ collector: string; started_at: string; finished_at: string | null; stats: string | null; error: string | null }>(db,
    'SELECT collector, started_at, finished_at, stats, error FROM collection_runs ORDER BY id DESC LIMIT 8').map((r) => ({
    collector: r.collector, started_at: r.started_at, finished_at: r.finished_at,
    ok: !r.error && !!r.finished_at,
    summary: r.error ? r.error.slice(0, 120) : summarizeStats(r.stats),
  }));

  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  const nextActions = all<{ id: number; name: string; next_action: string | null; next_action_at: string }>(db,
    `SELECT c.id, c.name, c.next_action, c.next_action_at FROM companies c
     WHERE ${visible} AND c.status <> 'descartado' AND c.next_action_at IS NOT NULL
     ORDER BY c.next_action_at LIMIT 8`)
    .map((a) => ({ ...a, due: Math.round((new Date(a.next_action_at + 'T00:00:00Z').getTime() - today) / 86_400_000) }));

  const discardReasons = all<{ discard_reason: string | null; n: number }>(db,
    `SELECT c.discard_reason, count(*) n FROM companies c WHERE c.status = 'descartado' GROUP BY c.discard_reason ORDER BY n DESC`)
    .map((r) => ({ label: DISCARD_LABEL[r.discard_reason ?? ''] ?? 'Sem motivo', count: r.n }));

  const bySourceOutcome = all<{ source: string; leads: number; aprovados: number; contatados: number; responderam: number; reunioes: number }>(db, `
    SELECT o.source, count(*) AS leads,
      sum(CASE WHEN c.status IN ('qualificado', 'em_abordagem') THEN 1 ELSE 0 END) AS aprovados,
      sum(CASE WHEN c.outreach IS NOT NULL THEN 1 ELSE 0 END) AS contatados,
      sum(CASE WHEN c.outreach IN ('respondeu', 'reuniao') THEN 1 ELSE 0 END) AS responderam,
      sum(CASE WHEN c.outreach = 'reuniao' THEN 1 ELSE 0 END) AS reunioes
    FROM companies c
    JOIN (SELECT company_id, source FROM signals x WHERE x.id = (SELECT min(id) FROM signals y WHERE y.company_id = x.company_id)) o ON o.company_id = c.id
    WHERE ${visible}
    GROUP BY o.source ORDER BY reunioes DESC, responderam DESC, aprovados DESC, leads DESC`);

  return { generatedAt: new Date().toISOString(), queue: visaoCounts(db), nextActions, discardReasons, bySourceOutcome, modalities: modalityCounts(db), totals, scoreBuckets, bySector, byOffer, funnel, bySource, topAccounts, recentTriggers, runs };
}

function summarizeStats(stats: string | null): string {
  if (!stats) return 'em andamento ou sem resumo';
  const s = JSON.parse(stats) as Record<string, number>;
  const parts: string[] = [];
  if ('received' in s) parts.push(`${s.received} recebida(s)`);
  if (s.newSignals !== undefined) parts.push(`${s.newSignals} nova(s)`);
  if (s.skippedConsultancy) parts.push(`${s.skippedConsultancy} consultoria(s) descartada(s)`);
  if (s.outOfRegion) parts.push(`${s.outOfRegion} fora da América Latina`);
  return parts.join(' · ') || 'concluída';
}
