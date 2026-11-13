import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db/index.ts';
import { PoliteClient, type FetchFn } from '../src/http/client.ts';
import { isValidCnpj, findCnpj, sectorFromCnae, parseBrasilApi, brasilApiUrl } from '../src/sources/receita.ts';
import { runEnrich, applyReceita, titleMatches, domainCandidates } from '../src/pipeline/enrich.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { getCompany } from '../src/web/queries.ts';
import { detailPage } from '../src/web/views.ts';
import { todayData } from '../src/web/today.ts';
import { createServer } from '../src/web/server.ts';
import { UpdateRunner } from '../src/web/jobs.ts';

const NOW = new Date('2026-11-12T12:00:00Z');

function fakeFetch(routes: Record<string, { status: number; body: string }>): FetchFn {
  return (async (input: string | URL | Request) => {
    const hit = routes[String(input)] ?? { status: 404, body: '' };
    return new Response(hit.body, { status: hit.status });
  }) as FetchFn;
}

const brasilApi = (over: Record<string, unknown> = {}) => JSON.stringify({
  cnpj: '11222333000181', razao_social: 'ALFA ALIMENTOS S.A.', nome_fantasia: 'ALFA', cnae_fiscal: 1091101,
  cnae_fiscal_descricao: 'Fabricação de produtos de panificação', porte: 'DEMAIS', descricao_situacao_cadastral: 'ATIVA',
  municipio: 'CAMPINAS', uf: 'SP',
  qsa: [
    { nome_socio: 'MARIA SILVA', qualificacao_socio: 'Diretor', data_entrada_sociedade: '2026-09-01' },
    { nome_socio: 'JOAO SOUZA', qualificacao_socio: 'Presidente', data_entrada_sociedade: '2019-03-10' },
    { nome_socio: 'FUNDO X', qualificacao_socio: 'Sócio', data_entrada_sociedade: '2020-01-01' },
  ],
  ...over,
});

test('CNPJ: dígitos verificadores, achar no rodapé, CNAE → setor', () => {
  assert.ok(isValidCnpj('11.222.333/0001-81'));
  assert.ok(isValidCnpj('33000167000101'));
  assert.ok(!isValidCnpj('11.222.333/0001-82'));
  assert.ok(!isValidCnpj('00000000000000'));
  assert.equal(findCnpj('Telefone 11 2222-3333 · CNPJ: 11.222.333/0001-81 · Todos os direitos'), '11222333000181');
  assert.equal(findCnpj('pedido 12.345.678/0001-00 inválido'), null);
  assert.equal(sectorFromCnae('0111301'), 'agro');
  assert.equal(sectorFromCnae('1091101'), 'industria');
  assert.equal(sectorFromCnae('6422100'), 'financeiro');
  assert.equal(sectorFromCnae('9430800'), 'outro'); // associação / organização sem fins lucrativos
});

test('Receita: setor e porte confirmados, diretoria vira contato e entrada recente vira troca de liderança', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO companies (name, normalized_name) VALUES ('Alfa Alimentos', 'alfa alimentos')").run();
  const info = parseBrasilApi(brasilApi());
  assert.deepEqual(info.diretoria.map((d) => d.cargo), ['Diretor', 'Presidente']); // sócio sem cargo de gestão fica de fora
  const r = applyReceita(db, 1, info, NOW);
  assert.deepEqual(r, { directors: 2, leadershipChanges: 1 });
  scoreAll(db, NOW);
  const d = getCompany(db, 1)!;
  assert.equal(d.company.sector, 'industria');
  assert.equal(d.breakdown.find((b) => b.rule === 'Setor-alvo')!.points, 15);
  assert.equal(d.breakdown.find((b) => b.rule.startsWith('Porte'))!.points, 15);
  const lid = d.signals.find((s) => s.subtype === 'lideranca')!;
  assert.equal(lid.title, 'Nova diretoria: Diretor desde 01/09/2026');
  assert.doesNotMatch(lid.title, /MARIA/); // o nome fica no contato, não no título do sinal
  assert.equal(lid.url, brasilApiUrl('11222333000181'));
  assert.match(detailPage(d), /MARIA SILVA<\/strong> — Diretor/);
  assert.deepEqual(applyReceita(db, 1, info, NOW), { directors: 0, leadershipChanges: 0 }); // não duplica

  // Lead com diretoria nova aparece em Hoje (Ágil) com rascunho sem citar "notícia".
  const it = todayData(db, NOW).agil.find((i) => i.name === 'Alfa Alimentos')!;
  assert.match(it.draft.body, /composição nova na diretoria/);
  assert.doesNotMatch(it.draft.body, /notícia/);
  assert.match(it.contacts.map((c) => c.name).join(','), /MARIA SILVA/);
});

test('organização sem fins lucrativos sai do perfil pelo CNAE', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO companies (name, normalized_name) VALUES ('Instituto Beta', 'instituto beta')").run();
  applyReceita(db, 1, parseBrasilApi(brasilApi({ cnae_fiscal: 9430800, cnae_fiscal_descricao: 'Atividades de associações de defesa de direitos sociais', qsa: [] })), NOW);
  scoreAll(db, NOW);
  const d = getCompany(db, 1)!;
  assert.equal(d.company.sector, 'outro');
  assert.equal(d.breakdown.find((b) => b.rule === 'Setor-alvo')!.points, 0);
});

test('cadeia completa: acha o site pelo nome, o CNPJ no rodapé e consulta a Receita', async () => {
  assert.ok(titleMatches('<title>Alfa Alimentos | Pães e bolos</title>', 'Alfa Alimentos S.A.'));
  assert.ok(!titleMatches('<title>Domínio à venda</title>', 'Alfa Alimentos'));
  assert.deepEqual(domainCandidates('Alfa Alimentos', ['https://alfa.gupy.io/job/1', 'https://carreiras.alfa.com.br/vaga/2']),
    ['carreiras.alfa.com.br', 'alfaalimentos.com.br', 'alfaalimentos.com']);

  const db = openDb(':memory:');
  ingestJobs(db, [{ source: 'gupy', externalId: '1', title: 'Dev Salesforce', description: 'Apex.', companyName: 'Alfa Alimentos', url: 'https://alfa.gupy.io/job/1', publishedAt: NOW.toISOString(), city: null, state: null, country: 'BR', documentId: null }]);
  const client = new PoliteClient({ db, sleep: async () => {}, fetchFn: fakeFetch({
    'https://www.alfaalimentos.com.br/robots.txt': { status: 404, body: '' },
    'https://www.alfaalimentos.com.br/': { status: 200, body: '<html><title>Alfa Alimentos</title><body>' + 'x'.repeat(300) + '<footer>CNPJ 11.222.333/0001-81</footer></body></html>' },
    'https://minhareceita.org/robots.txt': { status: 400, body: '' },
    [brasilApiUrl('11222333000181')]: { status: 200, body: brasilApi() },
  }) });
  const stats = await runEnrich(db, client, () => {}, { now: NOW });
  assert.deepEqual([stats.domainsFound, stats.cnpjsFound, stats.receitaOk, stats.directors, stats.leadershipChanges], [1, 1, 1, 2, 1]);
  const c = db.prepare('SELECT domain, cnpj, sector, receita_at FROM companies').get() as Record<string, string>;
  assert.deepEqual([c.domain, c.cnpj, c.sector], ['alfaalimentos.com.br', '11222333000181', 'industria']);
  assert.ok(c.receita_at);
  assert.equal((await runEnrich(db, client, () => {}, { now: NOW })).leads, 0); // já consultado: não repete
});

test('contato cadastrado à mão pela página do lead', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO companies (name, normalized_name) VALUES ('Gama', 'gama')").run();
  const server = createServer(db, new UpdateRunner(db)).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/empresa/1/contato`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=Ana+Lima&role=Gerente+de+CRM&channel=https%3A%2F%2Flinkedin.com%2Fin%2Fana',
    });
    assert.equal(res.status, 303);
  } finally {
    server.close();
  }
  const html = detailPage(getCompany(db, 1)!);
  assert.match(html, /Ana Lima<\/strong> — Gerente de CRM/);
  assert.match(html, /href="https:\/\/linkedin\.com\/in\/ana"/);
  assert.match(html, /cadastrado à mão/);
});
