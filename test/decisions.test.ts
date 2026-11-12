import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db/index.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { decide } from '../src/pipeline/decisions.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { listCompanies, getCompany, visaoCounts } from '../src/web/queries.ts';
import { listPage, detailPage } from '../src/web/views.ts';
import { triagePage } from '../src/web/triage.ts';
import { dashboardData } from '../src/web/dashboard.ts';
import { createServer } from '../src/web/server.ts';
import { UpdateRunner } from '../src/web/jobs.ts';

const NOW = new Date('2026-11-12T12:00:00Z');

function seed() {
  const db = openDb(':memory:');
  const base = { source: 'gupy', publishedAt: new Date().toISOString(), city: null, state: null, country: 'BR', documentId: null };
  ingestJobs(db, ['Alfa', 'Beta', 'Gama'].map((n, i) => ({
    ...base, externalId: String(i), title: 'Dev Salesforce', description: 'Apex e Service Cloud na indústria de alimentos.',
    companyName: `${n} Alimentos S.A.`, url: `https://a/${i}`,
  })));
  scoreAll(db);
  const id = (n: string) => (db.prepare('SELECT id FROM companies WHERE name LIKE ?').get(`${n}%`) as { id: number }).id;
  return { db, id };
}

test('banco antigo ganha as colunas novas ao abrir (migração)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE companies (id INTEGER PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'novo', stage TEXT NOT NULL DEFAULT 'radar', excluded_reason TEXT, notes TEXT, next_action TEXT,
    next_action_at TEXT, cnpj TEXT, domain TEXT, sector TEXT, sector_source TEXT, cnae TEXT, size_band TEXT, size_source TEXT,
    city TEXT, state TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE scores (company_id INTEGER PRIMARY KEY, total INTEGER NOT NULL, fit INTEGER NOT NULL, signal INTEGER NOT NULL,
    offers TEXT NOT NULL, breakdown TEXT NOT NULL, rules_version TEXT NOT NULL, computed_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  old.close();
  const db = openDb(file);
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ['discard_reason', 'decided_at', 'snoozed_until']) assert.ok(cols('companies').includes(c), c);
  assert.ok(cols('scores').includes('prev_total'));
  db.close();
});

test('aprovar, descartar, adiar e reabrir mudam a situação e ficam no histórico', () => {
  const { db, id } = seed();
  assert.deepEqual(visaoCounts(db).triagem, 3);

  assert.equal(decide(db, id('Alfa'), { action: 'aprovar', note: 'bom fit' }).stage, 'aprovada');
  assert.equal(decide(db, id('Beta'), { action: 'descartar', reason: 'fora_do_perfil' }).status, 'descartado');
  assert.equal(decide(db, id('Gama'), { action: 'adiar' }, NOW).snoozedUntil, '2026-11-26'); // padrão: 14 dias
  assert.deepEqual(decide(db, id('Gama'), { action: 'xpto' as never }), { ok: false, error: 'ação inválida' });
  assert.equal(decide(db, 999, { action: 'aprovar' }).ok, false);

  const counts = visaoCounts(db);
  assert.deepEqual([counts.triagem, counts.aprovadas, counts.descartadas, counts.padrao], [0, 1, 1, 2]);
  assert.deepEqual(listCompanies(db, {}).map((r) => r.name).sort(), ['Alfa Alimentos S.A.', 'Gama Alimentos S.A.']); // descartada some do padrão
  assert.deepEqual(listCompanies(db, { visao: 'descartadas' }).map((r) => r.discard_reason), ['fora_do_perfil']);

  // Aprovar de novo não desfaz uma etapa mais adiante do funil.
  db.prepare("UPDATE companies SET stage = 'proposta' WHERE id = ?").run(id('Alfa'));
  assert.equal(decide(db, id('Alfa'), { action: 'aprovar' }).stage, 'proposta');

  decide(db, id('Beta'), { action: 'reabrir' });
  assert.equal(listCompanies(db, { visao: 'triagem' }).length, 1);
  const events = getCompany(db, id('Beta'))!.events.map((e) => e.kind);
  assert.deepEqual(events, ['reaberta', 'descartada']);
  assert.match(getCompany(db, id('Alfa'))!.events.at(-1)!.detail!, /bom fit/);
});

test('descartar como "já é cliente" exclui de vez; reabrir devolve sem mexer em outras exclusões', () => {
  const { db, id } = seed();
  db.prepare("UPDATE companies SET excluded_reason = 'recrutadora' WHERE id = ?").run(id('Gama')); // exclusão manual de outra conta
  decide(db, id('Alfa'), { action: 'descartar', reason: 'ja_e_cliente' });
  assert.equal((db.prepare('SELECT excluded_reason FROM companies WHERE id = ?').get(id('Alfa')) as { excluded_reason: string }).excluded_reason, 'cliente');
  assert.equal((db.prepare("SELECT count(*) n FROM exclusions WHERE kind = 'cliente'").get() as { n: number }).n, 1);

  decide(db, id('Alfa'), { action: 'reabrir' });
  assert.equal((db.prepare('SELECT excluded_reason FROM companies WHERE id = ?').get(id('Alfa')) as { excluded_reason: string | null }).excluded_reason, null);
  assert.equal((db.prepare('SELECT excluded_reason FROM companies WHERE id = ?').get(id('Gama')) as { excluded_reason: string }).excluded_reason, 'recrutadora');
});

test('nota anterior vira indicação de subiu/desceu na lista', () => {
  const { db, id } = seed();
  db.prepare('UPDATE scores SET total = total - 7 WHERE company_id = ?').run(id('Alfa')); // simula nota antiga menor
  scoreAll(db);
  const row = listCompanies(db, {}).find((r) => r.name.startsWith('Alfa'))!;
  assert.equal(row.total! - row.prev_total!, 7);
  assert.match(listPage([row], {}, []), /▲ \+7/);
});

test('telas: abas de Leads, situação com contagem, botões só no painel local, triagem e dashboard', () => {
  const { db, id } = seed();
  decide(db, id('Beta'), { action: 'aprovar' });
  const rows = listCompanies(db, {});
  const live = listPage(rows, {}, [], false, visaoCounts(db));
  assert.match(live, /<a href="\/">Leads<\/a>/);
  assert.doesNotMatch(live, /<a href="\/radar\/vagas">Vagas<\/a><a/); // modalidades saíram do menu de cima
  assert.match(live, /class="lead-tabs"/);
  assert.match(live, /A triar<span class="c">2<\/span>/);
  assert.match(live, /data-decide="aprovar"/);
  const stat = listPage(rows, {}, [], true);
  assert.doesNotMatch(stat, /data-decide=/);
  assert.match(stat, /name="visao"/);

  const d = getCompany(db, id('Beta'))!;
  assert.match(detailPage(d), /Histórico/);
  assert.match(detailPage(d), /data-decide="descartar"/);
  assert.doesNotMatch(detailPage(d), /data-decide="aprovar"/); // já aprovada

  const queue = listCompanies(db, { visao: 'triagem' }).map((r) => getCompany(db, r.id)!);
  const tri = triagePage(queue, queue.length);
  assert.equal((tri.match(/class="card triage"/g) ?? []).length, 2);
  assert.match(triagePage([], 0), /Nada para triar agora/);

  db.prepare("UPDATE companies SET next_action = 'Ligar para o CIO', next_action_at = '2000-01-01' WHERE id = ?").run(id('Alfa'));
  const dash = dashboardData(db);
  assert.equal(dash.queue.aprovadas, 1);
  assert.ok(dash.nextActions[0].due < 0);
});

test('rota de decisão: aprova via POST, devolve as abas da conta e recusa outra origem', async () => {
  const { db, id } = seed();
  const server = createServer(db, new UpdateRunner(db)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    const ok = await fetch(`${base}/empresa/${id('Alfa')}/decisao`, { method: 'POST', headers: form, body: 'action=aprovar' });
    assert.equal(ok.status, 200);
    const j = await ok.json() as { ok: boolean; visoes: string[] };
    assert.deepEqual([j.ok, j.visoes], [true, ['padrao', 'aprovadas']]);

    const bad = await fetch(`${base}/empresa/${id('Beta')}/decisao`, { method: 'POST', headers: form, body: 'action=nada' });
    assert.equal(bad.status, 400);
    const foreign = await fetch(`${base}/empresa/${id('Beta')}/decisao`, { method: 'POST', headers: { ...form, Origin: 'http://evil.example' }, body: 'action=aprovar' });
    assert.equal(foreign.status, 403);

    assert.equal((await fetch(`${base}/triagem`)).status, 200);
    assert.equal((await fetch(`${base}/?visao=aprovadas`)).status, 200);
  } finally {
    server.close();
  }
});

test('Brasil + América Latina na Gupy; exclusão pega o nome com sufixo', async () => {
  const { gupyCountry, isInScopeGupyJob } = await import('../src/sources/gupy.ts');
  const job = (city?: string, state?: string, country?: string) => ({ id: 1, name: 'x', jobUrl: 'https://x', city, state, country });
  assert.equal(gupyCountry(job('Campinas', 'São Paulo')), 'BR');
  assert.equal(gupyCountry(job('Curitiba', 'PR')), 'BR');
  assert.equal(gupyCountry(job()), 'BR');                          // remota, portal brasileiro
  assert.equal(gupyCountry(job('Lima', '')), 'PE');                // caso real: Peru
  assert.equal(gupyCountry(job('Bogotá', 'Cundinamarca')), 'CO');
  assert.equal(gupyCountry(job('Ciudad de México', '')), 'MX');
  assert.equal(isInScopeGupyJob(job('Austin', 'Texas')), false);   // fora da América Latina
  assert.equal(isInScopeGupyJob(job('Lisboa', '')), false);
  assert.equal(isInScopeGupyJob(job(undefined, undefined, 'Chile')), true);

  const { exclusionFor } = await import('../src/pipeline/companies.ts');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO exclusions (kind, name, normalized_name, origin) VALUES ('concorrente', 'Stefanini', 'stefanini', 't'), ('concorrente', 'IBM', 'ibm', 't')").run();
  assert.equal(exclusionFor(db, 'Stefanini Latam'), 'concorrente');
  assert.equal(exclusionFor(db, 'IBM Brasil Ltda'), 'concorrente');
  assert.equal(exclusionFor(db, 'IBMX Tecnologia'), null);
  assert.equal(exclusionFor(db, 'Grupo Stefanini'), 'concorrente'); // "grupo" é ruído na normalização
});

test('América Latina: notícia em espanhol vira gatilho; vaga fora do Brasil vale 6 em vez de 10', async () => {
  const { classifyNews } = await import('../src/sources/news.ts');
  assert.deepEqual([classifyNews('Grupo Alfa nombra nuevo director de tecnología')?.kind, classifyNews('Grupo Alfa nombra nuevo director de tecnología')?.area], ['lideranca', 'tecnologia']);
  assert.equal(classifyNews('Grupo Alfa adquiere a su competidor en Chile')?.kind, 'fusao');
  assert.equal(classifyNews('Grupo Alfa inaugura nueva planta en Monterrey')?.kind, 'expansao');

  const db = openDb(':memory:');
  const base = { source: 'gupy', title: 'Dev Salesforce', description: 'Apex.', publishedAt: new Date().toISOString(), state: null, documentId: null };
  const stats = ingestJobs(db, [
    { ...base, externalId: '1', companyName: 'Andina Seguros', url: 'https://a/1', city: 'Lima', country: 'PE' },
    { ...base, externalId: '2', companyName: 'Paulista Seguros', url: 'https://a/2', city: 'Campinas', country: 'BR' },
    { ...base, externalId: '3', companyName: 'Texas Corp', url: 'https://a/3', city: 'Austin', country: 'desconhecido' },
  ]);
  assert.equal(stats.outOfRegion, 1);
  scoreAll(db);
  const rule = (name: string) => getCompany(db, (db.prepare('SELECT id FROM companies WHERE name = ?').get(name) as { id: number }).id)!
    .breakdown.find((b) => b.rule.startsWith('Atua no'))!;
  assert.equal(rule('Andina Seguros').points, 6);
  assert.match(rule('Andina Seguros').reason, /Peru/);
  assert.equal(rule('Paulista Seguros').points, 10);
});

test('lead manual: indicação entra com +15, recusa excluída e aparece via formulário do painel', async () => {
  const { addManualLead } = await import('../src/pipeline/manualLeads.ts');
  const db = openDb(':memory:');
  db.prepare("INSERT INTO exclusions (kind, name, normalized_name, origin) VALUES ('cliente', 'Cliente Atual', 'cliente atual', 't')").run();
  assert.equal(addManualLead(db, { name: ' ', origin: 'indicacao' }).ok, false);
  assert.match(addManualLead(db, { name: 'Cliente Atual', origin: 'indicacao' }).error!, /exclusão/);
  const r = addManualLead(db, { name: 'Indústria Indicada', origin: 'indicacao', detail: 'indicada pela Maria', domain: 'https://www.indicada.com.br/contato' });
  assert.ok(r.ok);
  scoreAll(db);
  const d = getCompany(db, r.id!)!;
  assert.equal(d.company.domain, 'indicada.com.br');
  assert.equal(d.breakdown.find((b) => b.rule.startsWith('Gatilho'))!.points, 15);
  assert.match(detailPage(d), /Indicação: indicada pela Maria/);
  assert.match(detailPage(d), /href="https:\/\/indicada\.com\.br"/); // com site, a evidência aponta para ele
  const semSite = addManualLead(db, { name: 'Sem Site Ltda', origin: 'evento' });
  assert.doesNotMatch(detailPage(getCompany(db, semSite.id!)!), /href=""/); // sem site, sem link vazio
  assert.equal(d.events[0].kind, 'cadastrada');

  const server = createServer(db, new UpdateRunner(db)).listen(0, '127.0.0.1');
  await new Promise((res) => server.once('listening', res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.match(await (await fetch(base + '/')).text(), /Adicionar lead/);
    const post = await fetch(base + '/leads/novo', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Agro+Evento&origin=evento&detail=World+Tour' });
    assert.equal(post.status, 303);
    assert.match(post.headers.get('location')!, /^\/empresa\/\d+$/);
  } finally {
    server.close();
  }
});

test('junção de duplicados entre fontes: domínio, palavras invertidas, sufixo Brasil e nome = domínio', async () => {
  const { mergeDuplicates, sameCompany } = await import('../src/pipeline/companies.ts');
  const row = (id: number, name: string, domain: string | null = null) => ({ id, name, domain, status: 'novo', notes: null, signals: 1 });
  assert.ok(sameCompany(row(1, 'Vipal Borrachas'), row(2, 'Borrachas Vipal')));
  assert.ok(sameCompany(row(1, 'Banco Abc'), row(2, 'Banco Abc Brasil')));
  assert.ok(sameCompany(row(1, 'BTG Pactual'), row(2, 'Banco Ubs Pactual', 'btgpactual.com')));
  assert.ok(sameCompany(row(1, 'X', 'a.com.br'), row(2, 'Y', 'a.com.br')));
  assert.ok(!sameCompany(row(1, 'Banco Inter'), row(2, 'Banco Internacional')));
  assert.ok(!sameCompany(row(1, 'Natura'), row(2, 'Natura Brasil Pet'))); // sufixo só "Brasil" exato

  const { db, id } = seed();
  db.prepare("INSERT INTO companies (name, normalized_name, sector, sector_source, cnpj) VALUES ('Brasil Alfa Alimentos', 'x-dup', 'industria', 'cvm: Alimentos', '123')").run();
  // "Alfa Alimentos S.A." (vaga, com decisão) e "Alfa Alimentos Brasil" (CVM) = mesma empresa.
  db.prepare("UPDATE companies SET name = 'Alfa Alimentos Brasil', normalized_name = 'alfa alimentos brasil' WHERE normalized_name = 'x-dup'").run();
  decide(db, id('Alfa'), { action: 'aprovar' });
  const { merged } = mergeDuplicates(db);
  assert.deepEqual(merged, ['Alfa Alimentos Brasil → Alfa Alimentos S.A.']);
  const kept = getCompany(db, id('Alfa'))!;
  assert.equal(kept.company.status, 'qualificado');           // a decisão foi mantida
  assert.equal(kept.company.cnpj, '123');                     // dado da CVM completou a conta
  assert.equal(kept.company.sector_source, 'cvm: Alimentos'); // setor confirmado vence o inferido
  assert.ok(kept.aliases.some((a) => a.alias === 'Alfa Alimentos Brasil'));
  assert.equal(kept.events[0].kind, 'juncao');
  assert.deepEqual(mergeDuplicates(db).merged, []);            // rodar de novo não faz nada
});
