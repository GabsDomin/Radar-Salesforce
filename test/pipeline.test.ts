import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db/index.ts';
import { PoliteClient, RobotsDisallowedError, type FetchFn } from '../src/http/client.ts';
import { collectGupy, parseGupySearchPage } from '../src/sources/gupy.ts';
import { ingestJobs, purgeConsultancies } from '../src/pipeline/ingestJobs.ts';
import { importExclusions } from '../src/pipeline/exclusions.ts';
import { scoreAll, scoreCompany } from '../src/scoring/score.ts';
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
  { id: 7, name: 'Admin Salesforce', description: 'Cuidar da org e atender nossos clientes internos de varejo.', careerPageName: 'Varejo Y', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://y.gupy.io/job/7' },
  { id: 8, name: 'Desenvolvedor Salesforce', description: 'Apex e LWC.', careerPageName: 'Soluções Tech Consultoria', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://s.gupy.io/job/8' },
  { id: 9, name: 'Desenvolvedor Salesforce', description: 'Apex e LWC.', careerPageName: 'Empresa Gringa', country: 'United States', publishedDate: '2026-10-02T10:00:00Z', jobUrl: 'https://g.gupy.io/job/9' },
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
  assert.equal(p.jobs.length, 9);
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
  assert.equal(postings.length, 8); // a vaga fora do Brasil já é descartada na coleta
  assert.equal(postings[0].url, 'https://alimentos.gupy.io/job/1'); // sem query string de rastreio

  // Lista de exclusão: "Cliente Atual" já é cliente.
  const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-')), 'clientes.csv');
  fs.writeFileSync(csv, 'nome;tipo\nCliente Atual;cliente\n');
  importExclusions(db, csv);

  const stats = ingestJobs(db, postings);
  assert.equal(stats.notSalesforce, 1);
  assert.equal(stats.unidentified, 1);
  assert.equal(stats.excluded, 1);
  assert.equal(stats.flaggedConsultancy, 1);    // indício fraco ("nossos clientes"): fica, marcada
  assert.equal(stats.skippedConsultancy, 2);    // indício forte na vaga e no nome da empresa: descartadas

  // "Alimentos Exemplo S.A." e "Grupo Alimentos Exemplo" viram a mesma conta.
  assert.equal(scoreAll(db, NOW), 3);
  const rows = listCompanies(db, {});
  assert.deepEqual(rows.map((r) => r.name), ['Alimentos Exemplo S.A.', 'Varejo Y']);
  const top = rows[0];
  assert.equal(top.job_count, 2);
  assert.equal(top.sector, 'industria');

  const detail = getCompany(db, top.id)!;
  const rule = (name: string) => detail.breakdown.find((b) => b.rule === name)!;
  assert.equal(rule('Vaga Salesforce aberta').points, 40); // aberta (10) + 97 dias aberta (25) + 2 vagas (5)
  assert.equal(rule('Setor-alvo').points, 8);              // inferido
  assert.equal(rule('Tecnologia Salesforce').points, 10);  // cloud citada em vaga
  assert.equal(top.total, 8 + 0 + 10 + 40 + 10 + 0);
  assert.deepEqual(detail.offers.map((o) => o.offer).sort(), ['Improve', 'Ágil']);
  for (const b of detail.breakdown) assert.ok(b.reason.length > 0, `regra ${b.rule} sem explicação`);

  // Indício fraco de consultoria recebe ajuste negativo e fica abaixo; as fortes nem entram.
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
  assert.match(out, /Alimentos Exemplo S\.A\.;68;/);

  // Coletar de novo não duplica sinais.
  const again = ingestJobs(db, postings);
  assert.equal(again.newSignals, 0);
});

test('Greenhouse, Lever, Workable, Ashby e Workday: filtram CRM na América Latina e viram vagas comuns', async () => {
  const { parseBoards, collectBoards } = await import('../src/sources/boards.ts');
  const boards = parseBoards([
    { fonte: 'greenhouse', slug: 'acme', empresa: 'Acme Indústria' },
    { fonte: 'lever', slug: 'banco', empresa: 'Banco Exemplo' },
    { fonte: 'workable', slug: 'agro', empresa: 'Agro Exemplo' },
    { fonte: 'ashby', slug: 'fin', empresa: 'Fin Exemplo' },
    { fonte: 'workday', slug: 'ind|wd3|Externo', empresa: 'Indústria WD' },
    { fonte: 'lever', slug: 'quebrado', empresa: 'Quebrado' },
    { fonte: 'smartrecruiters', slug: 'x', empresa: 'Ignorada (bloqueada)' },
  ]);
  assert.equal(boards.length, 6);
  const gh = { jobs: [
    { id: 1, title: 'Salesforce Developer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', updated_at: '2026-10-01T00:00:00Z', location: { name: 'São Paulo, Brazil' }, content: '&lt;p&gt;Apex e LWC&lt;/p&gt;' },
    { id: 2, title: 'Salesforce Developer', absolute_url: 'https://boards.greenhouse.io/acme/jobs/2', location: { name: 'Austin, TX' }, content: '' },
    { id: 3, title: 'Contador', absolute_url: 'https://boards.greenhouse.io/acme/jobs/3', location: { name: 'São Paulo' }, content: '' },
  ] };
  const lever = [{ id: 'abc', text: 'Admin Salesforce', hostedUrl: 'https://jobs.lever.co/banco/abc', createdAt: 1790000000000, descriptionPlain: 'Sales Cloud', categories: { location: 'Brasil' } }];
  const wk = { jobs: [
    { title: 'Salesforce Architect', shortcode: 'AB1', url: 'https://apply.workable.com/agro/j/AB1/', published_on: '2026-10-02', locations: [{ countryCode: 'BR', city: 'Campinas', region: 'SP' }], description: '<p>Sales Cloud</p>' },
    { title: 'Salesforce Architect', shortcode: 'AB2', locations: [{ countryCode: 'US', city: 'Austin' }] },
  ] };
  const ashby = { jobs: [{ id: 'z9', title: 'CRM Analyst (HubSpot)', descriptionPlain: 'HubSpot e RevOps', jobUrl: 'https://jobs.ashbyhq.com/fin/z9', address: { postalAddress: { addressCountry: 'Mexico', addressLocality: 'Ciudad de México' } } }] };
  const wd = (title: string, path: string) => ({ total: 1, jobPostings: [{ title, externalPath: path, locationsText: 'São Paulo, Brazil' }] });
  const ok = (b: unknown) => ({ status: 200, body: JSON.stringify(b) });
  const calls: string[] = [];
  const base = fakeFetch({
    'https://boards-api.greenhouse.io/robots.txt': { status: 404, body: '' },
    'https://api.lever.co/robots.txt': { status: 404, body: '' },
    'https://apply.workable.com/robots.txt': { status: 404, body: '' },
    'https://api.ashbyhq.com/robots.txt': { status: 404, body: '' },
    'https://ind.wd3.myworkdayjobs.com/robots.txt': { status: 404, body: '' },
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true': ok(gh),
    'https://api.lever.co/v0/postings/banco?mode=json': ok(lever),
    'https://apply.workable.com/api/v1/widget/accounts/agro?details=true': ok(wk),
    'https://api.ashbyhq.com/posting-api/job-board/fin': ok(ashby),
    'https://api.lever.co/v0/postings/quebrado?mode=json': { status: 200, body: 'não é json' },
  }, calls);
  // Workday: a mesma URL responde por termo de busca enviado no corpo (POST).
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === 'https://ind.wd3.myworkdayjobs.com/wday/cxs/ind/Externo/jobs') {
      assert.equal(init?.method, 'POST');
      const term = JSON.parse(String(init?.body)).searchText;
      return new Response(JSON.stringify(term === 'salesforce' ? wd('Analista Salesforce', '/job/SP/Analista_1') : wd('Analista Salesforce', '/job/SP/Analista_1')), { status: 200 });
    }
    return base(input, init);
  }) as typeof fetch;
  const client = new PoliteClient({ sleep: noSleep, fetchFn });
  const logs: string[] = [];
  const postings = await collectBoards(client, boards, (m) => logs.push(m));
  assert.deepEqual(postings.map((p) => [p.source, p.companyName, p.title, p.country]), [
    ['greenhouse', 'Acme Indústria', 'Salesforce Developer', 'BR'],
    ['lever', 'Banco Exemplo', 'Admin Salesforce', 'BR'],
    ['workable', 'Agro Exemplo', 'Salesforce Architect', 'BR'],
    ['ashby', 'Fin Exemplo', 'CRM Analyst (HubSpot)', 'MX'],
    ['workday', 'Indústria WD', 'Analista Salesforce', 'BR'], // dois termos, uma vaga só
  ]);
  assert.equal(postings[4].url, 'https://ind.wd3.myworkdayjobs.com/Externo/job/SP/Analista_1');
  assert.equal(postings[0].description, 'Apex e LWC');
  assert.ok(logs.some((l) => l.includes('quebrado falhou')));

  const db = openDb(':memory:');
  const stats = ingestJobs(db, postings);
  assert.equal(stats.notSalesforce, 0);
});

test('site estático: gera lista, detalhe e CSV sem formulário de edição', async () => {
  const { buildStaticSite } = await import('../src/web/static.ts');
  const db = openDb(':memory:');
  ingestJobs(db, [{ source: 'gupy', externalId: '1', title: 'Desenvolvedor Salesforce', description: 'Apex e Service Cloud em indústria.', companyName: 'Alimentos Exemplo S.A.', url: 'https://a.gupy.io/job/1', publishedAt: '2026-10-01T10:00:00Z', city: null, state: null, country: 'BR', documentId: null }]);
  scoreAll(db, NOW);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-site-')), 'public');
  const r = buildStaticSite(db, out);
  assert.equal(r.companies, 1);
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(index, /Alimentos Exemplo/);
  assert.match(index, /data-nota=/);
  assert.match(index, /radar\.csv/);
  const id = (db.prepare('SELECT id FROM companies').get() as { id: number }).id;
  const detail = fs.readFileSync(path.join(out, 'empresa', `${id}.html`), 'utf8');
  assert.match(detail, /Por que essa nota/);
  assert.doesNotMatch(detail, /<form/);
  assert.match(fs.readFileSync(path.join(out, 'radar.csv'), 'utf8'), /Alimentos Exemplo/);
});

test('somente Brasil e sem consultorias: vaga de fora, nome de consultoria e limpeza do que já estava no banco', () => {
  const db = openDb(':memory:');
  const base = { source: 'gupy', description: 'Apex e LWC em indústria.', publishedAt: '2026-10-01T10:00:00Z', city: null, state: null, documentId: null };
  const stats = ingestJobs(db, [
    { ...base, externalId: 'a', title: 'Dev Salesforce', companyName: 'Fabrica Brasil S.A.', url: 'https://a/1', country: 'BR' },
    { ...base, externalId: 'b', title: 'Dev Salesforce', companyName: 'Fabrica Foreign Inc', url: 'https://a/2', country: 'US' },
    { ...base, externalId: 'c', title: 'Dev Salesforce', companyName: 'Alfa Consulting', url: 'https://a/3', country: 'BR' },
  ]);
  assert.equal(stats.outOfRegion, 1);
  assert.equal(stats.skippedConsultancy, 1);
  assert.equal(stats.newSignals, 1);
  assert.deepEqual((db.prepare('SELECT name FROM companies').all() as { name: string }[]).map((r) => r.name), ['Fabrica Brasil S.A.']);

  // Dado antigo: sinal marcado como consultoria forte some, e a conta órfã também; conta com acompanhamento fica.
  db.prepare("INSERT INTO companies (name, normalized_name) VALUES ('Antiga Consultoria', 'antiga consultoria')").run();
  db.prepare("INSERT INTO companies (name, normalized_name, notes) VALUES ('Antiga Anotada', 'antiga anotada', 'falei com o diretor')").run();
  const ins = db.prepare("INSERT INTO signals (company_id, type, title, url, source, external_id, review_flag) VALUES (?, 'vaga', 't', 'https://x', 'gupy', ?, 'possível consultoria/recrutadora: vaga de alocação')");
  ins.run((db.prepare("SELECT id FROM companies WHERE name = 'Antiga Consultoria'").get() as { id: number }).id, 'old1');
  ins.run((db.prepare("SELECT id FROM companies WHERE name = 'Antiga Anotada'").get() as { id: number }).id, 'old2');
  const purged = purgeConsultancies(db);
  assert.equal(purged.signals, 2);
  assert.deepEqual((db.prepare('SELECT name FROM companies ORDER BY name').all() as { name: string }[]).map((r) => r.name), ['Antiga Anotada', 'Fabrica Brasil S.A.']);
});

test('vaga aberta há mais tempo dá nota maior; fechada, banco de talentos e permanente valem pouco', () => {
  const NOW2 = new Date('2026-11-13T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW2.getTime() - n * 86_400_000).toISOString();
  const job = (id: number, title: string, published: number, seen = 0) => ({
    id, type: 'vaga', subtype: 'developer', title, source: 'gupy', published_at: daysAgo(published),
    collected_at: daysAgo(published), last_seen_at: daysAgo(seen), meta: JSON.stringify({ salesforce: true, country: 'BR' }), review_flag: null,
  });
  const company = { sector: 'industria', sector_source: 'CNAE', size_band: '100+', size_source: 'Receita' };
  const pts = (signals: ReturnType<typeof job>[]) =>
    scoreCompany(company, signals, NOW2).breakdown.find((b) => b.rule === 'Vaga Salesforce aberta')!;
  assert.equal(pts([job(1, 'Dev Salesforce', 3)]).points, 10);
  assert.equal(pts([job(1, 'Dev Salesforce', 20)]).points, 17);
  assert.equal(pts([job(1, 'Dev Salesforce', 35)]).points, 24);
  assert.equal(pts([job(1, 'Dev Salesforce', 50)]).points, 30);
  assert.equal(pts([job(1, 'Dev Salesforce', 75)]).points, 35);
  assert.match(pts([job(1, 'Dev Salesforce', 75)]).reason, /aberta há 75 dias: difícil de contratar/);
  assert.equal(pts([job(1, 'Dev Salesforce', 75), job(2, 'Admin Salesforce', 5)]).points, 40); // + várias vagas
  // Não contam como vaga aberta:
  assert.equal(pts([job(1, 'Dev Salesforce', 75, 40)]).points, 3);                      // sumiu da fonte há 40 dias
  assert.equal(pts([job(1, 'Banco de Talentos Salesforce', 75)]).points, 3);           // não é contratação
  assert.equal(pts([job(1, 'Dev Salesforce', 400)]).points, 3);                         // "permanente"
  // Vaga de outra área que só cita Salesforce: conta uso, sem bônus por tempo.
  assert.equal(pts([{ ...job(1, 'Analista de Comunicação', 75), subtype: 'outro' }]).points, 8);
  // Mesmo perfil: a empresa com vaga antiga fica acima da empresa com vaga nova.
  assert.ok(scoreCompany(company, [job(1, 'Dev Salesforce', 75)], NOW2).total > scoreCompany(company, [job(1, 'Dev Salesforce', 3)], NOW2).total);
});
