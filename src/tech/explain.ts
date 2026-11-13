// Traduz a evidência técnica (registro SPF, CNAME, trecho de HTML) para uma frase que um vendedor entende.
// A evidência bruta continua no banco; isto só muda o que aparece na tela.

// Serviços conhecidos que aparecem em registros SPF (quem envia e-mail em nome da empresa).
const SPF_SERVICES: [RegExp, string][] = [
  [/_spf\.salesforce\.com/, 'Salesforce'],
  [/exacttarget\.com/, 'Salesforce Marketing Cloud'],
  [/pardot\.com/, 'Account Engagement (Pardot)'],
  [/spf\.protection\.outlook\.com/, 'Microsoft 365'],
  [/_spf\.google\.com|googlemail/, 'Google Workspace'],
  [/marketing\.dynamics\.com|dynamics\.com/, 'Dynamics 365 Marketing'],
  [/hubspotemail\.net|_spf\.hubspot/, 'HubSpot'],
  [/rdstation|rd\.services/, 'RD Station'],
  [/mktomail\.com|marketo/, 'Adobe Marketo'],
  [/zcsend\.net|zoho/, 'Zoho'],
  [/mandrillapp\.com/, 'Mailchimp (Mandrill)'],
  [/mcsv\.net|mailchimp/, 'Mailchimp'],
  [/sendgrid\.net/, 'SendGrid'],
  [/amazonses\.com/, 'Amazon SES'],
  [/mailgun\.org/, 'Mailgun'],
  [/sparkpostmail\.com/, 'SparkPost'],
  [/zendesk\.com/, 'Zendesk'],
  [/freshdesk|freshemail/, 'Freshdesk'],
  [/mailjet\.com/, 'Mailjet'],
  [/oraclecloud|eloqua/, 'Oracle Eloqua'],
];

const plainVendor = (v: string) => v.replace(/\s*\(e-mail da plataforma\)/, '');

function listPt(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function explainSpf(record: string, vendor: string, domain?: string): string {
  const includes = [...record.matchAll(/include:(\S+)/g)].map((m) => m[1]);
  const others = new Set<string>();
  let unknown = 0;
  const main = plainVendor(vendor);
  for (const inc of includes) {
    const hit = SPF_SERVICES.find(([re]) => re.test(inc));
    if (hit) {
      if (hit[1] !== main && !hit[1].endsWith(main)) others.add(hit[1]); // "Marketing Cloud" = "Salesforce Marketing Cloud"
    } else if (!domain || !inc.includes(domain.split('.')[0])) unknown++;
  }
  const who = domain ? `O domínio ${domain}` : 'O domínio da empresa';
  let text = `${who} autoriza ${main} a enviar e-mails em seu nome (registro SPF do DNS): sinal de que usa a ferramenta com clientes.`;
  const list = [...others];
  if (list.length && unknown) list.push(unknown === 1 ? 'mais 1 serviço' : `mais ${unknown} serviços`);
  if (list.length) text += ` Também envia e-mail por ${listPt(list)}.`;
  return text;
}

export function explainCname(evidence: string, vendor: string): string {
  const [name, target] = evidence.split(' → ');
  if (!target) return evidence;
  return `O endereço ${name} aponta para ${target}, servidor do ${vendor}: usado em páginas, formulários ou e-mails de campanha.`;
}

// O que cada marca no HTML costuma indicar.
const HTML_PURPOSE: Record<string, string> = {
  'Account Engagement (Pardot)': 'rastreamento e formulários de marketing',
  'Web-to-Lead (Sales Cloud)': 'formulário que cria leads direto no Salesforce',
  'Chat do Service Cloud': 'chat de atendimento',
  'Experience Cloud / Salesforce Sites': 'portal ou site feito na Salesforce',
  'Marketing Cloud Personalization / Data Cloud': 'personalização e dados de clientes',
  HubSpot: 'rastreamento e formulários de marketing',
  'RD Station': 'rastreamento e formulários de marketing',
  'Adobe Marketo': 'rastreamento de marketing',
  'Zoho SalesIQ': 'chat e rastreamento de visitantes',
  'Dynamics 365 Marketing': 'formulários de marketing',
};

export function explainHtml(vendor: string): string {
  const purpose = HTML_PURPOSE[vendor];
  return `O site da empresa usa ${vendor}${purpose ? ` (${purpose})` : ''}, encontrado no código da página inicial.`;
}

// Evidência legível para qualquer sinal; só sinais de tecnologia por DNS/site são traduzidos.
export function readableEvidence(s: { type: string; evidence: string | null; meta: string | null }): string {
  const ev = s.evidence ?? '';
  if (s.type !== 'tecnologia' || !ev || !s.meta) return ev;
  let meta: { vendor?: string; how?: string; domain?: string };
  try { meta = JSON.parse(s.meta); } catch { return ev; }
  if (!meta.vendor) return ev;
  if (meta.how === 'DNS (SPF)') return explainSpf(ev, meta.vendor, meta.domain);
  if (meta.how === 'DNS (CNAME)') return explainCname(ev, meta.vendor);
  if (meta.how === 'site') return explainHtml(meta.vendor);
  return ev;
}
