// Gera a versão estática do painel (somente leitura) para publicar na Vercel.
// Saída: publicar/public/index.html, dashboard.html, empresa/<id>.html e radar.csv.
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';
import { listCompanies, getCompany, lastRuns } from './queries.ts';
import { listPage, detailPage } from './views.ts';
import { dashboardData } from './dashboard.ts';
import { dashboardPage, modalityPage } from './pages.ts';
import { MODALITIES, modalityRows, lastRunOf, tabCounts } from './modalities.ts';
import { FAVICON_SVG } from './favicon.ts';
import { todayData, todayPage, coSellCsv, planForLead } from './today.ts';
import { exportCsv } from './export.ts';

export function buildStaticSite(db: DB, outDir: string): { companies: number } {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'empresa'), { recursive: true });

  // Inclui as excluídas: o filtro "Excluídas" do navegador decide se aparecem.
  const rows = listCompanies(db, { excluidas: '1', visao: 'tudo' });
  fs.writeFileSync(path.join(outDir, 'index.html'), listPage(rows, {}, lastRuns(db), true, undefined, tabCounts(db)));
  for (const r of rows) {
    const d = getCompany(db, r.id);
    if (d) fs.writeFileSync(path.join(outDir, 'empresa', `${r.id}.html`), detailPage({ ...d, plan: planForLead(db, r.id) }, true));
  }
  fs.writeFileSync(path.join(outDir, 'dashboard.html'), dashboardPage(dashboardData(db), true));
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), FAVICON_SVG);
  fs.writeFileSync(path.join(outDir, 'hoje.html'), todayPage(todayData(db), true));
  fs.writeFileSync(path.join(outDir, 'co-venda.csv'), coSellCsv(db));
  fs.mkdirSync(path.join(outDir, 'radar'), { recursive: true });
  for (const m of MODALITIES) {
    fs.writeFileSync(path.join(outDir, 'radar', `${m.id}.html`), modalityPage(m, modalityRows(db, m.id), lastRunOf(db, m.collector), true, tabCounts(db)));
  }
  fs.writeFileSync(path.join(outDir, 'radar.csv'), exportCsv(db, { excluidas: '1', visao: 'tudo' }));
  return { companies: rows.length };
}
