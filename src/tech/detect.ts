// Detecção de tecnologia de CRM/marketing pelo DNS e pelo HTML da página inicial.
// DNS não acessa o site (só consulta registros públicos); o HTML passa pelo cliente educado (robots.txt).
import dns from 'node:dns/promises';
import type { PoliteClient } from '../http/client.ts';

export type VendorKind = 'salesforce' | 'concorrente';

export interface TechHit {
  vendor: string;          // nome mostrado no painel
  vendorKind: VendorKind;
  how: 'DNS (SPF)' | 'DNS (CNAME)' | 'site' | 'caso publicado';
  evidence: string;        // trecho do registro ou do HTML que comprova
  url: string;             // onde conferir
}

// Inclusões de SPF: quem envia e-mail em nome da empresa.
const SPF_RULES: [RegExp, string, VendorKind][] = [
  [/_spf\.salesforce\.com/, 'Salesforce (e-mail da plataforma)', 'salesforce'],
  [/exacttarget\.com|cust-spf\.exacttarget/, 'Marketing Cloud', 'salesforce'],
  [/pardot\.com/, 'Account Engagement (Pardot)', 'salesforce'],
  [/hubspotemail\.net|_spf\.hubspot/, 'HubSpot', 'concorrente'],
  [/rdstation|rd\.services/, 'RD Station', 'concorrente'],
  [/mktomail\.com|marketo/, 'Adobe Marketo', 'concorrente'],
  [/zcsend\.net/, 'Zoho Campaigns', 'concorrente'],
];

// Subdomínios típicos de ferramentas de marketing apontando (CNAME) para o fornecedor.
const CNAME_PROBES: [string, RegExp, string, VendorKind][] = [
  ['go', /pardot\.com/, 'Account Engagement (Pardot)', 'salesforce'],
  ['info', /pardot\.com/, 'Account Engagement (Pardot)', 'salesforce'],
  ['click', /exacttarget\.com|marketingcloudapis/, 'Marketing Cloud', 'salesforce'],
  ['cloud', /exacttarget\.com|marketingcloudapis/, 'Marketing Cloud', 'salesforce'],
  ['view', /exacttarget\.com/, 'Marketing Cloud', 'salesforce'],
];

// Marcas no HTML da página inicial.
const HTML_RULES: [RegExp, string, VendorKind][] = [
  [/pi\.pardot\.com|piAId\s*=/, 'Account Engagement (Pardot)', 'salesforce'],
  [/webto\.salesforce\.com|servlet\.WebToLead/i, 'Web-to-Lead (Sales Cloud)', 'salesforce'],
  [/embeddedservice|esw\.min\.js|salesforceliveagent|liveagent\.salesforce/i, 'Chat do Service Cloud', 'salesforce'],
  [/[a-z0-9-]+\.my\.site\.com|[a-z0-9-]+\.force\.com/i, 'Experience Cloud / Salesforce Sites', 'salesforce'],
  [/cdn\.evgnet\.com|igodigital\.com|cdn\.c360a\.salesforce\.com/, 'Marketing Cloud Personalization / Data Cloud', 'salesforce'],
  [/js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net/, 'HubSpot', 'concorrente'],
  [/d335luupugsy2\.cloudfront\.net|rdstation\.com\.br\/|rd-station/i, 'RD Station', 'concorrente'],
  [/munchkin\.marketo\.net/, 'Adobe Marketo', 'concorrente'],
  [/salesiq\.zoho|zsiqscript/i, 'Zoho SalesIQ', 'concorrente'],
  [/d365mktforms|mktdplp102cdn|dynamics\.com\/.*form/i, 'Dynamics 365 Marketing', 'concorrente'],
];

const dnsLink = (name: string, type: string) => `https://dns.google/query?name=${encodeURIComponent(name)}&rr_type=${type}`;

function snippet(text: string, index: number, len: number): string {
  return text.slice(Math.max(0, index - 60), index + len + 60).replace(/\s+/g, ' ').trim();
}

export interface DnsResolver {
  resolveTxt: (name: string) => Promise<string[][]>;
  resolveCname: (name: string) => Promise<string[]>;
}

export async function detectByDns(domain: string, resolver: DnsResolver = dns): Promise<TechHit[]> {
  const hits: TechHit[] = [];
  try {
    const spf = (await resolver.resolveTxt(domain)).map((r) => r.join('')).filter((t) => t.startsWith('v=spf1'));
    for (const record of spf) {
      for (const [re, vendor, vendorKind] of SPF_RULES) {
        if (re.test(record)) hits.push({ vendor, vendorKind, how: 'DNS (SPF)', evidence: record, url: dnsLink(domain, 'TXT') });
      }
    }
  } catch { /* sem TXT/SPF */ }
  for (const [sub, re, vendor, vendorKind] of CNAME_PROBES) {
    const name = `${sub}.${domain}`;
    try {
      const target = (await resolver.resolveCname(name)).join(', ');
      if (re.test(target)) hits.push({ vendor, vendorKind, how: 'DNS (CNAME)', evidence: `${name} → ${target}`, url: dnsLink(name, 'CNAME') });
    } catch { /* subdomínio não existe */ }
  }
  return hits;
}

export function detectInHtml(html: string, pageUrl: string): TechHit[] {
  const hits: TechHit[] = [];
  for (const [re, vendor, vendorKind] of HTML_RULES) {
    const m = re.exec(html);
    if (m) hits.push({ vendor, vendorKind, how: 'site', evidence: snippet(html, m.index, m[0].length), url: pageUrl });
  }
  return hits;
}

export async function detectByHtml(client: PoliteClient, domain: string): Promise<TechHit[]> {
  for (const url of [`https://www.${domain}/`, `https://${domain}/`]) {
    try {
      const res = await client.get(url, 'site');
      if (res.status === 200) return detectInHtml(res.text, url);
    } catch { /* robots.txt proíbe, ou site fora do ar: tenta a próxima variação */ }
  }
  return [];
}

// Um fornecedor aparece uma vez só (o primeiro meio que o detectou).
export function dedupeHits(hits: TechHit[]): TechHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.vendor) ? false : (seen.add(h.vendor), true)));
}

export async function detectTech(client: PoliteClient, domain: string, resolver?: DnsResolver): Promise<TechHit[]> {
  return dedupeHits([...(await detectByDns(domain, resolver)), ...(await detectByHtml(client, domain))]);
}
