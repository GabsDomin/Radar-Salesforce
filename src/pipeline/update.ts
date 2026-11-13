// Etapas de atualização do Radar. Usadas pelo terminal (cli.ts) e pelo botão "Atualizar" do painel.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DB } from '../db/index.ts';
import { PoliteClient } from '../http/client.ts';
import { collectGupy } from '../sources/gupy.ts';
import { collectBoards, parseBoards } from '../sources/boards.ts';
import { collectGetonbrd } from '../sources/getonbrd.ts';
import { runTech, runCases } from './tech.ts';
import { runEnrich } from './enrich.ts';
import { discoverFromSites, readBoards } from './boardsDiscovery.ts';
import { mergeDuplicates } from './companies.ts';
import { collectNews } from '../sources/news.ts';
import { parseCsv } from '../util/csv.ts';
import { ingestJobs } from './ingestJobs.ts';
import { ingestNews } from './ingestNews.ts';
import { scoreAll } from '../scoring/score.ts';
import { buildStaticSite } from '../web/static.ts';
import { jobSearchTerms, competitorSearchTerms, ROOT, gdeltIntervalMs } from '../config.ts';
const ALL_TERMS = [...jobSearchTerms, ...competitorSearchTerms];

export type Log = (msg: string) => void;
export type StepId = 'vagas' | 'noticias' | 'enriquecer' | 'tecnologia' | 'site' | 'publicar';

export const STEP_LABEL: Record<StepId, string> = {
  vagas: 'Coletar vagas (Gupy, Get on Board e quadros)',
  noticias: 'Buscar notícias e gatilhos',
  enriquecer: 'Enriquecer (site, CNPJ, Receita: setor, porte e diretoria)',
  tecnologia: 'Detectar tecnologia (CVM, site/DNS e casos de clientes Salesforce)',
  site: 'Gerar painel estático',
  publicar: 'Publicar na Vercel',
};

// Registra a execução em collection_runs (aparece no histórico do painel).
async function tracked<T>(db: DB, collector: string, fn: () => Promise<T>): Promise<T> {
  const run = db.prepare('INSERT INTO collection_runs (collector) VALUES (?)').run(collector);
  const runId = Number(run.lastInsertRowid);
  try {
    const stats = await fn();
    db.prepare("UPDATE collection_runs SET finished_at = datetime('now'), stats = ? WHERE id = ?").run(JSON.stringify(stats), runId);
    return stats;
  } catch (err) {
    db.prepare("UPDATE collection_runs SET finished_at = datetime('now'), error = ? WHERE id = ?").run(String(err), runId);
    throw err;
  }
}

export function runVagas(db: DB, log: Log) {
  return tracked(db, 'vagas', async () => {
    const client = new PoliteClient({ db });
    const postings = await collectGupy(client, ALL_TERMS, log);
    // Uma fonte com problema não derruba as outras.
    try {
      postings.push(...(await collectGetonbrd(client, ALL_TERMS, log)));
    } catch (err) {
      log(`getonbrd falhou (${err instanceof Error ? err.message : err}); seguindo com as demais fontes`);
    }
    const boardsFile = path.join(ROOT, 'seeds', 'quadros.csv');
    if (fs.existsSync(boardsFile)) {
      const boards = parseBoards(parseCsv(fs.readFileSync(boardsFile, 'utf8')));
      postings.push(...(await collectBoards(client, boards, log)));
    }
    const stats = ingestJobs(db, postings);
    log(`${scoreAll(db)} conta(s) pontuada(s).`);
    return stats;
  });
}

export function runEnriquecer(db: DB, log: Log) {
  return tracked(db, 'enriquecer', async () => {
    const client = new PoliteClient({ db });
    const stats = { ...(await runEnrich(db, client, log)), boardsFromSites: await discoverFromSites(db, client, log) };
    const { merged } = mergeDuplicates(db);
    if (merged.length) log(`Duplicados juntados: ${merged.join('; ')}`);
    log(`${scoreAll(db)} conta(s) pontuada(s).`);
    return stats;
  });
}

export function runTecnologia(db: DB, log: Log) {
  return tracked(db, 'tecnologia', async () => {
    const client = new PoliteClient({ db });
    const stats = { cvm: await runTech(db, client, log), casos: await runCases(db, client, log).catch((err) => { log(`casos de clientes falharam: ${err instanceof Error ? err.message : err}`); return null; }) };
    const { merged } = mergeDuplicates(db);
    if (merged.length) log(`Duplicados juntados: ${merged.join('; ')}`);
    log(`${scoreAll(db)} conta(s) pontuada(s).`);
    return stats;
  });
}

export function runNoticias(db: DB, limit: number, log: Log) {
  return tracked(db, 'noticias', async () => {
    const companies = db.prepare(`
      SELECT c.id, c.name FROM companies c LEFT JOIN scores s ON s.company_id = c.id
      WHERE c.excluded_reason IS NULL ORDER BY COALESCE(s.total, 0) DESC, c.name LIMIT ?`).all(limit) as { id: number; name: string }[];
    log(`Buscando notícias de ${companies.length} conta(s) (1 consulta a cada ${gdeltIntervalMs / 1000}s)...`);
    const client = new PoliteClient({ db, minIntervalMs: gdeltIntervalMs });
    const stats = ingestNews(db, await collectNews(client, companies, log));
    log(`${scoreAll(db)} conta(s) pontuada(s).`);
    return stats;
  });
}

export const SITE_DIR = path.join(ROOT, 'publicar', 'public');

export function runSite(db: DB, log: Log) {
  const r = buildStaticSite(db, SITE_DIR);
  log(`Site gerado em ${SITE_DIR} (${r.companies} conta(s)).`);
  return r;
}

// Publica a pasta publicar/ na Vercel (exige `vercel login` e o projeto já vinculado).
export function runPublicar(log: Log): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('vercel', ['--prod', '--yes'], { cwd: path.join(ROOT, 'publicar'), shell: true });
    const forward = (chunk: Buffer) => chunk.toString().split(/\r?\n/).filter(Boolean).forEach(log);
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`vercel saiu com código ${code}`))));
  });
}

export interface UpdateOptions {
  steps: StepId[];
  newsLimit?: number;
  onStep?: (step: StepId) => void;
}

// Executa as etapas na ordem; uma etapa que falha é registrada e as demais continuam
// (exceto publicar, que só roda se o site foi gerado).
export async function atualizar(db: DB, opts: UpdateOptions, log: Log): Promise<{ step: StepId; ok: boolean; error?: string }[]> {
  const order: StepId[] = ['vagas', 'noticias', 'enriquecer', 'tecnologia', 'site', 'publicar'];
  const results: { step: StepId; ok: boolean; error?: string }[] = [];
  for (const step of order.filter((s) => opts.steps.includes(s))) {
    opts.onStep?.(step);
    log(`\n▶ ${STEP_LABEL[step]}`);
    if (step === 'publicar' && !results.some((r) => r.step === 'site' && r.ok)) {
      log('Publicação ignorada: o painel estático não foi gerado nesta execução.');
      results.push({ step, ok: false, error: 'site não gerado' });
      continue;
    }
    try {
      if (step === 'vagas') await runVagas(db, log);
      else if (step === 'noticias') await runNoticias(db, opts.newsLimit ?? 30, log);
      else if (step === 'enriquecer') await runEnriquecer(db, log);
      else if (step === 'tecnologia') await runTecnologia(db, log);
      else if (step === 'site') runSite(db, log);
      else await runPublicar(log);
      results.push({ step, ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      log(`✖ ${STEP_LABEL[step]} falhou: ${error}`);
      results.push({ step, ok: false, error });
    }
  }
  return results;
}
