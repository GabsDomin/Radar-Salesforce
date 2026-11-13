// Servidor do painel (somente localhost por padrão).
import http from 'node:http';
import type { DB } from '../db/index.ts';
import { listCompanies, getCompany, updateCompany, lastRuns, visaoCounts, visoesOf, type Filters } from './queries.ts';
import { decide, type DecisionAction } from '../pipeline/decisions.ts';
import { triagePage } from './triage.ts';
import { addManualLead } from '../pipeline/manualLeads.ts';
import { scoreAll } from '../scoring/score.ts';
import { listPage, detailPage, notFoundPage } from './views.ts';
import { exportCsv } from './export.ts';
import { dashboardData } from './dashboard.ts';
import { dashboardPage, updatePage, modalityPage } from './pages.ts';
import { MODALITIES, modalityRows, lastRunOf, tabCounts } from './modalities.ts';
import { FAVICON_SVG } from './favicon.ts';
import { todayData, todayPage, coSellCsv, planForLead } from './today.ts';
import { UpdateRunner } from './jobs.ts';

const FILTER_KEYS: (keyof Filters)[] = ['q', 'setor', 'oferta', 'sinal', 'status', 'excluidas', 'min', 'visao'];
const TRIAGE_LIMIT = 50;

export function createServer(db: DB, runner = new UpdateRunner(db)) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');

      // Só aceita escrita vinda do próprio painel (evita que outro site local dispare atualizações).
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, 'Origem não permitida.');
      }

      const filters: Filters = Object.fromEntries(
        FILTER_KEYS.map((k) => [k, url.searchParams.get(k) ?? undefined]).filter(([, v]) => v),
      );

      if (req.method === 'GET' && (url.pathname === '/favicon.svg' || url.pathname === '/favicon.ico')) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
        return res.end(FAVICON_SVG);
      }
      if (req.method === 'GET' && url.pathname === '/hoje') return send(res, 200, todayPage(todayData(db)));
      if (req.method === 'GET' && url.pathname === '/co-venda.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="co-venda-${new Date().toISOString().slice(0, 10)}.csv"` });
        return res.end(coSellCsv(db));
      }
      if (req.method === 'GET' && url.pathname === '/dashboard') return send(res, 200, dashboardPage(dashboardData(db)));
      const mod = url.pathname.match(/^\/radar\/(\w+)$/);
      if (req.method === 'GET' && mod) {
        const info = MODALITIES.find((m) => m.id === mod[1]);
        if (!info) return send(res, 404, notFoundPage());
        return send(res, 200, modalityPage(info, modalityRows(db, info.id), lastRunOf(db, info.collector), false, tabCounts(db)));
      }
      if (req.method === 'GET' && url.pathname === '/atualizar') return send(res, 200, updatePage(runner.state, runner.limit));
      if (req.method === 'GET' && url.pathname === '/atualizar/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(runner.state));
      }
      if (req.method === 'POST' && url.pathname === '/atualizar/executar') {
        const steps = new URLSearchParams(await readBody(req)).getAll('step');
        const started = runner.start(steps);
        res.writeHead(started ? 202 : 409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ started }));
      }

      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, listPage(listCompanies(db, filters), filters, lastRuns(db), false, visaoCounts(db), tabCounts(db)));
      }
      if (req.method === 'GET' && url.pathname === '/export.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="radar-${new Date().toISOString().slice(0, 10)}.csv"`,
        });
        return res.end(exportCsv(db, filters));
      }
      const ct = url.pathname.match(/^\/empresa\/(\d+)\/contato$/);
      if (req.method === 'POST' && ct) {
        const form = new URLSearchParams(await readBody(req));
        const name = (form.get('name') ?? '').trim();
        if (name) db.prepare("INSERT INTO contacts (company_id, name, role, channel, origin) VALUES (?, ?, ?, ?, 'manual')")
          .run(Number(ct[1]), name, (form.get('role') ?? '').trim() || null, (form.get('channel') ?? '').trim() || null);
        res.writeHead(303, { Location: `/empresa/${ct[1]}` });
        return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/leads/novo') {
        const form = new URLSearchParams(await readBody(req));
        const r = addManualLead(db, {
          name: form.get('name') ?? '', origin: form.get('origin') ?? '', detail: form.get('detail') ?? '', domain: form.get('domain') ?? '',
        });
        if (!r.ok) return send(res, 400, notFoundPage().replace('Lead não encontrado.', `Não foi possível adicionar: ${(r.error ?? 'erro').replace(/[<>&"]/g, '')}.`));
        scoreAll(db);
        res.writeHead(303, { Location: `/empresa/${r.id}` });
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/triagem') {
        const queue = listCompanies(db, { visao: 'triagem' });
        const leads = queue.slice(0, TRIAGE_LIMIT).map((r) => getCompany(db, r.id)).filter((d) => d !== null);
        return send(res, 200, triagePage(leads, queue.length));
      }
      const dec = url.pathname.match(/^\/empresa\/(\d+)\/decisao$/);
      if (req.method === 'POST' && dec) {
        const id = Number(dec[1]);
        const form = new URLSearchParams(await readBody(req));
        const result = decide(db, id, {
          action: (form.get('action') ?? '') as DecisionAction,
          reason: form.get('reason') ?? undefined,
          note: form.get('note') ?? undefined,
          until: form.get('until') ?? undefined,
        });
        const row = db.prepare('SELECT status, snoozed_until FROM companies WHERE id = ?').get(id) as
          { status: string; snoozed_until: string | null } | undefined;
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ...result, visoes: row ? visoesOf(row) : [] }));
      }
      const m = url.pathname.match(/^\/empresa\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (req.method === 'POST') {
          const form = new URLSearchParams(await readBody(req));
          updateCompany(db, id, Object.fromEntries(form) as Record<string, string>);
          res.writeHead(303, { Location: `/empresa/${id}` });
          return res.end();
        }
        const detail = getCompany(db, id);
        return detail ? send(res, 200, detailPage({ ...detail, plan: planForLead(db, id) })) : send(res, 404, notFoundPage());
      }
      send(res, 404, notFoundPage());
    } catch (err) {
      console.error(err);
      send(res, 500, 'Erro interno: ' + String(err));
    }
  });
}

function send(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
