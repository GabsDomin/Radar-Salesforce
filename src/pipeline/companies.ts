// Contas: busca por nome normalizado/alias, criação e checagem da lista de exclusão.
import type { DB } from '../db/index.ts';
import { normalizeCompanyName } from '../normalize/company.ts';

export function findCompanyId(db: DB, name: string): number | null {
  const norm = normalizeCompanyName(name);
  const direct = db.prepare('SELECT id FROM companies WHERE normalized_name = ?').get(norm) as { id: number } | undefined;
  if (direct) return direct.id;
  const alias = db.prepare('SELECT company_id FROM company_aliases WHERE normalized_alias = ?').get(norm) as
    | { company_id: number }
    | undefined;
  return alias?.company_id ?? null;
}

export function upsertCompany(db: DB, name: string, source: string): number {
  const existing = findCompanyId(db, name);
  if (existing !== null) {
    const norm = normalizeCompanyName(name);
    db.prepare('INSERT OR IGNORE INTO company_aliases (company_id, alias, normalized_alias, source) VALUES (?, ?, ?, ?)')
      .run(existing, name, norm, source);
    return existing;
  }
  const norm = normalizeCompanyName(name);
  const r = db.prepare('INSERT INTO companies (name, normalized_name) VALUES (?, ?)').run(name, norm);
  const id = Number(r.lastInsertRowid);
  db.prepare('INSERT OR IGNORE INTO company_aliases (company_id, alias, normalized_alias, source) VALUES (?, ?, ?, ?)')
    .run(id, name, norm, source);
  return id;
}

export function exclusionFor(db: DB, name: string): string | null {
  const norm = normalizeCompanyName(name);
  const row = db.prepare(
    `SELECT kind FROM exclusions WHERE normalized_name = ?
     ORDER BY CASE kind WHEN 'cliente' THEN 0 WHEN 'concorrente' THEN 1 ELSE 2 END LIMIT 1`,
  ).get(norm) as { kind: string } | undefined;
  return row?.kind ?? null;
}

// Reaplica a lista de exclusão a todas as contas (após importar um CSV novo).
export function applyExclusions(db: DB): number {
  const companies = db.prepare('SELECT id, name, excluded_reason FROM companies').all() as {
    id: number; name: string; excluded_reason: string | null;
  }[];
  const aliasesOf = db.prepare('SELECT alias FROM company_aliases WHERE company_id = ?');
  const update = db.prepare("UPDATE companies SET excluded_reason = ?, updated_at = datetime('now') WHERE id = ?");
  let changed = 0;
  for (const c of companies) {
    const names = [c.name, ...(aliasesOf.all(c.id) as { alias: string }[]).map((a) => a.alias)];
    const reason = names.map((n) => exclusionFor(db, n)).find((k) => k !== null) ?? null;
    if (reason !== c.excluded_reason) {
      update.run(reason, c.id);
      changed++;
    }
  }
  return changed;
}
