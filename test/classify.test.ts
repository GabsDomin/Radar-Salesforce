import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyJob } from '../src/classify/job.ts';

test('desenvolvedor Salesforce sênior com Service Cloud', () => {
  const c = classifyJob('Desenvolvedor Salesforce Sr', 'Experiência com Apex, LWC e Service Cloud. Somos uma indústria de alimentos.');
  assert.equal(c.isSalesforce, true);
  assert.equal(c.role, 'developer');
  assert.equal(c.senior, true);
  assert.deepEqual(c.clouds, ['Service Cloud']);
  assert.equal(c.sector?.sector, 'industria');
  assert.deepEqual(c.consultancyReasons, []);
});

test('analista de CRM que usa Marketing Cloud vira usuário de CRM', () => {
  const c = classifyJob('Analista de CRM Sênior (Salesforce Marketing Cloud)', 'Criar jornadas no Journey Builder.');
  assert.equal(c.role, 'usuario_crm');
  assert.ok(c.clouds.includes('Marketing Cloud'));
});

test('arquiteto com implantação', () => {
  const c = classifyJob('Arquiteto Salesforce', 'Liderar a implantação do Sales Cloud e integrações com o ERP.');
  assert.equal(c.role, 'arquiteto');
  assert.ok(c.projectHints.includes('implantação'));
});

test('detecta consultoria', () => {
  const c = classifyJob('Consultor Salesforce', 'Somos uma consultoria especializada e atuamos em projetos para clientes de diversos setores.');
  assert.ok(c.consultancyReasons.length >= 1);
});

test('vaga sem Salesforce não passa', () => {
  const c = classifyJob('Analista de Marketing', 'Experiência com Google Ads e RD Station.');
  assert.equal(c.isSalesforce, false);
});

test('não confunde "acredito" com "crédito" nem "banco de talentos" com banco', () => {
  const c1 = classifyJob('Desenvolvedor Salesforce', 'Acreditamos que você vai crescer com a gente.');
  assert.equal(c1.sector, null);
  const c2 = classifyJob('Banco de Talentos - TI Salesforce', 'Cadastre-se para futuras vagas Salesforce.');
  assert.equal(c2.sector, null);
});

test('reconhece setor financeiro de verdade', () => {
  const c = classifyJob('Desenvolvedor Salesforce', 'Atuamos no mercado financeiro, com produtos de crédito e investimento.');
  assert.equal(c.sector?.sector, 'financeiro');
});

test('benefícios (previdência, vale, crédito/débito) não indicam setor financeiro', () => {
  // Casos reais encontrados na coleta: crédito/débito é um benefício (cartão flash),
  // previdência privada é benefício, "banco" aqui é banco de dados/de talentos.
  assert.equal(classifyJob('Dev Salesforce', 'Benefícios: cartão flash crédito/débito, previdência privada.').sector, null);
  assert.equal(classifyJob('Dev Salesforce', 'Domínio de PL/SQL e banco Oracle.').sector, null);
  assert.equal(classifyJob('Banco de Talentos - TI Salesforce', 'Cadastre-se para futuras vagas.').sector, null);
  assert.equal(classifyJob('Dev Salesforce', 'Alinhamento de KPIs financeiros da área.').sector, null);
});

test('"bank" e "mercado financeiro" explícitos ainda indicam o setor', () => {
  assert.equal(classifyJob('Dev Salesforce', 'Time de software do Porto Bank.').sector?.sector, 'financeiro');
  assert.equal(classifyJob('Dev Salesforce', 'Estamos redefinindo o mercado financeiro no Brasil.').sector?.sector, 'financeiro');
});
