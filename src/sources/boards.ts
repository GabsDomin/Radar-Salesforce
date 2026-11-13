// Coletores de APIs públicas de vagas por empresa: Greenhouse, Lever, Workable, Ashby e Workday.
// Diferente da Gupy (busca aberta), aqui é preciso saber o "quadro" (slug) de cada empresa;
// a lista fica em seeds/quadros.csv e cresce com o tempo.
import type { PoliteClient } from '../http/client.ts';
import type { JobPosting } from './types.ts';
import { detectCountry, isAllowedCountry } from '../normalize/location.ts';

export type BoardKind = 'greenhouse' | 'lever' | 'workable' | 'ashby' | 'workday';
export interface Board {
  kind: BoardKind;
  slug: string;
  company: string;
}

// Vagas relevantes: citam Salesforce ou um CRM concorrente (a classificação fina é feita no ingest).
const SF_RE = /salesforce|pardot|marketing cloud|service cloud|sales cloud|experience cloud|data cloud|agentforce|account engagement|\bapex\b|hubspot|rd ?station|dynamics ?365|dynamics crm|\bzoho\b|pipedrive|\bc4c\b|siebel|marketo|ploomes|agendor|bitrix/i;
// Escopo: Brasil + América Latina. Localização vazia ou "Remote" genérico não bastam.
export function regionOf(location: string): string | null {
  const iso = detectCountry(location, null, null);
  return isAllowedCountry(iso) ? iso : null;
}

function stripHtml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    // O Greenhouse escapa duas vezes: depois do primeiro passo ainda sobram entidades como &nbsp;.
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Greenhouse ----------
interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
}

export function parseGreenhouse(json: string, board: Board, documentId: number | null): JobPosting[] {
  const jobs: GhJob[] = JSON.parse(json).jobs ?? [];
  return jobs
    .map((j) => ({ j, description: stripHtml(j.content ?? '') }))
    .filter(({ j, description }) => SF_RE.test(`${j.title} ${description}`) && regionOf(j.location?.name ?? '') !== null)
    .map(({ j, description }) => ({
      source: 'greenhouse',
      externalId: `${board.slug}:${j.id}`,
      title: j.title.trim(),
      description,
      companyName: board.company,
      url: j.absolute_url,
      publishedAt: j.updated_at ?? null,
      city: j.location?.name || null,
      state: null,
      country: regionOf(j.location?.name ?? '') ?? 'desconhecido',
      documentId,
    }));
}

// ---------- Lever ----------
interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  descriptionPlain?: string;
  categories?: { location?: string };
}

export function parseLever(json: string, board: Board, documentId: number | null): JobPosting[] {
  const jobs: LeverJob[] = JSON.parse(json);
  if (!Array.isArray(jobs)) throw new Error('Lever: resposta inesperada (esperava lista de vagas)');
  return jobs
    .filter((j) => SF_RE.test(`${j.text} ${j.descriptionPlain ?? ''}`) && regionOf(j.categories?.location ?? '') !== null)
    .map((j) => ({
      source: 'lever',
      externalId: `${board.slug}:${j.id}`,
      title: j.text.trim(),
      description: (j.descriptionPlain ?? '').replace(/\s+/g, ' ').trim(),
      companyName: board.company,
      url: j.hostedUrl,
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      city: j.categories?.location || null,
      state: null,
      country: regionOf(j.categories?.location ?? '') ?? 'desconhecido',
      documentId,
    }));
}

// (SmartRecruiters foi removido: o robots.txt da API proíbe robôs.)

// ---------- Workable (API pública do widget de vagas) ----------
interface WkJob {
  title: string; shortcode: string; url?: string; shortlink?: string; published_on?: string; created_at?: string;
  city?: string; state?: string; country?: string; description?: string;
  locations?: { country?: string; countryCode?: string; city?: string; region?: string }[];
}

export function parseWorkable(json: string, board: Board, documentId: number | null): JobPosting[] {
  const jobs: WkJob[] = JSON.parse(json).jobs ?? [];
  return jobs.map((j) => {
    const loc = j.locations?.[0];
    const country = detectCountry(loc?.city ?? j.city, loc?.region ?? j.state, loc?.countryCode ?? loc?.country ?? j.country);
    return { j, country, description: stripHtml(j.description ?? '') };
  })
    .filter(({ j, country, description }) => SF_RE.test(`${j.title} ${description}`) && isAllowedCountry(country))
    .map(({ j, country, description }) => ({
      source: 'workable',
      externalId: `${board.slug}:${j.shortcode}`,
      title: j.title.trim(),
      description,
      companyName: board.company,
      url: j.url ?? j.shortlink ?? `https://apply.workable.com/${board.slug}/j/${j.shortcode}/`,
      publishedAt: j.published_on ?? j.created_at ?? null,
      city: j.locations?.[0]?.city ?? j.city ?? null,
      state: j.locations?.[0]?.region ?? j.state ?? null,
      country: country!,
      documentId,
    }));
}

// ---------- Ashby (API pública de vagas) ----------
interface AshbyJob {
  id?: string; title: string; location?: string; descriptionPlain?: string; publishedAt?: string; jobUrl?: string;
  address?: { postalAddress?: { addressCountry?: string; addressLocality?: string; addressRegion?: string } };
}

export function parseAshby(json: string, board: Board, documentId: number | null): JobPosting[] {
  const jobs: AshbyJob[] = JSON.parse(json).jobs ?? [];
  return jobs.map((j) => {
    const a = j.address?.postalAddress;
    const country = detectCountry(a?.addressLocality ?? j.location, a?.addressRegion, a?.addressCountry) ?? regionOf(j.location ?? '');
    return { j, country };
  })
    .filter(({ j, country }) => SF_RE.test(`${j.title} ${j.descriptionPlain ?? ''}`) && isAllowedCountry(country))
    .map(({ j, country }) => ({
      source: 'ashby',
      externalId: `${board.slug}:${j.id ?? j.jobUrl ?? j.title}`,
      title: j.title.trim(),
      description: (j.descriptionPlain ?? '').replace(/\s+/g, ' ').trim(),
      companyName: board.company,
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${board.slug}`,
      publishedAt: j.publishedAt ?? null,
      city: j.address?.postalAddress?.addressLocality ?? j.location ?? null,
      state: j.address?.postalAddress?.addressRegion ?? null,
      country: country!,
      documentId,
    }));
}

// ---------- Workday (busca pública do site de carreiras) ----------
// slug = "tenant|wdN|site", tirado do link de carreiras da empresa (ex.: empresa.wd3.myworkdayjobs.com/Externo).
interface WdJob { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[] }

export function workdayParts(slug: string): { tenant: string; wd: string; site: string } | null {
  const [tenant, wd, site] = slug.split('|');
  return tenant && /^wd\d+$/.test(wd ?? '') && site ? { tenant, wd, site } : null;
}

export function parseWorkday(json: string, board: Board, documentId: number | null): JobPosting[] {
  const p = workdayParts(board.slug)!;
  const jobs: WdJob[] = JSON.parse(json).jobPostings ?? [];
  // A busca já foi feita por termo de CRM no servidor; o título e o local decidem o resto.
  return jobs
    .map((j) => ({ j, country: regionOf(j.locationsText ?? '') ?? (/locations?$/i.test(j.locationsText ?? '') ? 'BR' : null) }))
    .filter(({ country }) => isAllowedCountry(country))
    .map(({ j, country }) => ({
      source: 'workday',
      externalId: `${p.tenant}:${j.externalPath}`,
      title: j.title.trim(),
      description: j.title,
      companyName: board.company,
      url: `https://${p.tenant}.${p.wd}.myworkdayjobs.com/${p.site}${j.externalPath}`,
      publishedAt: null,
      city: j.locationsText ?? null,
      state: null,
      country: country!,
      documentId,
    }));
}

export function boardUrl(b: Board): string {
  switch (b.kind) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}/jobs?content=true`;
    case 'lever': return `https://api.lever.co/v0/postings/${encodeURIComponent(b.slug)}?mode=json`;
    case 'workable': return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.slug)}?details=true`;
    case 'ashby': return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}`;
    case 'workday': {
      const p = workdayParts(b.slug)!;
      return `https://${p.tenant}.${p.wd}.myworkdayjobs.com/wday/cxs/${p.tenant}/${p.site}/jobs`;
    }
  }
}

// Workday: busca no servidor por termos de CRM (a listagem completa pode ter milhares de vagas).
const WORKDAY_TERMS = ['salesforce', 'crm'];

const PARSERS = { greenhouse: parseGreenhouse, lever: parseLever, workable: parseWorkable, ashby: parseAshby, workday: parseWorkday };

export function parseBoards(rows: Record<string, string>[]): Board[] {
  const out: Board[] = [];
  for (const r of rows) {
    const kind = (r.fonte ?? '').toLowerCase() as BoardKind;
    if (!(kind in PARSERS) || !r.slug) continue;
    out.push({ kind, slug: r.slug, company: r.empresa || r.slug });
  }
  return out;
}

export async function collectBoards(
  client: PoliteClient,
  boards: Board[],
  log: (msg: string) => void = () => {},
): Promise<JobPosting[]> {
  const all: JobPosting[] = [];
  for (const b of boards) {
    try {
      if (b.kind === 'workday' && !workdayParts(b.slug)) { log(`workday: slug inválido "${b.slug}", pulando`); continue; }
      const requests = b.kind === 'workday'
        ? WORKDAY_TERMS.map((searchText) => ({ appliedFacets: {}, limit: 20, offset: 0, searchText }))
        : [undefined];
      const found: JobPosting[] = [];
      for (const json of requests) {
        const res = await client.get(boardUrl(b), b.kind, json ? { json } : {});
        if (res.status !== 200) {
          log(`${b.kind}: ${b.slug} retornou HTTP ${res.status}, pulando`);
          break;
        }
        for (const p of PARSERS[b.kind](res.text, b, res.documentId)) {
          if (!found.some((f) => f.externalId === p.externalId)) found.push(p);
        }
      }
      log(`${b.kind}: ${b.slug} → ${found.length} vaga(s) Salesforce no Brasil`);
      all.push(...found);
    } catch (err) {
      // Um quadro com problema não derruba os demais.
      log(`${b.kind}: ${b.slug} falhou (${err instanceof Error ? err.message : err}), pulando`);
    }
  }
  return all;
}
