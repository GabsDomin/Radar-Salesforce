// Gera a versão estática do painel (somente leitura) para publicar na Vercel.
// Saída: publicar/public/index.html, empresa/<id>.html e radar.csv.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import { listCompanies, getCompany, lastRuns } from './queries.ts';
import { listPage, detailPage } from './views.ts';
import { exportCsv } from './export.ts';

export function buildStaticSite(db: DB, outDir: string): { companies: number } {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'empresa'), { recursive: true });

  // Inclui as excluídas: o filtro "Excluídas" do navegador decide se aparecem.
  const rows = listCompanies(db, { excluidas: '1' });
  fs.writeFileSync(path.join(outDir, 'index.html'), listPage(rows, {}, lastRuns(db), true));
  for (const r of rows) {
    const d = getCompany(db, r.id);
    if (d) fs.writeFileSync(path.join(outDir, 'empresa', `${r.id}.html`), detailPage(d, true));
  }
  fs.writeFileSync(path.join(outDir, 'radar.csv'), exportCsv(db, { excluidas: '1' }));
  return { companies: rows.length };
}
