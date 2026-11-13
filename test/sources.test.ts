import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteClient, type FetchFn } from '../src/http/client.ts';
import { parseGetonbrd, collectGetonbrd, searchUrl, gobCountry } from '../src/sources/getonbrd.ts';
import { discoverBoards, slugCandidates } from '../src/sources/discoverBoards.ts';
import { openDb } from '../src/db/index.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';

function fakeFetch(routes: Record<string, { status: number; body: string }>, calls: string[] = []): FetchFn {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    const hit = routes[String(input)] ?? { status: 404, body: '' };
    return new Response(hit.body, { status: hit.status });
  }) as FetchFn;
}

const gobJob = (id: string, title: string, company: string, countries: string[], description = '') => ({
  id, type: 'job',
  attributes: { title, description, countries, published_at: 1793715519, company: { data: { attributes: { name: company } } } },
  links: { public_url: `https://www.getonbrd.com/jobs/${id}` },
});

test('Get on Board: lê vagas, país da América Latina e ignora "Remote"/EUA', () => {
  assert.equal(gobCountry(['Chile']), 'CL');
  assert.equal(gobCountry(['Remote', 'Mexico']), 'MX');
  assert.equal(gobCountry(['Remote']), null);
  assert.equal(gobCountry(['United States']), null);

  const body = JSON.stringify({ meta: { total_pages: 2 }, data: [
    gobJob('a-1', 'Business Analytics – Salesforce & CRM', 'BICE VIDA', ['Chile'], '<p>Seguros de vida. <strong>Salesforce</strong> Sales Cloud.</p>'),
    gobJob('b-2', 'Senior Account Manager', 'Devsu', ['United States'], 'Salesforce CRM'),
  ] });
  const { postings, totalPages } = parseGetonbrd(body, 7);
  assert.equal(totalPages, 2);
  assert.deepEqual(postings.map((p) => [p.companyName, p.country]), [['BICE VIDA', 'CL'], ['Devsu', 'desconhecido']]);
  assert.equal(postings[0].description, 'Seguros de vida. Salesforce Sales Cloud.');
  assert.equal(postings[0].url, 'https://www.getonbrd.com/jobs/a-1');
  assert.ok(postings[0].publishedAt!.startsWith('2026-'));

  const stats = ingestJobs(openDb(':memory:'), postings);
  assert.equal(stats.outOfRegion, 1); // Devsu (EUA) fica de fora
  assert.equal(stats.newSignals, 1);
});

test('Get on Board: pagina até o limite e não para a coleta em erro', async () => {
  const page = (p: number) => JSON.stringify({ meta: { total_pages: 9 }, data: [gobJob(`j${p}`, 'Dev Salesforce', 'Alfa', ['Chile'])] });
  const routes: Record<string, { status: number; body: string }> = {
    'https://www.getonbrd.com/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
    [searchUrl('salesforce', 1)]: { status: 200, body: page(1) },
    [searchUrl('salesforce', 2)]: { status: 200, body: page(2) },
    [searchUrl('salesforce', 3)]: { status: 200, body: page(3) },
    [searchUrl('apex', 1)]: { status: 200, body: 'isto não é json' },
  };
  const calls: string[] = [];
  const logs: string[] = [];
  const out = await collectGetonbrd(new PoliteClient({ sleep: async () => {}, fetchFn: fakeFetch(routes, calls) }), ['salesforce', 'apex'], (m) => logs.push(m));
  assert.equal(out.length, 3);                                  // máximo de 3 páginas por termo
  assert.ok(!calls.includes(searchUrl('salesforce', 4)));
  assert.ok(logs.some((l) => l.includes('"apex" falhou')));
});

test('descoberta de quadros: testa slugs, grava só o que é quadro de verdade e não repete os conhecidos', async () => {
  assert.deepEqual(slugCandidates('Grupo Boticário'), ['grupoboticario', 'grupo-boticario']);
  assert.deepEqual(slugCandidates('Nubank'), ['nubank']);
  const routes: Record<string, { status: number; body: string }> = {
    'https://boards-api.greenhouse.io/robots.txt': { status: 404, body: '' },
    'https://api.lever.co/robots.txt': { status: 404, body: '' },
    'https://boards-api.greenhouse.io/v1/boards/nubank/jobs': { status: 200, body: JSON.stringify({ jobs: [] }) },
    'https://api.lever.co/v0/postings/grupo-boticario?mode=json&limit=1': { status: 200, body: '[]' },
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs': { status: 200, body: '<html>não é API</html>' },
  };
  const calls: string[] = [];
  const found = await discoverBoards(
    new PoliteClient({ sleep: async () => {}, fetchFn: fakeFetch(routes, calls) }),
    ['Nubank', 'Grupo Boticário', 'Acme', 'Stone'],
    [{ kind: 'greenhouse', slug: 'stone', company: 'Stone' }],
  );
  assert.deepEqual(found.map((b) => `${b.kind}/${b.slug}`), ['greenhouse/nubank', 'lever/grupo-boticario']);
  assert.ok(!calls.includes('https://boards-api.greenhouse.io/v1/boards/stone/jobs')); // já conhecido
});

test('Get on Board: consultoria que se apresenta na descrição da empresa é descartada', () => {
  const job = gobJob('c-1', 'Salesforce Developer', 'BC Tecnología', ['Chile'], 'Apex y Sales Cloud.');
  (job.attributes.company.data.attributes as { description?: string }).description = 'Somos una consultora de TI con personal experto.';
  const { postings } = parseGetonbrd(JSON.stringify({ data: [job] }), null);
  assert.match(postings[0].description, /Sobre a empresa: Somos una consultora de TI/);
  assert.equal(ingestJobs(openDb(':memory:'), postings).skippedConsultancy, 1);
});

test('sistema de vagas pelo site: links de ATS na home ou na página de carreiras', async () => {
  const { findAtsLinks, careersLinks, discoverAtsFromSite } = await import('../src/sources/atsFromSite.ts');
  const { appendBoards, readBoards } = await import('../src/pipeline/boardsDiscovery.ts');
  assert.deepEqual(findAtsLinks(`
    <a href="https://boards.greenhouse.io/alfa">vagas</a>
    <a href="https://jobs.lever.co/beta/123">x</a>
    <a href="https://alfa.wd3.myworkdayjobs.com/pt-BR/Externo/job/SP">wd</a>
    <a href="https://apply.workable.com/gama/">wk</a>
    <a href="https://jobs.ashbyhq.com/delta">ashby</a>`).map((x) => `${x.kind}/${x.slug}`),
  ['greenhouse/alfa', 'lever/beta', 'workable/gama', 'ashby/delta', 'workday/alfa|wd3|Externo']);
  assert.deepEqual(careersLinks('<a href="/trabalhe-conosco">Trabalhe conosco</a><a href="/sobre">Sobre</a>', 'https://www.alfa.com.br/'),
    ['https://www.alfa.com.br/trabalhe-conosco']);

  const client = new PoliteClient({ sleep: async () => {}, fetchFn: fakeFetch({
    'https://www.alfa.com.br/robots.txt': { status: 404, body: '' },
    'https://www.alfa.com.br/': { status: 200, body: '<a href="/carreiras">Carreiras</a>' },
    'https://www.alfa.com.br/carreiras': { status: 200, body: '<iframe src="https://alfa.wd5.myworkdayjobs.com/AlfaCareers"></iframe>' },
  }) });
  const boards = await discoverAtsFromSite(client, 'alfa.com.br', 'Alfa');
  assert.deepEqual(boards, [{ kind: 'workday', slug: 'alfa|wd5|AlfaCareers', company: 'Alfa' }]);

  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-q-')), 'quadros.csv');
  fs.writeFileSync(file, 'fonte;slug;empresa\ngreenhouse;alfa;Alfa\n');
  assert.equal(appendBoards([{ kind: 'greenhouse', slug: 'alfa', company: 'Alfa' }, ...boards], file), 1); // não repete o que já existe
  assert.deepEqual(readBoards(file).map((b) => `${b.kind}/${b.slug}`), ['greenhouse/alfa', 'workday/alfa|wd5|AlfaCareers']);
});

test('alertas do LinkedIn por e-mail: título, empresa, local e link de cada vaga (sem acessar o LinkedIn)', async () => {
  const { parseLinkedInAlert, decodeQuotedPrintable } = await import('../src/sources/linkedinAlerts.ts');
  assert.equal(decodeQuotedPrintable('Integra=C3=A7=C3=A3o=\nSalesforce'), 'IntegraçãoSalesforce');
  const email = [
    'Suas vagas para "salesforce"',
    '',
    'Desenvolvedor Salesforce Sênior',
    'Alfa Alimentos',
    'São Paulo, Brasil',
    'Candidatura simplificada',
    'Ver vaga: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc',
    '',
    'Salesforce Admin',
    'Andes Seguros',
    'Santiago, Región Metropolitana, Chile',
    'https://www.linkedin.com/comm/jobs/view/4012345679/?refId=x',
    '',
    'Salesforce Architect',
    'Texas Corp',
    'Austin, Texas, United States',
    'https://www.linkedin.com/comm/jobs/view/4012345680/',
  ].join('\n');
  const jobs = parseLinkedInAlert(email, '2026-11-10T09:00:00Z');
  assert.deepEqual(jobs.map((j) => [j.title, j.companyName, j.country]), [
    ['Desenvolvedor Salesforce Sênior', 'Alfa Alimentos', 'BR'],
    ['Salesforce Admin', 'Andes Seguros', 'CL'],
    ['Salesforce Architect', 'Texas Corp', 'desconhecido'],
  ]);
  assert.equal(jobs[0].url, 'https://www.linkedin.com/jobs/view/4012345678/'); // sem rastreio
  const stats = ingestJobs(openDb(':memory:'), jobs);
  assert.deepEqual([stats.newSignals, stats.outOfRegion], [2, 1]);
});
