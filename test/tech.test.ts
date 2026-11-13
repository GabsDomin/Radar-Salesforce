import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteClient, type FetchFn } from '../src/http/client.ts';
import { detectByDns, detectInHtml, detectTech, type DnsResolver } from '../src/tech/detect.ts';
import { parseCvm, domainFromEmail, cleanCompanyName } from '../src/sources/cvm.ts';
import { runTech } from '../src/pipeline/tech.ts';
import { openDb } from '../src/db/index.ts';
import { ingestJobs } from '../src/pipeline/ingestJobs.ts';
import { scoreAll } from '../src/scoring/score.ts';
import { getCompany } from '../src/web/queries.ts';
import { modalityRows } from '../src/web/modalities.ts';
import { classifyJob } from '../src/classify/job.ts';

function resolver(txt: Record<string, string[]>, cname: Record<string, string>): DnsResolver {
  return {
    resolveTxt: async (n) => { if (!txt[n]) throw new Error('ENODATA'); return txt[n].map((t) => [t]); },
    resolveCname: async (n) => { if (!cname[n]) throw new Error('ENOTFOUND'); return [cname[n]]; },
  };
}

function fakeFetch(routes: Record<string, { status: number; body: string }>): FetchFn {
  return (async (input: string | URL | Request) => {
    const hit = routes[String(input)] ?? { status: 404, body: '' };
    return new Response(hit.body, { status: hit.status });
  }) as FetchFn;
}

test('DNS: SPF e CNAME revelam Salesforce e concorrentes, com link para conferir', async () => {
  const hits = await detectByDns('alfa.com.br', resolver(
    { 'alfa.com.br': ['v=spf1 include:_spf.salesforce.com include:hubspotemail.net ~all', 'google-site-verification=x'] },
    { 'go.alfa.com.br': 'go.pardot.com', 'click.alfa.com.br': 'click.s10.exacttarget.com' },
  ));
  assert.deepEqual(hits.map((h) => [h.vendor, h.vendorKind, h.how]), [
    ['Salesforce (e-mail da plataforma)', 'salesforce', 'DNS (SPF)'],
    ['HubSpot', 'concorrente', 'DNS (SPF)'],
    ['Account Engagement (Pardot)', 'salesforce', 'DNS (CNAME)'],
    ['Marketing Cloud', 'salesforce', 'DNS (CNAME)'],
  ]);
  assert.match(hits[2].url, /^https:\/\/dns\.google\/query\?name=go\.alfa\.com\.br&rr_type=CNAME$/);
  assert.deepEqual(await detectByDns('nada.com', resolver({}, {})), []);
});

test('HTML: Pardot, Web-to-Lead, chat, RD Station e HubSpot', () => {
  const html = `<script>piAId = '123'; piHostname = 'pi.pardot.com';</script>
    <form action="https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8">
    <script src="https://d335luupugsy2.cloudfront.net/js/loader-scripts/abc-loader.js"></script>
    <script src="//js.hs-scripts.com/123.js"></script>`;
  const vendors = detectInHtml(html, 'https://www.alfa.com.br/').map((h) => h.vendor);
  assert.deepEqual(vendors, ['Account Engagement (Pardot)', 'Web-to-Lead (Sales Cloud)', 'HubSpot', 'RD Station']);
  assert.deepEqual(detectInHtml('<html>site comum</html>', 'x'), []);
});

test('detectTech junta DNS e site sem repetir fornecedor', async () => {
  const client = new PoliteClient({ sleep: async () => {}, fetchFn: fakeFetch({
    'https://www.alfa.com.br/robots.txt': { status: 404, body: '' },
    'https://www.alfa.com.br/': { status: 200, body: '<script>piAId=1; pi.pardot.com</script>' },
  }) });
  const hits = await detectTech(client, 'alfa.com.br', resolver({}, { 'go.alfa.com.br': 'go.pardot.com' }));
  assert.deepEqual(hits.map((h) => [h.vendor, h.how]), [['Account Engagement (Pardot)', 'DNS (CNAME)']]);
});

test('CVM: filtra setor do perfil, tira holdings e recuperação judicial, domínio pelo e-mail', () => {
  assert.equal(domainFromEmail('ri@alfa.com.br'), 'alfa.com.br');
  assert.equal(domainFromEmail('dri@ri.beta.com'), 'beta.com');
  assert.equal(domainFromEmail('fulano@gmail.com'), null);
  assert.equal(cleanCompanyName('BANCO ALFA S.A.'), 'Banco Alfa');
  const csv = [
    'CNPJ_CIA;DENOM_SOCIAL;DENOM_COMERC;SIT;SETOR_ATIV;MUN;UF;EMAIL;EMAIL_RESP',
    '1;BANCO ALFA S.A.;BANCO ALFA;ATIVO;Bancos;SAO PAULO;SP;ri@alfa.com.br;',
    '2;USINA BETA S.A.;;ATIVO;Agricultura (Açúcar, Álcool e Cana);RIBEIRAO PRETO;SP;;dri@beta.com.br',
    '3;GAMA PARTICIPACOES S.A.;;ATIVO;Emp. Adm. Part. - Alimentos;;;ri@gama.com.br;',
    '4;DELTA S.A. - EM RECUPERAÇÃO JUDICIAL;;ATIVO;Alimentos;;;ri@delta.com.br;',
    '5;ENERGIA EPSILON S.A.;;ATIVO;Energia Elétrica;;;ri@epsilon.com.br;',
    '6;BANCO ZETA S.A.;;CANCELADA;Bancos;;;ri@zeta.com.br;',
  ].join('\n');
  const rows = parseCvm(csv);
  assert.deepEqual(rows.map((r) => [r.name, r.sector, r.domain]), [['Banco Alfa', 'financeiro', 'alfa.com.br'], ['Usina Beta', 'agro', 'beta.com.br']]);
});

test('etapa tecnologia: enriquece lead existente e só cria lead novo da CVM quando detecta algo', async () => {
  const db = openDb(':memory:');
  ingestJobs(db, [{ source: 'gupy', externalId: '1', title: 'Dev Salesforce', description: 'Apex.', companyName: 'Banco Alfa', url: 'https://a/1', publishedAt: new Date().toISOString(), city: 'São Paulo', state: 'São Paulo', country: 'BR', documentId: null }]);
  const cvm = [
    { name: 'Banco Alfa', cnpj: '1', cvmSector: 'Bancos', sector: 'financeiro' as const, domain: 'alfa.com.br', city: null, state: 'SP' },
    { name: 'Usina Beta', cnpj: '2', cvmSector: 'Agricultura', sector: 'agro' as const, domain: 'beta.com.br', city: 'Ribeirao Preto', state: 'SP' },
    { name: 'Metal Gama', cnpj: '3', cvmSector: 'Metalurgia', sector: 'industria' as const, domain: 'gama.com.br', city: null, state: null },
  ];
  const client = new PoliteClient({ db, sleep: async () => {}, fetchFn: fakeFetch({}) });
  const dnsr = resolver({ 'beta.com.br': ['v=spf1 include:spf.rdstation.com.br ~all'] }, { 'go.alfa.com.br': 'go.pardot.com' });
  const stats = await runTech(db, client, () => {}, { cvm, resolver: dnsr });
  assert.equal(stats.leadsEnriched, 1);
  assert.equal(stats.newLeads, 1);           // Usina Beta (RD Station); Metal Gama sem nada não entra
  assert.equal(stats.withSalesforce, 1);
  assert.equal(stats.withCompetitor, 1);
  assert.deepEqual((db.prepare('SELECT name FROM companies ORDER BY name').all() as { name: string }[]).map((r) => r.name), ['Banco Alfa', 'Usina Beta']);

  scoreAll(db);
  const id = (n: string) => (db.prepare('SELECT id FROM companies WHERE name = ?').get(n) as { id: number }).id;
  const alfa = getCompany(db, id('Banco Alfa'))!;
  assert.equal(alfa.company.sector_source, 'cvm: Bancos');
  assert.equal(alfa.breakdown.find((b) => b.rule === 'Setor-alvo')!.points, 15);         // confirmado pela CVM
  assert.equal(alfa.breakdown.find((b) => b.rule === 'Tecnologia Salesforce')!.points, 20); // confirmado no DNS
  const beta = getCompany(db, id('Usina Beta'))!;
  assert.equal(beta.breakdown.find((b) => b.rule === 'Usa CRM concorrente')!.points, 12);
  assert.equal(beta.breakdown.find((b) => b.rule === 'Tecnologia Salesforce')!.points, 0);

  assert.equal(modalityRows(db, 'tecnologia').length, 2);
  assert.deepEqual(modalityRows(db, 'concorrente').map((r) => r.company), ['Usina Beta']);

  // Rodar de novo não duplica.
  const again = await runTech(db, client, () => {}, { cvm, resolver: dnsr });
  assert.equal(again.newSignals, 0);
});

test('CRM concorrente nas vagas: entra sem citar Salesforce; "SAP Sales Cloud" não é Salesforce', async () => {
  const c = classifyJob('Analista de CRM', 'Gestão do HubSpot e integrações com o ERP.');
  assert.equal(c.isSalesforce, false);
  assert.deepEqual(c.competitorCrms, ['HubSpot']);
  assert.equal(c.opsRole, true);
  const sap = classifyJob('Consultor SAP', 'Experiência com SAP Sales Cloud e SAP Service Cloud.');
  assert.equal(sap.isSalesforce, false);
  assert.deepEqual(sap.clouds, []);
  assert.deepEqual(sap.competitorCrms, ['SAP CRM / C4C']);
  assert.equal(classifyJob('Dev', 'Salesforce Sales Cloud').isSalesforce, true);
  assert.equal(classifyJob('Analista', 'Somos uma agência parceira HubSpot.').consultancyStrong, true);

  const db = openDb(':memory:');
  const base = { source: 'gupy', publishedAt: new Date().toISOString(), city: null, state: null, country: 'BR', documentId: null };
  const stats = ingestJobs(db, [
    { ...base, externalId: '1', title: 'Analista de CRM', description: 'Gestão do HubSpot.', companyName: 'Indústria Alfa', url: 'https://a/1' },
    { ...base, externalId: '2', title: 'Analista de Marketing', description: 'Google Ads.', companyName: 'Beta', url: 'https://a/2' },
  ]);
  assert.equal(stats.competitorCrm, 1);
  assert.equal(stats.notSalesforce, 1);
  scoreAll(db);
  // Na aba Vagas ela aparece, separada pelo filtro "Tipo de vaga".
  const vagas = modalityRows(db, 'vagas');
  assert.deepEqual(vagas.map((r) => r.facets.tipo), [['Vaga de CRM concorrente']]);
  assert.deepEqual(vagas[0].facets.crm, ['HubSpot']);
  assert.deepEqual(vagas[0].facets.pais, ['Brasil']);
  const { modalityPage } = await import('../src/web/pages.ts');
  const { MODALITIES } = await import('../src/web/modalities.ts');
  const html = modalityPage(MODALITIES.find((m) => m.id === 'vagas')!, vagas, null);
  assert.match(html, /<select data-facet="tipo"><option value="">Todos<\/option><option value="Vaga de CRM concorrente">Vaga de CRM concorrente \(1\)<\/option>/);
  assert.match(html, /data-f-crm="HubSpot"/);
  assert.doesNotMatch(html, /data-facet="area"/); // filtro de outra aba não aparece
  assert.equal(modalityRows(db, 'concorrente').length, 1);
  const d = getCompany(db, (db.prepare('SELECT id FROM companies').get() as { id: number }).id)!;
  assert.equal(d.breakdown.find((b) => b.rule === 'Vaga Salesforce aberta')!.points, 0);
  assert.equal(d.breakdown.find((b) => b.rule === 'Usa CRM concorrente')!.points, 15); // 12 + 3 (cargo de CRM)
  assert.ok(d.offers.some((o) => o.offer === 'Ágil'));
});

test('casos de clientes Salesforce: lista do sitemap, nome pelo endereço, só Brasil/América Latina vira lead', async () => {
  const { storyUrls, parseStory, slugToName } = await import('../src/sources/customerStories.ts');
  const { runCases } = await import('../src/pipeline/tech.ts');
  const sm = ['https://www.salesforce.com/br/customer-stories/', 'https://www.salesforce.com/br/customer-stories/cacau-show/',
    'https://www.salesforce.com/br/customer-stories/agentforce-for-customer-support/', 'https://www.salesforce.com/br/customer-stories/formula-one/',
    'https://www.salesforce.com/br/blog/x/'].map((u) => `<url><loc>${u}</loc></url>`).join('');
  assert.deepEqual(storyUrls(sm), ['https://www.salesforce.com/br/customer-stories/cacau-show/', 'https://www.salesforce.com/br/customer-stories/formula-one/']);
  assert.equal(slugToName('cacau-show'), 'Cacau Show');

  const page = (title: string, body: string) => `<html><head><title>${title}</title><meta property="og:title" content="${title}">
    <meta name="description" content="Resultado do caso."></head><body><nav>Brasil</nav><main><p>${body}</p></main><footer>Brasil | México</footer></body></html>`;
  const cacau = parseStory(page('Cacau Show cresce com Salesforce', 'Fábrica em São Paulo e 4.600 lojas.'), 'https://www.salesforce.com/br/customer-stories/cacau-show/');
  const f1 = parseStory(page('Formula 1 conecta fãs', 'Corridas no mundo todo.'), 'https://www.salesforce.com/br/customer-stories/formula-one/');
  assert.deepEqual([cacau.company, cacau.latam, f1.latam], ['Cacau Show', true, false]); // nav/rodapé não contam

  const db = openDb(':memory:');
  db.prepare("INSERT INTO exclusions (kind, name, normalized_name, origin) VALUES ('cliente', 'Valori', 'valori', 't')").run();
  const valori = { ...cacau, company: 'Valori', slug: 'valori', url: 'https://www.salesforce.com/br/customer-stories/valori/' };
  const stats = await runCases(db, new PoliteClient({ sleep: async () => {} }), () => {}, [cacau, f1, valori]);
  assert.deepEqual([stats.latam, stats.newLeads, stats.excluded], [2, 1, 1]);
  scoreAll(db);
  const d = getCompany(db, (db.prepare("SELECT id FROM companies WHERE name = 'Cacau Show'").get() as { id: number }).id)!;
  assert.equal(d.breakdown.find((b) => b.rule === 'Tecnologia Salesforce')!.points, 20);
  assert.equal(d.signals[0].source, 'salesforce-casos');
  assert.equal((await runCases(db, new PoliteClient({ sleep: async () => {} }), () => {}, [cacau])).newSignals, 0); // não duplica
});

test('CVM com nome antigo liga ao lead pelo domínio (Banco UBS Pactual ↔ BTG Pactual)', async () => {
  const db = openDb(':memory:');
  ingestJobs(db, [{ source: 'greenhouse', externalId: '1', title: 'Salesforce Developer', description: 'Apex.', companyName: 'BTG Pactual', url: 'https://a/1', publishedAt: new Date().toISOString(), city: 'São Paulo', state: null, country: 'BR', documentId: null }]);
  const cvm = [{ name: 'Banco Ubs Pactual', cnpj: '9', cvmSector: 'Bancos', sector: 'financeiro' as const, domain: 'btgpactual.com', city: null, state: null }];
  const stats = await runTech(db, new PoliteClient({ db, sleep: async () => {}, fetchFn: fakeFetch({}) }), () => {},
    { cvm, resolver: resolver({ 'btgpactual.com': ['v=spf1 include:_spf.salesforce.com ~all'] }, {}) });
  assert.deepEqual([stats.leadsEnriched, stats.newLeads], [1, 0]);
  assert.deepEqual((db.prepare('SELECT name, domain FROM companies').all() as { name: string; domain: string }[]).map((r) => [r.name, r.domain]), [['BTG Pactual', 'btgpactual.com']]);
});

test('evidência técnica vira frase legível', async () => {
  const { readableEvidence } = await import('../src/tech/explain.ts');
  const spf = 'v=spf1 include:spf.protection.outlook.com include:mail.zendesk.com include:marketing.dynamics.com include:cust-spf.exacttarget.com include:_spf1.btgpactual.com include:spf.mandrillapp.com include:_spf.salesforce.com ip4:204.239.0.224/27 ~all';
  const txt = readableEvidence({ type: 'tecnologia', evidence: spf, meta: JSON.stringify({ vendor: 'Salesforce (e-mail da plataforma)', how: 'DNS (SPF)', domain: 'btgpactual.com' }) });
  assert.equal(txt, 'O domínio btgpactual.com autoriza Salesforce a enviar e-mails em seu nome (registro SPF do DNS): sinal de que usa a ferramenta com clientes. Também envia e-mail por Microsoft 365, Zendesk, Dynamics 365 Marketing, Salesforce Marketing Cloud e Mailchimp (Mandrill).');
  assert.doesNotMatch(txt, /ip4|include/);
  assert.match(readableEvidence({ type: 'tecnologia', evidence: 'go.alfa.com.br → go.pardot.com', meta: JSON.stringify({ vendor: 'Account Engagement (Pardot)', how: 'DNS (CNAME)' }) }), /^O endereço go\.alfa\.com\.br aponta para go\.pardot\.com/);
  assert.equal(readableEvidence({ type: 'tecnologia', evidence: '<script src="https://js.hs-scripts.com/123.js">', meta: JSON.stringify({ vendor: 'HubSpot', how: 'site' }) }), 'O site da empresa usa HubSpot (rastreamento e formulários de marketing), encontrado no código da página inicial.');
  assert.equal(readableEvidence({ type: 'vaga', evidence: 'texto da vaga', meta: null }), 'texto da vaga');
});
