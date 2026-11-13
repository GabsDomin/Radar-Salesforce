// Descoberta de quadros de vagas (ATS) e gravação em seeds/quadros.csv.
//  - pelo site da empresa (link de "Trabalhe conosco" → Greenhouse, Lever, Workable, Ashby, Workday)
//  - pelo nome (testa slugs nas APIs do Greenhouse e do Lever) para os leads e a lista de candidatos
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import type { PoliteClient } from '../http/client.ts';
import { ROOT } from '../config.ts';
import { parseCsv } from '../util/csv.ts';
import { parseBoards, type Board } from '../sources/boards.ts';
import { discoverAtsFromSite } from '../sources/atsFromSite.ts';
import { discoverBoards } from '../sources/discoverBoards.ts';

type Log = (m: string) => void;

export const BOARDS_FILE = path.join(ROOT, 'seeds', 'quadros.csv');
export const CANDIDATES_FILE = path.join(ROOT, 'seeds', 'candidatos-quadros.txt');

export function readBoards(file = BOARDS_FILE): Board[] {
  return fs.existsSync(file) ? parseBoards(parseCsv(fs.readFileSync(file, 'utf8'))) : [];
}

export function appendBoards(found: Board[], file = BOARDS_FILE): number {
  const known = readBoards(file);
  const fresh = found.filter((b) => !known.some((k) => k.kind === b.kind && k.slug === b.slug));
  if (!fresh.length) return 0;
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\s*$/, '\n') : 'fonte;slug;empresa\n';
  fs.writeFileSync(file, existing + fresh.map((b) => `${b.kind};${b.slug};${b.company.replace(/;/g, ',')}`).join('\n') + '\n');
  return fresh.length;
}

// Pelo site: só domínios ainda não verificados (coluna ats_at), para não repetir a cada execução.
export async function discoverFromSites(db: DB, client: PoliteClient, log: Log, file = BOARDS_FILE): Promise<number> {
  const leads = db.prepare(`SELECT id, name, domain FROM companies
    WHERE domain IS NOT NULL AND ats_at IS NULL AND excluded_reason IS NULL AND status <> 'descartado'`).all() as { id: number; name: string; domain: string }[];
  const mark = db.prepare("UPDATE companies SET ats_at = datetime('now') WHERE id = ?");
  const found: Board[] = [];
  for (const l of leads) {
    const boards = await discoverAtsFromSite(client, l.domain, l.name);
    for (const b of boards) log(`✔ ${l.name}: ${b.kind}/${b.slug} (link no site ${l.domain})`);
    found.push(...boards);
    mark.run(l.id);
  }
  return appendBoards(found, file);
}

// Pelo nome: lista de candidatos + todos os leads visíveis.
export async function discoverFromNames(db: DB, client: PoliteClient, log: Log, file = BOARDS_FILE): Promise<number> {
  const fromFile = fs.existsSync(CANDIDATES_FILE)
    ? fs.readFileSync(CANDIDATES_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  const fromLeads = (db.prepare("SELECT name FROM companies WHERE excluded_reason IS NULL AND status <> 'descartado'").all() as { name: string }[])
    .map((r) => r.name.replace(/\s+(s\.?\/?a\.?|ltda\.?)$/i, ''));
  const names = [...new Set([...fromFile, ...fromLeads])];
  log(`Testando ${names.length} nome(s) no Greenhouse e no Lever...`);
  return appendBoards(await discoverBoards(client, names, readBoards(file), log), file);
}
