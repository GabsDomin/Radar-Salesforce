// Descobre quadros de vagas no Greenhouse e no Lever a partir de nomes de empresas.
// Para cada nome, testa variações de "slug" nas APIs públicas; o que responder com vagas vira
// uma linha em seeds/quadros.csv. A lista de nomes fica em seeds/candidatos-quadros.txt (um por linha).
import type { PoliteClient } from '../http/client.ts';
import { stripAccents } from '../normalize/company.ts';
import type { Board, BoardKind } from './boards.ts';

export function slugCandidates(name: string): string[] {
  const base = stripAccents(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').trim();
  const words = base.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  // Só o nome inteiro: "primeira palavra" ("grupo", "banco") casaria com empresas erradas.
  return [...new Set([words.join(''), words.join('-')])].filter((s) => s.length >= 3);
}

const PROBES: [BoardKind, (slug: string) => string][] = [
  ['greenhouse', (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`],
  ['lever', (s) => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`],
];

// Quadro válido = HTTP 200 com lista de vagas (mesmo vazia: a empresa pode abrir vagas depois).
function isBoard(kind: BoardKind, status: number, text: string): boolean {
  if (status !== 200) return false;
  try {
    const j = JSON.parse(text);
    return kind === 'lever' ? Array.isArray(j) : Array.isArray(j.jobs);
  } catch {
    return false;
  }
}

export async function discoverBoards(
  client: PoliteClient,
  names: string[],
  known: Board[],
  log: (msg: string) => void = () => {},
): Promise<Board[]> {
  const found: Board[] = [];
  const has = (kind: BoardKind, slug: string) =>
    [...known, ...found].some((b) => b.kind === kind && b.slug === slug);
  for (const name of names) {
    for (const [kind, url] of PROBES) {
      for (const slug of slugCandidates(name)) {
        if (has(kind, slug)) break;
        try {
          const res = await client.get(url(slug), `descoberta-${kind}`);
          if (isBoard(kind, res.status, res.text)) {
            found.push({ kind, slug, company: name });
            log(`✔ ${name}: ${kind}/${slug}`);
            break;
          }
        } catch (err) {
          log(`${name}: ${kind}/${slug} falhou (${err instanceof Error ? err.message : err})`);
        }
      }
    }
  }
  return found;
}
