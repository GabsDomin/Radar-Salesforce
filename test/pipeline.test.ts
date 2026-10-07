import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db/index.ts';
import { PoliteClient, RobotsDisallowedError, type FetchFn } from '../src/http/client.ts';
import { collectGupy, parseGupySearchPage } from '../src/sources/gupy.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { importExclusions } from '../src/pipeline/exclusions.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { listCompanies, getCompany } from '../src/web/queries.ts';
import { listPage, detailPage } from '../src/web/views.ts';
import { exportCsv } from '../src/web/export.ts';

const NOW = new Date('2026-10-06T12:00:00Z');

function gupyPage(jobs: object[], total = jobs.length) {
  const data = { props: { pageProps: { initialJobList: { data: jobs, pagination: { total, limit: 12, offset: 0 } } } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const JOBS = [
  { id: 1, name: 'Desenvolvedor Salesforce Pleno', description: 'Atuar com Apex e Service Cloud na nossa indústria de alimentos.', careerPageName: 'Alimentos Exemplo S.A.', publishedDate: '2026-10-01T10:00:00Z', city: 'Campinas', state: 'São Paulo', jobUrl: 'https://alimentos.gupy.io/job/1?jobBoardSource=gupy_portal' },
  { id: 2, name: 'Arquiteto Salesforce', description: 'Liderar a implantação do Sales Cloud.', careerPageName: 'Grupo Alimentos Exemplo', publishedDate: '2026-07-01T10:00:00Z', city: 'Campinas', state: 'São Paulo', jobUrl: 'https://alimentos.gupy.io/job/2' },
  { id: 3, name: 'Consultor Salesforce', description: 'Somos uma consultoria especializada em Salesforce e atuamos em projetos para clientes.', careerPageName: 'Consultoria X', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://x.gupy.io/job/3' },
  { id: 4, name: 'Desenvolvedor Salesforce', description: 'Apex e LWC.', careerPageName: 'Confidencial', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://c.gupy.io/job/4' },
  { id: 5, name: 'Analista de Dados', description: 'Python e SQL.', careerPageName: 'Outra', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://o.gupy.io/job/5' },
  { id: 6, name: 'Admin Salesforce', description: 'Administração da org Sales Cloud em banco digital.', careerPageName: 'Cliente Atual Ltda', publishedDate: '2026-10-03T10:00:00Z', jobUrl: 'https://ca.gupy.io/job/6' },
];

function fakeFetch(routes: Record<string, { status: number; body: string }>, calls: string[] = []): FetchFn {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = routes[url] ?? { status: 404, body: '' };
    return new Response(hit.body, { status: hit.status });
  }) as FetchFn;
}

const noSleep = async () => {};

test('parseGupySearchPage lê vagas e total', () => {
  const p = parseGupySearchPage(gupyPage(JOBS, 40));
  assert.equal(p.jobs.length, 6);
  assert.equal(p.total, 40);
});

test('cliente HTTP bloqueia URL proibida pelo robots.txt e não faz a requisição', async () => {
  const calls: string[] = [];
  const client = new PoliteClient({
    fetchFn: fakeFetch({ 'https://site.com/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /privado' } }, calls),
    sleep: noSleep,
  });
  await assert.rejects(client.get('https://site.com/privado/x', 't'), RobotsDisallowedError);
  assert.deepEqual(calls, ['https://site.com/robots.txt']);
});

test('pipeline completo: coleta → contas → exclusões → nota → painel/CSV', async () => {
  const db = openDb(':memory:');
  const client = new PoliteClient({
    db,
    sleep: noSleep,
    fetchFn: fakeFetch({
      'https://portal.gupy.io/robots.txt': { status: 200, body: 'User-agent: *\nDisallow:' },
      'https://portal.gupy.io/job-search/term=salesforce': { status: 200, body: gupyPage(JOBS) },
    }),
  });

  const postings = await collectGupy(client, ['salesforce']);
  assert.equal(postings.length, 6);
  assert.equal(postings[0].url, 'https://alimentos.gupy.io/job/1'); // sem query string de rastreio

  // Lista de exclusão: "Cliente Atual" já é cliente.
  const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-')), 'clientes.csv');
  fs.writeFileSync(csv, 'nome;tipo\nCliente Atual;cliente\n');
  importExclusions(db, csv);

  const stats = ingestJobs(db, postings);
  assert.equal(stats.notSalesforce, 1);
  assert.equal(stats.unidentified, 1);
  assert.equal(stats.excluded, 1);
  assert.equal(stats.flaggedConsultancy, 1);

  // "Alimentos Exemplo S.A." e "Grupo Alimentos Exemplo" viram a mesma conta.
  assert.equal(scoreAll(db, NOW), 3);
  const rows = listCompanies(db, {});
  assert.deepEqual(rows.map((r) => r.name), ['Alimentos Exemplo S.A.', 'Consultoria X']);
  const top = rows[0];
  assert.equal(top.job_count, 2);
  assert.equal(top.sector, 'industria');

  const detail = getCompany(db, top.id)!;
  const rule = (name: string) => detail.breakdown.find((b) => b.rule === name)!;
  assert.equal(rule('Vaga Salesforce ativa').points, 25); // recente (20) + 2 vagas (5)
  assert.equal(rule('Setor-alvo').points, 8);              // inferido
  assert.equal(rule('Tecnologia Salesforce').points, 10);  // cloud citada em vaga
  assert.equal(top.total, 8 + 0 + 10 + 25 + 10 + 0);
  assert.deepEqual(detail.offers.map((o) => o.offer).sort(), ['Improve', 'Ágil']);
  for (const b of detail.breakdown) assert.ok(b.reason.length > 0, `regra ${b.rule} sem explicação`);

  // Consultoria recebe ajuste negativo e fica abaixo.
  const consult = getCompany(db, rows[1].id)!;
  assert.ok(consult.breakdown.some((b) => b.rule === 'Possível consultoria/recrutadora' && b.points === -30));

  // Excluída só aparece quando pedida.
  assert.ok(listCompanies(db, { excluidas: '1' }).some((r) => r.excluded_reason === 'cliente'));

  // Filtro por oferta.
  assert.deepEqual(listCompanies(db, { oferta: 'Ágil' }).map((r) => r.name), ['Alimentos Exemplo S.A.']);

  // Toda evidência tem fonte, link e data de coleta.
  for (const s of detail.signals) {
    assert.ok(s.url.startsWith('https://'));
    assert.equal(s.source, 'gupy');
    assert.ok(s.collected_at);
  }
  // Cada página buscada foi registrada.
  assert.equal((db.prepare('SELECT count(*) n FROM source_documents').get() as { n: number }).n, 1);

  // Painel e CSV renderizam e escapam HTML.
  assert.match(listPage(rows, {}, []), /Alimentos Exemplo/);
  assert.match(detailPage(detail), /Por que essa nota/);
  const out = exportCsv(db, {});
  assert.match(out, /Alimentos Exemplo S\.A\.;53;/);

  // Coletar de novo não duplica sinais.
  const again = ingestJobs(db, postings);
  assert.equal(again.newSignals, 0);
});
