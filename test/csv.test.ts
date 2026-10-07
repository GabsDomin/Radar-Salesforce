import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/util/csv.ts';

test('lê CSV com ; , aspas e BOM', () => {
  const rows = parseCsv('﻿nome;tipo;cnpj\r\n"Empresa; Ltda";cliente;123\r\nOutra;concorrente;\r\n');
  assert.deepEqual(rows, [
    { nome: 'Empresa; Ltda', tipo: 'cliente', cnpj: '123' },
    { nome: 'Outra', tipo: 'concorrente', cnpj: '' },
  ]);
});

test('lê CSV com vírgula', () => {
  assert.deepEqual(parseCsv('nome,tipo\nA,cliente'), [{ nome: 'A', tipo: 'cliente' }]);
});

test('escreve CSV com escape e volta igual', () => {
  const out = toCsv(['a', 'b'], [['x;y', 'ele disse "oi"']]);
  assert.deepEqual(parseCsv(out), [{ a: 'x;y', b: 'ele disse "oi"' }]);
});
