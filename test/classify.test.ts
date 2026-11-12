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

test('consultoria: indício forte descarta, "nossos clientes" sozinho só marca', () => {
  assert.equal(classifyJob('Dev Salesforce', 'Somos parceira Salesforce e atuamos em projetos.').consultancyStrong, true);
  assert.equal(classifyJob('Dev Salesforce', 'Vaga de alocação no cliente final.').consultancyStrong, true);
  const fraco = classifyJob('Admin Salesforce', 'Atender nossos clientes internos.');
  assert.equal(fraco.consultancyStrong, false);
  assert.equal(fraco.consultancyReasons.length, 1);
});

test('dor: detecta migração de CRM, org mal aproveitada e processo manual; ignora frases genéricas', () => {
  const kinds = (d: string) => classifyJob('Dev Salesforce', d).pain.map((p) => p.kind);
  assert.deepEqual(kinds('Migração do RD Station para Salesforce no time comercial.'), ['migracao_crm']);
  assert.deepEqual(kinds('Assumir a sustentação da org existente.'), ['org_mal_aproveitada']);
  // Tarefas de rotina não são insatisfação (falso positivo visto na coleta real).
  assert.deepEqual(kinds('Garantir a qualidade dos dados das campanhas e fazer limpeza de dados.'), []);
  assert.deepEqual(kinds('Nossos controles em planilhas serão substituídos.'), ['processo_manual']);
  assert.deepEqual(kinds('Experiência com Excel e planilhas. Integração com sistemas legados.'), []);
  assert.match(classifyJob('Dev Salesforce', 'Migração do HubSpot para Salesforce.').pain[0].evidence, /hubspot/i);
});

test('consultoria em espanhol (Get on Board) é descartada; vaga já gravada sai na reclassificação', async () => {
  assert.equal(classifyJob('Desarrollador Salesforce', 'Somos una consultora tecnológica con proyectos para clientes.').consultancyStrong, true);
  assert.equal(classifyJob('Salesforce Developer', 'Buscamos talento para importante cliente del sector retail.').consultancyStrong, true);
  assert.equal(classifyJob('Salesforce Admin', 'Apoyar a nuestros clientes internos.').consultancyStrong, false);

  const { openDb } = await import('../src/db/index.ts');
  const { ingestJobs } = await import('../src/pipeline/ingestJobs.ts');
  const db = openDb(':memory:');
  const base = { source: 'getonbrd', externalId: 'x1', title: 'Salesforce Developer', companyName: 'Tech Andina', url: 'https://g/x1', publishedAt: null, city: null, state: null, country: 'CL', documentId: null };
  ingestJobs(db, [{ ...base, description: 'Apex y LWC.' }]);
  assert.equal((db.prepare('SELECT count(*) n FROM companies').get() as { n: number }).n, 1);
  const again = ingestJobs(db, [{ ...base, description: 'Apex y LWC. Somos una consultora especializada.' }]);
  assert.equal(again.skippedConsultancy, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM signals').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT count(*) n FROM companies').get() as { n: number }).n, 0); // conta órfã limpa
});
