import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.ts';
import { PoliteClient, type FetchFn } from '../src/http/client.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { ingestNews } from '../src/pipeline/ingestNews.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { getCompany } from '../src/web/queries.ts';
import { classifyNews, titleMentionsCompany, parseGdelt, collectNews, gdeltUrl } from '../src/sources/news.ts';

const NOW = new Date('2026-10-06T12:00:00Z');

function fakeFetch(routes: Record<string, { status: number; body: string }>): FetchFn {
  return (async (input: string | URL | Request) => {
    const hit = routes[String(input)] ?? { status: 404, body: '' };
    return new Response(hit.body, { status: hit.status });
  }) as FetchFn;
}

test('classifica gatilhos de notícia', () => {
  const lider = classifyNews('Alimentos Exemplo nomeia novo diretor de tecnologia');
  assert.deepEqual([lider?.kind, lider?.area], ['lideranca', 'tecnologia']);
  assert.equal(classifyNews('Alimentos Exemplo nomeia Maria como diretora comercial')?.area, 'comercial');
  assert.equal(classifyNews('Alimentos Exemplo adquire concorrente por R$ 2 bi')?.kind, 'fusao');
  assert.equal(classifyNews('Alimentos Exemplo inaugura nova fábrica em Goiás')?.kind, 'expansao');
  assert.equal(classifyNews('Alimentos Exemplo lança novo sabor'), null);
  assert.equal(classifyNews('Ex-Salesforce assume diretoria de TI')?.mentionsSalesforce, true);
});

test('exige a empresa inteira no título e trata resposta do GDELT', () => {
  assert.ok(titleMentionsCompany('Alimentos Exemplo S.A. nomeia diretor', 'Alimentos Exemplo'));
  assert.ok(!titleMentionsCompany('Alimentos Exemplos Brasil nomeia diretor', 'Alimentos Exemplo'));
  assert.deepEqual(parseGdelt('{}', null), []);
  assert.throws(() => parseGdelt('Please limit requests to one every 5 seconds', null), /não é JSON/);
});

test('notícia vira gatilho com ponto na nota e oferta Ágil', async () => {
  const db = openDb(':memory:');
  ingestJobs(db, [{
    source: 'gupy', externalId: '1', title: 'Desenvolvedor Salesforce', description: 'Apex em indústria.',
    companyName: 'Alimentos Exemplo S.A.', url: 'https://a.gupy.io/job/1', publishedAt: '2026-10-01T10:00:00Z',
    city: null, state: null, country: 'BR', documentId: null,
  }]);
  const company = db.prepare('SELECT id, name FROM companies').get() as { id: number; name: string };

  const body = JSON.stringify({ articles: [
    { url: 'https://jornal.com/a', title: 'Alimentos Exemplo nomeia novo diretor de tecnologia', seendate: '20261003T120000Z', domain: 'jornal.com' },
    { url: 'https://jornal.com/b', title: 'Alimentos Exemplo lança novo sabor', seendate: '20261003T120000Z', domain: 'jornal.com' },
    { url: 'https://jornal.com/c', title: 'Outra Empresa nomeia diretor', seendate: '20261003T120000Z', domain: 'jornal.com' },
  ] });
  const client = new PoliteClient({
    db, sleep: async () => {},
    fetchFn: fakeFetch({
      'https://api.gdeltproject.org/robots.txt': { status: 404, body: '' },
      [gdeltUrl(company.name)]: { status: 200, body },
    }),
  });
  const news = await collectNews(client, [company]);
  assert.equal(news.length, 1);
  assert.equal(ingestNews(db, news).newSignals, 1);
  assert.equal(ingestNews(db, news).newSignals, 0); // coletar de novo não duplica

  scoreAll(db, NOW);
  const d = getCompany(db, company.id)!;
  const rule = d.breakdown.find((b) => b.rule.startsWith('Gatilho'))!;
  assert.equal(rule.points, 15);
  assert.match(rule.reason, /Troca de liderança/);
  assert.ok(d.offers.some((o) => o.offer === 'Ágil' && o.reasons.some((r) => r.includes('tecnologia'))));
  assert.equal(d.signals.find((s) => s.type === 'gatilho')?.source, 'gdelt');
});

test('quadro com resposta de limite de taxa não derruba a coleta', async () => {
  const logs: string[] = [];
  const client = new PoliteClient({
    sleep: async () => {},
    fetchFn: fakeFetch({
      'https://api.gdeltproject.org/robots.txt': { status: 404, body: '' },
      [gdeltUrl('Alpha')]: { status: 200, body: 'Please limit requests to one every 5 seconds' },
    }),
  });
  const news = await collectNews(client, [{ id: 1, name: 'Alpha' }], (m) => logs.push(m));
  assert.deepEqual(news, []);
  assert.ok(logs.some((l) => l.includes('falhou')));
});
