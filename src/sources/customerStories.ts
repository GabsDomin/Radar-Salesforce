// Histórias de clientes publicadas pela Salesforce Brasil (salesforce.com/br/customer-stories).
// A lista vem do sitemap (liberado no robots.txt); cada página traz título e descrição do caso.
// Empresa com caso publicado = cliente Salesforce confirmado (bom alvo para sustentação, alocação ou troca de parceiro).
import type { PoliteClient } from '../http/client.ts';

export const SITEMAP_URL = 'https://www.salesforce.com/br/sitemap.xml';
const STORY_RE = /^https:\/\/www\.salesforce\.com\/br\/customer-stories\/([a-z0-9-]+)\/$/;

// Páginas da seção que não são de um cliente.
const NOT_A_CUSTOMER = /^(agentforce|customer-success|industries|industria|setor|sales|service|marketing|commerce|platform|slack|tableau|mulesoft|small-business|pme)(-|$)/;

// Menção a Brasil ou América Latina no texto do caso (casos globais traduzidos não mencionam).
const LATAM_CUE = /\b(brasil|brasileir[ao]s?|s[aã]o paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|recife|salvador|fortaleza|campinas|m[eé]xico|chile|col[oô]mbia|argentina|peru|uruguai|am[eé]rica latina|latam)\b/i;

export interface CustomerStory { company: string; slug: string; url: string; title: string; description: string; latam: boolean }

export function storyUrls(sitemapXml: string): string[] {
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return [...new Set(urls)].filter((u) => {
    const m = u.match(STORY_RE);
    return !!m && !NOT_A_CUSTOMER.test(m[1]);
  });
}

export function slugToName(slug: string): string {
  return slug.split('-').map((w) => (w.length <= 3 && /^(sa|s|ltda|do|da|de|dos|das|e)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

const meta = (html: string, attr: string) =>
  (html.match(new RegExp(`<meta[^>]+(?:property|name)="${attr}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function parseStory(html: string, url: string): CustomerStory {
  const slug = url.match(STORY_RE)?.[1] ?? '';
  const title = meta(html, 'og:title') || (html.match(/<title[^>]*>([^<]*)/)?.[1] ?? '').trim();
  const description = meta(html, 'description') || meta(html, 'og:description');
  // O corpo do caso fica no <main>; nav e rodapé (com seletor de país) ficam de fora da checagem.
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = main.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return { company: slugToName(slug), slug, url, title, description, latam: LATAM_CUE.test(`${title} ${description} ${text}`) };
}

export async function collectCustomerStories(client: PoliteClient, log: (m: string) => void = () => {}): Promise<CustomerStory[]> {
  const sm = await client.get(SITEMAP_URL, 'salesforce-casos');
  if (sm.status !== 200) throw new Error(`sitemap respondeu HTTP ${sm.status}`);
  const urls = storyUrls(sm.text);
  log(`Casos de clientes Salesforce Brasil: ${urls.length} página(s) no sitemap.`);
  const out: CustomerStory[] = [];
  for (const url of urls) {
    try {
      const res = await client.get(url, 'salesforce-casos');
      if (res.status === 200) out.push(parseStory(res.text, url));
    } catch (err) {
      log(`caso ${url} falhou (${err instanceof Error ? err.message : err})`);
    }
  }
  return out;
}
