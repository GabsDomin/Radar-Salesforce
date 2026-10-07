// Importação da lista de exclusão (clientes, concorrentes, recrutadoras) via CSV.
// Colunas aceitas: nome (obrigatória), tipo, cnpj, dominio.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import { tx } from '../db/index.ts';
import { normalizeCompanyName } from '../normalize/company.ts';
import { parseCsv } from '../util/csv.ts';
import { applyExclusions } from './companies.ts';

const KINDS = ['cliente', 'concorrente', 'recrutadora'] as const;
export type ExclusionKind = (typeof KINDS)[number];

export function importExclusions(db: DB, file: string, defaultKind?: ExclusionKind) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO exclusions (kind, name, normalized_name, cnpj, domain, origin) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind, normalized_name) DO UPDATE SET cnpj = COALESCE(excluded.cnpj, cnpj),
      domain = COALESCE(excluded.domain, domain), origin = excluded.origin, imported_at = datetime('now')`);
  let imported = 0;
  const skipped: string[] = [];
  tx(db, () => {
    for (const [i, row] of rows.entries()) {
      const name = row['nome'] ?? row['name'] ?? row['empresa'] ?? '';
      const kind = (row['tipo'] || defaultKind || '').toLowerCase() as ExclusionKind;
      if (!name) { skipped.push(`linha ${i + 2}: sem nome`); continue; }
      if (!KINDS.includes(kind)) { skipped.push(`linha ${i + 2}: tipo "${kind}" inválido`); continue; }
      insert.run(kind, name, normalizeCompanyName(name), row['cnpj'] || null, row['dominio'] || row['domínio'] || null, path.basename(file));
      imported++;
    }
  });
  const companiesUpdated = applyExclusions(db);
  return { imported, skipped, companiesUpdated };
}
