// Linha de comando do Radar.
//   node src/cli.ts coletar            coleta todas as fontes ativas, grava e pontua
//   node src/cli.ts pontuar            recalcula as notas
//   node src/cli.ts excluir <csv> [tipo]  importa clientes/concorrentes/recrutadoras
//   node src/cli.ts painel [porta]     abre o painel em http://localhost:3333
//   node src/cli.ts site               gera o painel estático em publicar/public (para a Vercel)
//   node src/cli.ts fontes             lista o catálogo de fontes
import path from 'node:path';
import { openDb } from './db/index.ts';
import { PoliteClient } from './http/client.ts';
import fs from 'node:fs';
import { collectGupy } from './sources/gupy.ts';
import { collectBoards, parseBoards } from './sources/boards.ts';
import { parseCsv } from './util/csv.ts';
import { SOURCE_CATALOG } from './sources/types.ts';
import { ingestJobs } from './pipeline/ingestJobs.ts';
import { importExclusions, type ExclusionKind } from './pipeline/exclusions.ts';
import { scoreAll } from './scoring/score.ts';
import { createServer } from './web/server.ts';
import { buildStaticSite } from './web/static.ts';
import { jobSearchTerms, ROOT } from './config.ts';

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();

async function coletar() {
  const run = db.prepare("INSERT INTO collection_runs (collector) VALUES ('vagas')").run();
  const runId = Number(run.lastInsertRowid);
  try {
    const client = new PoliteClient({ db });
    const log = (m: string) => console.log(m);
    const postings = await collectGupy(client, jobSearchTerms, log);
    const boardsFile = path.join(ROOT, 'seeds', 'quadros.csv');
    if (fs.existsSync(boardsFile)) {
      const boards = parseBoards(parseCsv(fs.readFileSync(boardsFile, 'utf8')));
      postings.push(...(await collectBoards(client, boards, log)));
    }
    const stats = ingestJobs(db, postings);
    const scored = scoreAll(db);
    db.prepare("UPDATE collection_runs SET finished_at = datetime('now'), stats = ? WHERE id = ?")
      .run(JSON.stringify(stats), runId);
    console.log('\nResumo da coleta:');
    console.table(stats);
    console.log(`${scored} conta(s) pontuada(s). Abra o painel com: npm run painel`);
  } catch (err) {
    db.prepare("UPDATE collection_runs SET finished_at = datetime('now'), error = ? WHERE id = ?").run(String(err), runId);
    throw err;
  }
}

switch (cmd) {
  case 'coletar':
    await coletar();
    break;
  case 'pontuar':
    console.log(`${scoreAll(db)} conta(s) pontuada(s).`);
    break;
  case 'excluir': {
    const file = args[0] ?? path.join(ROOT, 'seeds', 'concorrentes.csv');
    const r = importExclusions(db, file, args[1] as ExclusionKind | undefined);
    console.log(`${r.imported} registro(s) importado(s); ${r.companiesUpdated} conta(s) atualizada(s).`);
    for (const s of r.skipped) console.log('  ignorado:', s);
    scoreAll(db);
    break;
  }
  case 'painel': {
    const port = Number(args[0] ?? process.env.PORT ?? 3333);
    createServer(db).listen(port, '127.0.0.1', () => console.log(`Painel em http://localhost:${port}`));
    break;
  }
  case 'site': {
    const out = path.join(ROOT, 'publicar', 'public');
    const r = buildStaticSite(db, out);
    console.log(`Site gerado em ${out} (${r.companies} conta(s)). Para publicar: cd publicar && npx vercel --prod`);
    break;
  }
  case 'fontes':
    console.table(SOURCE_CATALOG.map(({ id, kind, status, note }) => ({ id, tipo: kind, status, obs: note })));
    break;
  default:
    console.log('Comandos: coletar | pontuar | excluir <arquivo.csv> [cliente|concorrente|recrutadora] | painel [porta] | site | fontes');
}
