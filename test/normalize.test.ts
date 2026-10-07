import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyName, isIdentifiableCompany } from '../src/normalize/company.ts';

test('remove acentos, sufixos societários e ruído', () => {
  assert.equal(normalizeCompanyName('Grupo Suno'), 'suno');
  assert.equal(normalizeCompanyName('Suno S.A.'), 'suno');
  assert.equal(normalizeCompanyName('SUNO S/A'), 'suno');
  assert.equal(normalizeCompanyName('3corações'), '3coracoes');
  assert.equal(normalizeCompanyName('Indústria Exemplo Ltda.'), 'industria exemplo');
  assert.equal(normalizeCompanyName('CI&T'), 'ci e t');
});

test('não destrói nomes curtos', () => {
  assert.equal(normalizeCompanyName('Grupo'), 'grupo');
  assert.equal(normalizeCompanyName('Banco do Brasil'), 'banco do brasil');
});

test('identifica empresas não identificáveis', () => {
  assert.equal(isIdentifiableCompany('Confidencial'), false);
  assert.equal(isIdentifiableCompany('São Paulo/SP'), false);
  assert.equal(isIdentifiableCompany(''), false);
  assert.equal(isIdentifiableCompany('PagBrasil'), true);
});
