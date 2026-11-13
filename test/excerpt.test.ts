import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerptFor, htmlToText, tidyStoredSnippet } from '../src/util/excerpt.ts';
import { evidenceSnippet } from '../src/pipeline/ingestJobs.ts';
import { detectPain } from '../src/classify/job.ts';

const ES = 'Buscamos un profesional para nuestro equipo de tecnología. Como parte de los procesos de desarrollo, deberás proponer soluciones y compartir conocimiento con el equipo. Experiencia con ERPs como Odoo y/o Salesforce. Conocimientos de integración vía API. Experiencia relacionada con procesos comerciales. Inglés intermedio.';

const startsWithWord = (s: string) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(s);
const endsClean = (s: string) => /[.!?]$/.test(s);

test('trecho da vaga: frases inteiras, sem palavra cortada nem reticências no meio', () => {
  const ev = evidenceSnippet(ES);
  assert.match(ev, /Experiencia con ERPs como Odoo y\/o Salesforce\./);
  assert.ok(startsWithWord(ev), ev);
  assert.ok(endsClean(ev), ev);
  assert.doesNotMatch(ev, /…/);
  // Toda palavra do trecho existe inteira no texto original.
  for (const w of ev.split(/\s+/)) assert.ok(ES.includes(w.replace(/[.,]$/, '')), `palavra cortada: ${w}`);
});

test('itens de lista viram frases separadas', () => {
  const html = '<p>Requisitos:</p><ul><li>Experiência com Apex e LWC</li><li>Conhecimento em Sales Cloud</li><li>Inglês avançado</li></ul>';
  const text = htmlToText(html);
  assert.equal(text, 'Requisitos:\nExperiência com Apex e LWC\nConhecimento em Sales Cloud\nInglês avançado');
  const ev = excerptFor(text, /apex/i);
  // Item curto: junta os vizinhos para dar contexto, cada item como frase.
  assert.equal(ev, 'Requisitos: Experiência com Apex e LWC. Conhecimento em Sales Cloud. Inglês avançado');
});

test('frases coladas sem espaço ("Experience.Experiência") são separadas', () => {
  const ev = excerptFor('Liderança de times de Customer Experience.Experiência com Salesforce e HubSpot.Conhecimento em APIs REST.', /salesforce/i);
  assert.equal(ev, 'Liderança de times de Customer Experience. Experiência com Salesforce e HubSpot. Conhecimento em APIs REST.');
});

test('frase gigante é cortada só em limite de palavra', () => {
  const long = Array.from({ length: 200 }, (_, i) => `palavra${i}`).join(' ') + ' Salesforce ' + Array.from({ length: 200 }, (_, i) => `termo${i}`).join(' ');
  const ev = excerptFor(long, /salesforce/i);
  assert.ok(ev.length <= 490);
  assert.match(ev, /Salesforce/);
  for (const w of ev.split(' ')) assert.ok(w === '…' || long.split(' ').includes(w), `palavra cortada: ${w}`);
});

test('dor: trecho sai do texto original, com acentos e maiúsculas', () => {
  const [hint] = detectPain('Analista de CRM\nVocê vai conduzir a migração do HubSpot para o Salesforce. Também vai treinar os usuários.');
  assert.equal(hint.kind, 'migracao_crm');
  assert.equal(hint.evidence, 'Você vai conduzir a migração do HubSpot para o Salesforce. Também vai treinar os usuários.');
});

test('trechos antigos gravados com corte no meio da palavra são arrumados na tela', () => {
  const old = '…omo parte de los procesos de desarrollo, deberás proponer soluciones y compartir conocimiento con el equipo. Experiencia con ERPs como Odoo y/o Salesforce. Conocimientos de integración. Experiencia…';
  const t = tidyStoredSnippet(old);
  assert.equal(t, 'Experiencia con ERPs como Odoo y/o Salesforce. Conocimientos de integración.');
  assert.equal(tidyStoredSnippet('Texto normal.'), 'Texto normal.');
});
