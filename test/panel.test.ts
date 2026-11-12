import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db/index.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { dashboardData } from '../src/web/dashboard.ts';
import { dashboardPage, updatePage } from '../src/web/pages.ts';
import { createServer } from '../src/web/server.ts';
import { UpdateRunner } from '../src/web/jobs.ts';

function seed() {
  const db = openDb(':memory:');
  ingestJobs(db, [
    { source: 'gupy', externalId: '1', title: 'Desenvolvedor Salesforce', description: 'Apex e Service Cloud na indústria de alimentos.', companyName: 'Alimentos Exemplo S.A.', url: 'https://a/1', publishedAt: new Date().toISOString(), city: null, state: null, country: 'BR', documentId: null },
  ]);
  scoreAll(db);
  return db;
}

test('dashboard resume contas, setores, ofertas e funil', () => {
  const d = dashboardData(seed());
  assert.equal(d.totals.accounts, 1);
  assert.equal(d.totals.jobsActive, 1);
  assert.equal(d.bySector[0].label, 'Indústria');
  assert.equal(d.funnel.find((f) => f.stage === 'radar')?.count, 1);
  assert.equal(d.scoreBuckets.reduce((a, b) => a + b.count, 0), 1);
  const html = dashboardPage(d);
  assert.match(html, /Alimentos Exemplo/);
  assert.match(html, /href="\/atualizar"/);
  assert.doesNotMatch(dashboardPage(d, true), /href="\/atualizar"/); // versão publicada não tem atualizar
});

test('rotas: dashboard, status e execução com bloqueio de outra origem', async () => {
  const db = seed();
  const runner = new UpdateRunner(db);
  const server = createServer(db, runner).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + '/dashboard')).status, 200);
    const page = await (await fetch(base + '/atualizar')).text();
    assert.match(page, /Atualizar agora/);
    assert.match(updatePage(runner.state, 30), /Publicar na Vercel/);
    const status = await (await fetch(base + '/atualizar/status')).json() as { running: boolean };
    assert.equal(status.running, false);

    const foreign = await fetch(base + '/atualizar/executar', { method: 'POST', body: 'step=site', headers: { Origin: 'http://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(foreign.status, 403);
    const none = await fetch(base + '/atualizar/executar', { method: 'POST', body: 'step=invalida', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(none.status, 409); // nenhuma etapa válida
  } finally {
    server.close();
  }
});

test('dor entra na nota (bônus até 15), vira selo na lista e sugere oferta', async () => {
  const { getCompany, listCompanies } = await import('../src/web/queries.ts');
  const { listPage } = await import('../src/web/views.ts');
  const db = openDb(':memory:');
  const base = { source: 'gupy', publishedAt: new Date().toISOString(), city: null, state: null, country: 'BR', documentId: null };
  ingestJobs(db, [
    { ...base, externalId: '1', title: 'Dev Salesforce', description: 'Migração do RD Station para Salesforce e fim dos controles em planilhas. Indústria de alimentos.', companyName: 'Com Dor S.A.', url: 'https://a/1' },
    { ...base, externalId: '2', title: 'Dev Salesforce', description: 'Apex e LWC. Indústria de alimentos.', companyName: 'Sem Dor S.A.', url: 'https://a/2' },
  ]);
  scoreAll(db);
  const rows = listCompanies(db, {});
  const com = getCompany(db, rows.find((r) => r.name === 'Com Dor S.A.')!.id)!;
  const sem = getCompany(db, rows.find((r) => r.name === 'Sem Dor S.A.')!.id)!;
  const dor = com.breakdown.find((b) => b.group === 'dor')!;
  assert.equal(dor.points, 15); // migração (15) + processo manual (3), com teto de 15
  assert.match(dor.reason, /rd station/i);
  assert.equal(sem.breakdown.find((b) => b.group === 'dor')!.points, 0);
  // +15 de dor e +12 de CRM concorrente (a vaga cita RD Station).
  assert.equal(com.company.total! - sem.company.total!, 27);
  assert.equal(com.breakdown.find((b) => b.rule === 'Usa CRM concorrente')!.points, 12);
  assert.ok(com.offers.some((o) => o.offer === 'Ágil' && o.reasons.some((r) => r.includes('troca de sistema'))));
  assert.match(listPage(rows, {}, []), /class="chip pain"/);
  assert.equal(dashboardData(db).totals.withPain, 1);
});

test('modalidades: cada tela mostra só o seu tipo de sinal', async () => {
  const { modalityRows, modalityCounts, MODALITIES, lastRunOf } = await import('../src/web/modalities.ts');
  const { modalityPage } = await import('../src/web/pages.ts');
  const { ingestNews } = await import('../src/pipeline/ingestNews.ts');
  const db = openDb(':memory:');
  const base = { source: 'gupy', publishedAt: new Date().toISOString(), city: null, state: null, country: 'BR', documentId: null };
  ingestJobs(db, [
    { ...base, externalId: '1', title: 'Dev Salesforce', description: 'Migração do RD Station para Salesforce. Indústria de alimentos.', companyName: 'Alfa Alimentos S.A.', url: 'https://a/1' },
    { ...base, externalId: '2', title: 'Dev Salesforce', description: 'Apex e LWC. Indústria de alimentos.', companyName: 'Beta Alimentos S.A.', url: 'https://a/2' },
  ]);
  const alfa = (db.prepare("SELECT id FROM companies WHERE name LIKE 'Alfa%'").get() as { id: number }).id;
  const item = (title: string, url: string) => ({ title, url, domain: 'jornal.com', publishedAt: new Date().toISOString(), documentId: null });
  ingestNews(db, [
    { companyId: alfa, companyName: 'Alfa Alimentos', item: item('Alfa Alimentos nomeia novo diretor de TI', 'https://j/1'), classification: { kind: 'lideranca', area: 'tecnologia', mentionsSalesforce: false } },
    { companyId: alfa, companyName: 'Alfa Alimentos', item: item('Alfa Alimentos adquire concorrente', 'https://j/2'), classification: { kind: 'fusao', area: null, mentionsSalesforce: false } },
  ]);
  scoreAll(db);

  assert.equal(modalityRows(db, 'vagas').length, 2);
  assert.equal(modalityRows(db, 'lideranca').length, 1);
  assert.equal(modalityRows(db, 'gatilhos').length, 1);
  assert.equal(modalityRows(db, 'dor').length, 1);                       // só a vaga com migração de CRM
  assert.equal(modalityRows(db, 'lideranca')[0].title, 'Alfa Alimentos nomeia novo diretor de TI'); // sem o prefixo interno
  assert.deepEqual(modalityRows(db, 'lideranca')[0].tags, ['área: tecnologia']);
  assert.equal(modalityRows(db, 'vagas', { q: 'beta' }).length, 1);
  assert.equal(modalityRows(db, 'vagas', { min: '99' }).length, 0);
  assert.equal(modalityRows(db, 'vagas')[0].company, 'Alfa Alimentos S.A.'); // maior nota primeiro (tem dor)
  const counts = modalityCounts(db);
  assert.deepEqual([counts.vagas.total, counts.lideranca.total, counts.gatilhos.total, counts.dor.total], [2, 1, 1, 1]);
  assert.equal(dashboardData(db).modalities.lideranca.companies, 1);

  const info = MODALITIES.find((m) => m.id === 'lideranca')!;
  const html = modalityPage(info, modalityRows(db, 'lideranca'), lastRunOf(db, 'noticias'));
  assert.match(html, /Mudança de liderança/);
  assert.match(html, /nomeia novo diretor de TI/);
  assert.match(html, /href="\/atualizar"/);
  assert.doesNotMatch(modalityPage(info, [], null, true), /href="\/atualizar"/);

  const server = createServer(db, new UpdateRunner(db)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base2 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const m of MODALITIES) assert.equal((await fetch(`${base2}/radar/${m.id}`)).status, 200);
    assert.equal((await fetch(`${base2}/radar/inexistente`)).status, 404);
  } finally {
    server.close();
  }
});

test('site estático inclui uma página por modalidade, sem o botão de atualizar', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildStaticSite } = await import('../src/web/static.ts');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-mod-')), 'public');
  buildStaticSite(seed(), out);
  for (const id of ['vagas', 'lideranca', 'gatilhos', 'dor']) {
    const html = fs.readFileSync(path.join(out, 'radar', `${id}.html`), 'utf8');
    assert.doesNotMatch(html, /href="\/atualizar"/);
  }
  assert.match(fs.readFileSync(path.join(out, 'radar', 'vagas.html'), 'utf8'), /Alimentos Exemplo/);
});

test('favicon: linkado em todas as páginas, servido no painel local e incluído no site', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildStaticSite } = await import('../src/web/static.ts');
  const db = seed();
  assert.match(dashboardPage(dashboardData(db)), /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);

  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-fav-')), 'public');
  buildStaticSite(db, out);
  const svg = fs.readFileSync(path.join(out, 'favicon.svg'), 'utf8');
  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

  const server = createServer(db, new UpdateRunner(db)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/favicon.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
  } finally {
    server.close();
  }
});
