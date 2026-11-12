// Linha de comando do Radar.
//   node src/cli.ts atualizar [--rapido] [--publicar]   vagas + notícias + painel estático (+ Vercel)
//   node src/cli.ts coletar            coleta vagas, grava e pontua
//   node src/cli.ts noticias [n]       busca gatilhos (liderança, fusão...) das n contas mais bem pontuadas (padrão 30)
//   node src/cli.ts pontuar            recalcula as notas
//   node src/cli.ts excluir <csv> [tipo]  importa clientes/concorrentes/recrutadoras
//   node src/cli.ts painel [porta]     abre o painel em http://localhost:3333
//   node src/cli.ts site               gera o painel estático em publicar/public (para a Vercel)
//   node src/cli.ts descobrir-quadros  acha quadros no Greenhouse/Lever a partir de seeds/candidatos-quadros.txt
//   node src/cli.ts fontes             lista o catálogo de fontes
import path from 'node:path';
import fs from 'node:fs';
import { PoliteClient } from './http/client.ts';
import { parseBoards } from './sources/boards.ts';
import { discoverBoards } from './sources/discoverBoards.ts';
import { parseCsv } from './util/csv.ts';
import { openDb } from './db/index.ts';
import { SOURCE_CATALOG } from './sources/types.ts';
import { importExclusions, type ExclusionKind } from './pipeline/exclusions.ts';
import { scoreAll } from './scoring/score.ts';
import { purgeConsultancies } from './pipeline/ingestJobs.ts';
import { mergeDuplicates } from './pipeline/companies.ts';
import { createServer } from './web/server.ts';
import { atualizar, runNoticias, runSite, runTecnologia, runVagas, type StepId } from './pipeline/update.ts';
import { ROOT } from './config.ts';

const [cmd, ...args] = process.argv.slice(2);
const db = openDb();
const log = (m: string) => console.log(m);

switch (cmd) {
  case 'atualizar': {
    const steps: StepId[] = args.includes('--rapido') ? ['vagas', 'site'] : ['vagas', 'noticias', 'tecnologia', 'site'];
    if (args.includes('--publicar')) steps.push('publicar');
    const results = await atualizar(db, { steps }, log);
    console.log('\nResultado:');
    console.table(results.map((r) => ({ etapa: r.step, ok: r.ok ? 'sim' : 'não', erro: r.error ?? '' })));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
    break;
  }
  case 'coletar':
    console.table(await runVagas(db, log));
    break;
  case 'noticias':
    console.table(await runNoticias(db, Number(args[0] ?? 30), log));
    break;
  case 'tecnologia':
    console.table(await runTecnologia(db, log));
    break;
  case 'pontuar': {
    const { merged } = mergeDuplicates(db);
    if (merged.length) console.log(`Duplicados juntados (${merged.length}): ${merged.join('; ')}`);
    const purged = purgeConsultancies(db);
    if (purged.signals || purged.companies) console.log(`Limpeza: ${purged.signals} vaga(s) de consultoria e ${purged.companies} conta(s) removidas.`);
    console.log(`${scoreAll(db)} conta(s) pontuada(s).`);
    break;
  }
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
  case 'site':
    runSite(db, log);
    console.log('Para publicar: npm run atualizar -- --publicar (ou cd publicar && vercel --prod)');
    break;
  case 'descobrir-quadros': {
    // Testa os nomes de seeds/candidatos-quadros.txt no Greenhouse e no Lever e anexa os achados em seeds/quadros.csv.
    const candidatesFile = path.join(ROOT, 'seeds', 'candidatos-quadros.txt');
    const boardsFile = path.join(ROOT, 'seeds', 'quadros.csv');
    const names = fs.readFileSync(candidatesFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const known = fs.existsSync(boardsFile) ? parseBoards(parseCsv(fs.readFileSync(boardsFile, 'utf8'))) : [];
    console.log(`Testando ${names.length} empresa(s) no Greenhouse e no Lever...`);
    const found = await discoverBoards(new PoliteClient({ db }), names, known, log);
    if (found.length) {
      const existing = fs.existsSync(boardsFile) ? fs.readFileSync(boardsFile, 'utf8').replace(/\s*$/, '\n') : 'fonte;slug;empresa\n';
      fs.writeFileSync(boardsFile, existing + found.map((b) => `${b.kind};${b.slug};${b.company}`).join('\n') + '\n');
    }
    console.log(`${found.length} quadro(s) novo(s) gravado(s) em seeds/quadros.csv.`);
    break;
  }
  case 'fontes':
    console.table(SOURCE_CATALOG.map(({ id, kind, status, note }) => ({ id, tipo: kind, status, obs: note })));
    break;
  default:
    console.log('Comandos: atualizar [--rapido] [--publicar] | coletar | noticias [n] | pontuar | excluir <arquivo.csv> [cliente|concorrente|recrutadora] | painel [porta] | site | descobrir-quadros | fontes');
}
