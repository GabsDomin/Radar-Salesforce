// Coletor do Get on Board (getonbrd.com): portal de vagas de tecnologia da América Latina.
// API pública de busca (robots.txt libera tudo). Traz também vagas de SDR/CRM que usam Salesforce,
// o que revela empresas clientes de Salesforce na região.
import type { PoliteClient } from '../http/client.ts';
import type { JobPosting } from './types.ts';
import { detectCountry, isAllowedCountry } from '../normalize/location.ts';

const BASE = 'https://www.getonbrd.com/api/v0/search/jobs';
const PER_PAGE = 50;
const MAX_PAGES_PER_TERM = 3;

interface GobJob {
  id: string;
  attributes: {
    title: string;
    description?: string;
    functions?: string;
    desirable?: string;
    countries?: string[];
    location_cities?: { data?: { attributes?: { name?: string } }[] } | null;
    published_at?: number;
    company?: { data?: { attributes?: { name?: string; description?: string } } };
  };
  links?: { public_url?: string };
}

export function searchUrl(term: string, page: number): string {
  return `${BASE}?${new URLSearchParams({ query: term, per_page: String(PER_PAGE), page: String(page), expand: '["company"]' })}`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// Primeiro país da vaga que esteja no escopo (Brasil + América Latina); "Remote" sozinho não conta.
export function gobCountry(countries: string[] | undefined): string | null {
  for (const c of countries ?? []) {
    const iso = detectCountry(null, null, c);
    if (isAllowedCountry(iso)) return iso;
  }
  return null;
}

export function parseGetonbrd(json: string, documentId: number | null): { postings: JobPosting[]; totalPages: number } {
  const body = JSON.parse(json) as { data?: GobJob[]; meta?: { total_pages?: number } };
  const postings = (body.data ?? []).map((j): JobPosting => {
    const a = j.attributes;
    const city = a.location_cities?.data?.[0]?.attributes?.name ?? null;
    return {
      source: 'getonbrd',
      externalId: j.id,
      title: a.title.trim(),
      // A descrição da empresa entra junto: é onde consultorias se apresentam ("Somos una consultora de TI").
      description: stripHtml([a.description, a.functions, a.desirable].filter(Boolean).join(' '))
        + (a.company?.data?.attributes?.description ? ` Sobre a empresa: ${stripHtml(a.company.data.attributes.description)}` : ''),
      companyName: (a.company?.data?.attributes?.name ?? '').trim(),
      url: j.links?.public_url ?? `https://www.getonbrd.com/jobs/${j.id}`,
      publishedAt: a.published_at ? new Date(a.published_at * 1000).toISOString() : null,
      city,
      state: null,
      country: gobCountry(a.countries) ?? 'desconhecido',
      documentId,
    };
  });
  return { postings, totalPages: body.meta?.total_pages ?? 1 };
}

export async function collectGetonbrd(
  client: PoliteClient,
  terms: string[],
  log: (msg: string) => void = () => {},
): Promise<JobPosting[]> {
  const byId = new Map<string, JobPosting>();
  for (const term of terms) {
    let page = 1;
    let pages = 1;
    do {
      try {
        const res = await client.get(searchUrl(term, page), 'getonbrd');
        if (res.status !== 200) {
          log(`getonbrd: "${term}" página ${page} retornou HTTP ${res.status}, pulando termo`);
          break;
        }
        const { postings, totalPages } = parseGetonbrd(res.text, res.documentId);
        pages = Math.min(totalPages, MAX_PAGES_PER_TERM);
        for (const p of postings) byId.set(p.externalId, p);
        log(`getonbrd: "${term}" página ${page}/${pages} (${postings.length} vagas)`);
      } catch (err) {
        log(`getonbrd: "${term}" falhou (${err instanceof Error ? err.message : err}), pulando termo`);
        break;
      }
      page++;
    } while (page <= pages);
  }
  return [...byId.values()];
}
