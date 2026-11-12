// Coletores de APIs públicas de vagas por empresa: Greenhouse, Lever e SmartRecruiters.
// Diferente da Gupy (busca aberta), aqui é preciso saber o "quadro" (slug) de cada empresa;
// a lista fica em seeds/quadros.csv e cresce com o tempo.
import type { PoliteClient } from '../http/client.ts';
import type { JobPosting } from './types.ts';
import { detectCountry, isAllowedCountry } from '../normalize/location.ts';

export type BoardKind = 'greenhouse' | 'lever' | 'smartrecruiters';
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

// ---------- SmartRecruiters ----------
interface SrJob {
  id: string;
  name: string;
  releasedDate?: string;
  location?: { city?: string; region?: string; country?: string };
}

// A busca já filtra por "salesforce" no servidor; a descrição exigiria uma chamada por vaga,
// então fica vazia (o título e o nome da empresa bastam para identificar a conta).
export function parseSmartRecruiters(json: string, board: Board, documentId: number | null): JobPosting[] {
  const jobs: SrJob[] = JSON.parse(json).content ?? [];
  return jobs
    .filter((j) => isAllowedCountry((j.location?.country ?? '').toUpperCase()))
    .map((j) => ({
      source: 'smartrecruiters',
      externalId: `${board.slug}:${j.id}`,
      title: j.name.trim(),
      description: '',
      companyName: board.company,
      url: `https://jobs.smartrecruiters.com/${board.slug}/${j.id}`,
      publishedAt: j.releasedDate ?? null,
      city: j.location?.city || null,
      state: j.location?.region || null,
      country: (j.location?.country ?? '').toUpperCase(),
      documentId,
    }));
}

export function boardUrl(b: Board): string {
  switch (b.kind) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}/jobs?content=true`;
    case 'lever': return `https://api.lever.co/v0/postings/${encodeURIComponent(b.slug)}?mode=json`;
    case 'smartrecruiters': return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.slug)}/postings?q=salesforce&limit=100`;
  }
}

const PARSERS = { greenhouse: parseGreenhouse, lever: parseLever, smartrecruiters: parseSmartRecruiters };

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
      const res = await client.get(boardUrl(b), b.kind);
      if (res.status !== 200) {
        log(`${b.kind}: ${b.slug} retornou HTTP ${res.status}, pulando`);
        continue;
      }
      const found = PARSERS[b.kind](res.text, b, res.documentId);
      log(`${b.kind}: ${b.slug} → ${found.length} vaga(s) Salesforce no Brasil`);
      all.push(...found);
    } catch (err) {
      // Um quadro com problema não derruba os demais.
      log(`${b.kind}: ${b.slug} falhou (${err instanceof Error ? err.message : err}), pulando`);
    }
  }
  return all;
}
