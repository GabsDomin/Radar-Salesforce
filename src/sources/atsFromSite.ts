// Descobre o sistema de vagas (ATS) de uma empresa pelo próprio site: a página inicial ou a de
// "Trabalhe conosco" aponta para Greenhouse, Lever, Workable, Ashby ou Workday. É a fonte original
// das vagas que também aparecem no LinkedIn e em portais, sem depender deles.
import type { PoliteClient } from '../http/client.ts';
import type { Board } from './boards.ts';

const ATS_PATTERNS: [Board['kind'], RegExp, (m: RegExpMatchArray) => string][] = [
  ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i, (m) => m[1].toLowerCase()],
  ['lever', /jobs\.lever\.co\/([a-z0-9_-]+)/i, (m) => m[1].toLowerCase()],
  ['workable', /apply\.workable\.com\/([a-z0-9_-]+)/i, (m) => m[1].toLowerCase()],
  ['ashby', /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, (m) => m[1]],
  ['workday', /([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/, (m) => `${m[1]}|${m[2]}|${m[3]}`],
];

const NOT_A_BOARD = new Set(['embed', 'jobs', 'api', 'v1', 'job', 'careers', 'login', 'wday']);

// Links de página de carreiras no próprio site.
const CAREERS_LINK = /href="([^"]*(?:carreira|trabalhe-conosco|trabalhe_conosco|vagas|careers|jobs|talentos)[^"]*)"/gi;

export function findAtsLinks(html: string): { kind: Board['kind']; slug: string }[] {
  const out: { kind: Board['kind']; slug: string }[] = [];
  for (const [kind, re, slugOf] of ATS_PATTERNS) {
    for (const m of html.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const slug = slugOf(m);
      if (!slug || NOT_A_BOARD.has(slug.split('|')[0])) continue;
      if (!out.some((o) => o.kind === kind && o.slug === slug)) out.push({ kind, slug });
    }
  }
  return out;
}

export function careersLinks(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(CAREERS_LINK)) {
    try {
      const u = new URL(m[1], base);
      if (/^https?:$/.test(u.protocol) && !out.includes(u.href)) out.push(u.href);
    } catch { /* link inválido */ }
  }
  return out.slice(0, 3);
}

async function page(client: PoliteClient, url: string): Promise<string | null> {
  try {
    const res = await client.get(url, 'site');
    return res.status === 200 ? res.text : null;
  } catch {
    return null;
  }
}

// Página inicial e, se não houver link de ATS nela, até 3 páginas de carreiras do mesmo site.
export async function discoverAtsFromSite(client: PoliteClient, domain: string, company: string): Promise<Board[]> {
  let home: string | null = null;
  let homeUrl = '';
  for (const url of [`https://www.${domain}/`, `https://${domain}/`]) {
    home = await page(client, url);
    if (home) { homeUrl = url; break; }
  }
  if (!home) return [];
  let found = findAtsLinks(home);
  if (!found.length) {
    for (const link of careersLinks(home, homeUrl)) {
      const html = await page(client, link);
      if (html) found = findAtsLinks(html);
      if (found.length) break;
    }
  }
  return found.map((f) => ({ ...f, company }));
}
