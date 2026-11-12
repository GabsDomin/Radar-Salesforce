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
  // Nome igual, ou começando pelo nome excluído seguido de outra palavra
  // ("Stefanini" pega "Stefanini Latam"; "IBM" pega "IBM Brasil", mas não "IBMX").
  const row = db.prepare(
    `SELECT kind FROM exclusions WHERE normalized_name = ? OR ? LIKE normalized_name || ' %'
     ORDER BY CASE kind WHEN 'cliente' THEN 0 WHEN 'concorrente' THEN 1 ELSE 2 END LIMIT 1`,
  ).get(norm, norm) as { kind: string } | undefined;
  return row?.kind ?? null;
}

// ---------- Junção de duplicados entre fontes ----------
// A mesma empresa chega com nomes diferentes (vaga, CVM, caso publicado). São a mesma conta quando:
// mesmo domínio; mesmas palavras em outra ordem ("Vipal Borrachas" = "Borrachas Vipal");
// uma é a outra + "Brasil"/"do Brasil"/"Latam" ("Banco ABC" = "Banco ABC Brasil"); ou o nome compacto
// de uma é o domínio da outra ("BTG Pactual" = btgpactual.com).
interface DupRow { id: number; name: string; domain: string | null; status: string; notes: string | null; signals: number }

const SUFFIXES = [' brasil', ' do brasil', ' latam'];

export function sameCompany(a: DupRow, b: DupRow): boolean {
  if (a.domain && b.domain && a.domain === b.domain) return true;
  const na = normalizeCompanyName(a.name);
  const nb = normalizeCompanyName(b.name);
  const sorted = (s: string) => s.split(' ').sort().join(' ');
  if (na.includes(' ') && sorted(na) === sorted(nb)) return true;
  if (SUFFIXES.some((suf) => na + suf === nb || nb + suf === na)) return true;
  const compact = (s: string) => s.replace(/\s+/g, '');
  const label = (d: string | null) => d?.split('.')[0] ?? '';
  return (compact(na).length >= 5 && compact(na) === label(b.domain)) || (compact(nb).length >= 5 && compact(nb) === label(a.domain));
}

// Fica a conta com trabalho humano (decisão, anotação) ou, se nenhuma tiver, a com mais sinais.
function keeperOf(a: DupRow, b: DupRow): [DupRow, DupRow] {
  const worked = (r: DupRow) => (r.status !== 'novo' || r.notes ? 1 : 0);
  const rank = (r: DupRow) => worked(r) * 1e6 + r.signals * 10 - r.id / 1e9;
  return rank(a) >= rank(b) ? [a, b] : [b, a];
}

export function mergeDuplicates(db: DB): { merged: string[] } {
  const rows = db.prepare(`SELECT c.id, c.name, c.domain, c.status, c.notes,
      (SELECT count(*) FROM signals x WHERE x.company_id = c.id) AS signals FROM companies c ORDER BY c.id`).all() as unknown as DupRow[];
  const merged: string[] = [];
  const gone = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (gone.has(a.id) || gone.has(b.id) || !sameCompany(a, b)) continue;
      const [keep, drop] = keeperOf(a, b);
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE signals SET company_id = ? WHERE company_id = ?').run(keep.id, drop.id);
        db.prepare('UPDATE OR IGNORE company_aliases SET company_id = ? WHERE company_id = ?').run(keep.id, drop.id);
        db.prepare('UPDATE account_events SET company_id = ? WHERE company_id = ?').run(keep.id, drop.id);
        db.prepare('UPDATE contacts SET company_id = ? WHERE company_id = ?').run(keep.id, drop.id);
        // Completa o que faltar na conta mantida; setor confirmado (CVM) vence o inferido.
        db.prepare(`UPDATE companies SET
            domain = COALESCE(domain, (SELECT domain FROM companies WHERE id = ?)),
            cnpj = COALESCE(cnpj, (SELECT cnpj FROM companies WHERE id = ?)),
            city = COALESCE(city, (SELECT city FROM companies WHERE id = ?)),
            state = COALESCE(state, (SELECT state FROM companies WHERE id = ?)),
            sector = CASE WHEN sector IS NULL OR sector_source LIKE 'inferido%' THEN COALESCE((SELECT sector FROM companies WHERE id = ? AND sector_source NOT LIKE 'inferido%'), sector) ELSE sector END,
            sector_source = CASE WHEN sector IS NULL OR sector_source LIKE 'inferido%' THEN COALESCE((SELECT sector_source FROM companies WHERE id = ? AND sector_source NOT LIKE 'inferido%'), sector_source) ELSE sector_source END,
            size_band = COALESCE(size_band, (SELECT size_band FROM companies WHERE id = ?)),
            size_source = COALESCE(size_source, (SELECT size_source FROM companies WHERE id = ?))
          WHERE id = ?`).run(drop.id, drop.id, drop.id, drop.id, drop.id, drop.id, drop.id, drop.id, keep.id);
        db.prepare('DELETE FROM companies WHERE id = ?').run(drop.id);
        db.prepare('INSERT OR IGNORE INTO company_aliases (company_id, alias, normalized_alias, source) VALUES (?, ?, ?, ?)')
          .run(keep.id, drop.name, normalizeCompanyName(drop.name), 'junção');
        db.prepare('INSERT INTO account_events (company_id, kind, detail) VALUES (?, ?, ?)').run(keep.id, 'juncao', `"${drop.name}" juntada a esta conta`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      gone.add(drop.id);
      keep.signals += drop.signals;
      merged.push(`${drop.name} → ${keep.name}`);
    }
  }
  return { merged };
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
