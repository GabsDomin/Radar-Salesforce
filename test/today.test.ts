import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { decide } from '../src/pipeline/decisions.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { todayData, todayPage, coSellCsv } from '../src/web/today.ts';
import { draftMessage } from '../src/outreach/draft.ts';
import { visaoCounts, getCompany } from '../src/web/queries.ts';
import { detailPage } from '../src/web/views.ts';

const NOW = new Date('2026-11-12T12:00:00Z');

function seed() {
  const db = openDb(':memory:');
  const base = { source: 'gupy', city: 'São Paulo', state: 'São Paulo', country: 'BR', documentId: null };
  ingestJobs(db, [
    // Improve: vaga técnica aberta há 50 dias
    { ...base, externalId: '1', title: 'Desenvolvedor Salesforce', description: 'Apex e Service Cloud na indústria.', companyName: 'Alfa Indústria', url: 'https://a/1', publishedAt: '2026-09-23T12:00:00Z' },
    // Ágil: vaga pede HubSpot
    { ...base, externalId: '2', title: 'Analista de CRM', description: 'Gestão do HubSpot.', companyName: 'Beta Seguros', url: 'https://a/2', publishedAt: '2026-11-01T12:00:00Z' },
  ]);
  // Keep: já usa Salesforce (caso publicado), sem vaga
  db.prepare("INSERT INTO companies (name, normalized_name) VALUES ('Gama Alimentos', 'gama alimentos')").run();
  const gama = (db.prepare("SELECT id FROM companies WHERE name = 'Gama Alimentos'").get() as { id: number }).id;
  db.prepare(`INSERT INTO signals (company_id, type, subtype, title, url, source, external_id, meta)
    VALUES (?, 'tecnologia', 'salesforce', 'Salesforce (caso de cliente publicado)', 'https://www.salesforce.com/br/customer-stories/gama/', 'salesforce-casos', 'g1', ?)`)
    .run(gama, JSON.stringify({ vendor: 'Salesforce (caso de cliente publicado)', vendorKind: 'salesforce', how: 'caso publicado' }));
  scoreAll(db, NOW);
  const id = (n: string) => (db.prepare('SELECT id FROM companies WHERE name = ?').get(n) as { id: number }).id;
  return { db, id };
}

test('Hoje separa por oferta: vaga aberta → Improve, CRM concorrente → Ágil, base instalada → Keep', () => {
  const { db } = seed();
  // As vagas foram vistas "agora"; NOW fica alguns dias depois da coleta real do teste, então uso a data atual.
  const d = todayData(db);
  assert.deepEqual(d.improve.map((i) => i.name), ['Alfa Indústria']);
  assert.match(d.improve[0].reason, /Vaga "Desenvolvedor Salesforce" aberta há \d+ dia/);
  assert.deepEqual(d.agil.map((i) => i.name), ['Beta Seguros']);
  assert.match(d.agil[0].reason, /Usa HubSpot \(citado na vaga "Analista de CRM"\)/);
  assert.deepEqual(d.keep.map((i) => i.name), ['Gama Alimentos']);
  assert.equal(d.installedBase, 1);
  assert.match(d.improve[0].draft.body, /Alfa Indústria/);
  assert.match(d.agil[0].draft.subject, /HubSpot → Salesforce na Beta Seguros/);

  const html = todayPage(d);
  assert.match(html, /Improve: alocação para quem está contratando/);
  assert.match(html, /Rascunho de mensagem/);
  assert.match(html, /data-decide="aprovar"/);
  assert.doesNotMatch(todayPage(d, true), /data-decide=/); // site publicado: só leitura

  const csv = coSellCsv(db);
  assert.match(csv, /^﻿empresa;cnpj;setor/);
  assert.match(csv, /Alfa Indústria;.*;Improve;/);
});

test('abordagem: Contatei → Respondeu → Reunião; sai das listas e entra em retornos; histórico registra', () => {
  const { db, id } = seed();
  decide(db, id('Alfa Indústria'), { action: 'contatei', note: 'e-mail para o gestor de TI' });
  let d = todayData(db);
  assert.ok(!d.improve.some((i) => i.name === 'Alfa Indústria'));
  assert.deepEqual(d.followUps.map((f) => [f.name, f.outreach]), [['Alfa Indústria', 'contatado']]);
  assert.equal(visaoCounts(db).aprovadas, 1); // contatar implica aprovar

  decide(db, id('Alfa Indústria'), { action: 'respondeu' });
  decide(db, id('Alfa Indústria'), { action: 'reuniao' });
  d = todayData(db);
  assert.equal(d.followUps.length, 0); // reunião marcada: sai dos retornos
  const lead = getCompany(db, id('Alfa Indústria'))!;
  assert.equal(lead.company.outreach, 'reuniao');
  assert.deepEqual(lead.events.map((e) => e.detail?.split(' — ')[0]), ['Reunião marcada', 'Respondeu', 'Contato feito']);
  assert.match(detailPage(lead), /Reunião marcada/);
  assert.doesNotMatch(detailPage(lead), /data-decide="contatei"/);
});

test('retorno atrasado: contatado há 5+ dias aparece para cobrar', () => {
  const { db, id } = seed();
  decide(db, id('Beta Seguros'), { action: 'contatei' });
  db.prepare("UPDATE companies SET outreach_at = datetime('now', '-6 days') WHERE id = ?").run(id('Beta Seguros'));
  const f = todayData(db).followUps[0];
  assert.deepEqual([f.name, f.late], ['Beta Seguros', true]);
  assert.match(todayPage(todayData(db)), /cobrar retorno/);
});

test('rascunhos: cada oferta usa a evidência do lead e nunca promete envio automático', () => {
  const imp = draftMessage({ company: 'Alfa', offer: 'Improve', jobTitle: 'Admin Salesforce', daysOpen: 45, jobCount: 2, clouds: ['Sales Cloud'] });
  assert.match(imp.body, /está aberta há 45 dias \(e mais 1 vaga\(s\) Salesforce\)/);
  assert.match(imp.body, /Sales Cloud/);
  const keep = draftMessage({ company: 'Gama', offer: 'Keep', salesforceProducts: ['Marketing Cloud'], seenHow: 'detectado no DNS da empresa' });
  assert.match(keep.body, /usa Marketing Cloud \(detectado no DNS da empresa\)/);
  const fus = draftMessage({ company: 'Delta', offer: 'Ágil', trigger: { kind: 'fusao', title: 'Delta adquire Épsilon' } });
  assert.match(fus.body, /Integrar duas operações/);
  for (const d of [imp, keep, fus]) assert.match(d.body, /\[seu nome\] — Sottelli$/);
});

test('dashboard: resultado por fonte de origem (leads → aprovados → contatados → reuniões)', async () => {
  const { dashboardData } = await import('../src/web/dashboard.ts');
  const { dashboardPage } = await import('../src/web/pages.ts');
  const { db, id } = seed();
  decide(db, id('Alfa Indústria'), { action: 'contatei' });
  decide(db, id('Alfa Indústria'), { action: 'reuniao' });
  decide(db, id('Gama Alimentos'), { action: 'aprovar' });
  const rows = dashboardData(db).bySourceOutcome;
  const gupy = rows.find((r) => r.source === 'gupy')!;
  assert.deepEqual([gupy.leads, gupy.aprovados, gupy.contatados, gupy.reunioes], [2, 1, 1, 1]);
  assert.equal(rows[0].source, 'gupy'); // fonte com reunião vem primeiro
  assert.deepEqual({ ...rows.find((r) => r.source === 'salesforce-casos') }, { source: 'salesforce-casos', leads: 1, aprovados: 1, contatados: 0, responderam: 0, reunioes: 0 });
  assert.match(dashboardPage(dashboardData(db)), /Resultado por fonte/);
});

test('Improve ignora banco de talentos e vaga "permanente" (aberta há mais de 180 dias)', () => {
  const db = openDb(':memory:');
  const base = { source: 'gupy', description: 'Apex e Sales Cloud.', city: null, state: null, country: 'BR', documentId: null };
  const d = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  ingestJobs(db, [
    { ...base, externalId: '1', title: 'Banco de Talentos - TI Salesforce', companyName: 'Talentos SA', url: 'https://a/1', publishedAt: d(20) },
    { ...base, externalId: '2', title: 'Analista de QA Salesforce', companyName: 'Antiga SA', url: 'https://a/2', publishedAt: d(847) },
    { ...base, externalId: '3', title: 'Desenvolvedor Salesforce', companyName: 'Real SA', url: 'https://a/3', publishedAt: d(40) },
  ]);
  scoreAll(db);
  assert.deepEqual(todayData(db).improve.map((i) => i.name), ['Real SA']);
});
