import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots } from '../src/http/robots.ts';

const UA = 'RadarSottelli/0.1';

test('Disallow vazio libera tudo', () => {
  assert.equal(parseRobots('User-agent: *\nDisallow:', UA).isAllowed('/qualquer'), true);
});

test('Disallow bloqueia prefixo', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private', UA);
  assert.equal(r.isAllowed('/private/x'), false);
  assert.equal(r.isAllowed('/public'), true);
});

test('regra mais longa vence e Allow desempata', () => {
  const r = parseRobots('User-agent: *\nDisallow: /jobs\nAllow: /jobs/public', UA);
  assert.equal(r.isAllowed('/jobs/123'), false);
  assert.equal(r.isAllowed('/jobs/public/1'), true);
});

test('curinga e âncora $', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?q=', UA);
  assert.equal(r.isAllowed('/a/b.pdf'), false);
  assert.equal(r.isAllowed('/a/b.pdf?x'), true);
  assert.equal(r.isAllowed('/search?q=1'), false);
});

test('grupo específico do robô tem prioridade sobre *', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: RadarSottelli\nDisallow: /admin\nCrawl-delay: 5', UA);
  assert.equal(r.isAllowed('/vagas'), true);
  assert.equal(r.isAllowed('/admin'), false);
  assert.equal(r.crawlDelaySec, 5);
});
