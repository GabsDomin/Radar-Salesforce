// Coletor da Gupy: lê a busca pública do portal (portal.gupy.io/job-search).
// A página traz as vagas embutidas no JSON __NEXT_DATA__, 12 por página.
import type { PoliteClient } from '../http/client.ts';
import type { JobPosting } from './types.ts';
import { detectCountry, isAllowedCountry } from '../normalize/location.ts';

const BASE = 'https://portal.gupy.io/job-search/';
const MAX_PAGES_PER_TERM = 15;

interface GupyJob {
  id: number;
  name: string;
  description?: string;
  careerPageName?: string;
  publishedDate?: string;
  city?: string;
  state?: string;
  country?: string;
  jobUrl: string;
}

interface GupyPage {
  jobs: GupyJob[];
  total: number;
}

export function parseGupySearchPage(html: string): GupyPage {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Gupy: __NEXT_DATA__ não encontrado (layout da página mudou?)');
  const list = JSON.parse(m[1])?.props?.pageProps?.initialJobList;
  if (!list) throw new Error('Gupy: initialJobList ausente (layout da página mudou?)');
  return { jobs: list.data ?? [], total: list.pagination?.total ?? 0 };
}

export function searchUrl(term: string, page: number): string {
  const q = `term=${encodeURIComponent(term)}`;
  return BASE + (page > 1 ? `${q}&page=${page}` : q);
}

// País da vaga. A Gupy não informa o país: estado brasileiro = BR; cidade/estado de outro país da
// América Latina (ex.: "Lima") = aquele país; sem cidade e sem estado = remota no portal brasileiro (BR).
// Qualquer outro lugar = null (fora do escopo Brasil + América Latina).
export function gupyCountry(job: GupyJob): string | null {
  if (!job.city?.trim() && !job.state?.trim() && !job.country?.trim()) return 'BR';
  return detectCountry(job.city, job.state, job.country);
}

export function isInScopeGupyJob(job: GupyJob): boolean {
  return isAllowedCountry(gupyCountry(job));
}

export function toJobPosting(job: GupyJob, documentId: number | null): JobPosting {
  return {
    source: 'gupy',
    externalId: String(job.id),
    title: job.name.trim(),
    description: job.description ?? '',
    companyName: (job.careerPageName ?? '').trim(),
    url: job.jobUrl.replace(/\?.*$/, ''),
    publishedAt: job.publishedDate ?? null,
    city: job.city || null,
    state: job.state || null,
    country: gupyCountry(job) ?? 'desconhecido',
    documentId,
  };
}

export async function collectGupy(
  client: PoliteClient,
  terms: string[],
  log: (msg: string) => void = () => {},
): Promise<JobPosting[]> {
  const byId = new Map<string, JobPosting>();
  for (const term of terms) {
    let page = 1;
    let pages = 1;
    do {
      const res = await client.get(searchUrl(term, page), 'gupy');
      if (res.status !== 200) {
        log(`gupy: "${term}" página ${page} retornou HTTP ${res.status}, pulando termo`);
        break;
      }
      const { jobs, total } = parseGupySearchPage(res.text);
      pages = Math.min(Math.ceil(total / 12), MAX_PAGES_PER_TERM);
      for (const job of jobs.filter(isInScopeGupyJob)) {
        const posting = toJobPosting(job, res.documentId);
        byId.set(posting.externalId, posting);
      }
      log(`gupy: "${term}" página ${page}/${pages || 1} (${jobs.length} vagas, total ${total})`);
      page++;
    } while (page <= pages);
  }
  return [...byId.values()];
}
