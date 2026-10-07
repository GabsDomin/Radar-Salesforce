// Servidor do painel (somente localhost por padrão).
import http from 'node:http';
import type { DB } from '../db/index.ts';
import { listCompanies, getCompany, updateCompany, lastRuns, type Filters } from './queries.ts';
import { listPage, detailPage, notFoundPage } from './views.ts';
import { exportCsv } from './export.ts';

const FILTER_KEYS: (keyof Filters)[] = ['q', 'setor', 'oferta', 'sinal', 'status', 'excluidas', 'min'];

export function createServer(db: DB) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const filters: Filters = Object.fromEntries(
        FILTER_KEYS.map((k) => [k, url.searchParams.get(k) ?? undefined]).filter(([, v]) => v),
      );

      if (req.method === 'GET' && url.pathname === '/') {
        return send(res, 200, listPage(listCompanies(db, filters), filters, lastRuns(db)));
      }
      if (req.method === 'GET' && url.pathname === '/export.csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="radar-${new Date().toISOString().slice(0, 10)}.csv"`,
        });
        return res.end(exportCsv(db, filters));
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
        return detail ? send(res, 200, detailPage(detail)) : send(res, 404, notFoundPage());
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
