// Cliente HTTP "educado": toda coleta da internet passa por aqui.
// - respeita robots.txt (bloqueia antes de requisitar)
// - limita a taxa por domínio
// - identifica o robô no User-Agent
// - registra cada documento buscado (url, status, hash, data) em source_documents
import crypto from 'node:crypto';
import { http as httpConfig } from '../config.ts';
import { parseRobots, type Robots } from './robots.ts';
import type { DB } from '../db/index.ts';

export type FetchFn = typeof fetch;

export class RobotsDisallowedError extends Error {}

export interface PoliteResponse {
  url: string;
  status: number;
  text: string;
  documentId: number | null;
}

export interface PoliteClientOptions {
  db?: DB;
  fetchFn?: FetchFn;
  minIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class PoliteClient {
  private robotsCache = new Map<string, Robots>();
  private lastRequestAt = new Map<string, number>();
  private db?: DB;
  private fetchFn: FetchFn;
  private minIntervalMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(opts: PoliteClientOptions = {}) {
    this.db = opts.db;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? httpConfig.minIntervalMs;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // `encoding`: para fontes que não usam UTF-8 (ex.: a CVM publica em latin1).
  // `json`: envia um POST com corpo JSON (APIs de busca, como a do Workday); as mesmas regras valem.
  async get(url: string, source: string, opts: { encoding?: string; json?: unknown } = {}): Promise<PoliteResponse> {
    const u = new URL(url);
    const robots = await this.robotsFor(u.origin);
    if (!robots.isAllowed(u.pathname + u.search)) {
      throw new RobotsDisallowedError(`robots.txt não permite ${url}`);
    }

    let attempt = 0;
    for (;;) {
      await this.throttle(u.host, robots.crawlDelaySec);
      const res = await this.fetchFn(url, opts.json === undefined
        ? {
          headers: { 'User-Agent': httpConfig.userAgent, Accept: 'text/html,application/json' },
          signal: AbortSignal.timeout(httpConfig.timeoutMs),
        }
        : {
          method: 'POST',
          headers: { 'User-Agent': httpConfig.userAgent, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(opts.json),
          signal: AbortSignal.timeout(httpConfig.timeoutMs),
        });
      const text = opts.encoding ? new TextDecoder(opts.encoding).decode(await res.arrayBuffer()) : await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < httpConfig.maxRetries) {
        attempt++;
        await this.sleep(this.minIntervalMs * 2 ** attempt);
        continue;
      }
      return { url, status: res.status, text, documentId: this.record(url, source, res.status, text) };
    }
  }

  private async robotsFor(origin: string): Promise<Robots> {
    const cached = this.robotsCache.get(origin);
    if (cached) return cached;
    let robots: Robots;
    try {
      await this.throttle(new URL(origin).host);
      const res = await this.fetchFn(origin + '/robots.txt', {
        headers: { 'User-Agent': httpConfig.userAgent },
        signal: AbortSignal.timeout(httpConfig.timeoutMs),
      });
      if (res.status >= 400 && res.status < 500) {
        robots = parseRobots('', httpConfig.userAgent); // sem robots.txt = liberado
      } else if (res.ok) {
        robots = parseRobots(await res.text(), httpConfig.userAgent);
      } else {
        robots = parseRobots('User-agent: *\nDisallow: /', httpConfig.userAgent); // erro do servidor = não coletar
      }
    } catch {
      robots = parseRobots('User-agent: *\nDisallow: /', httpConfig.userAgent);
    }
    this.robotsCache.set(origin, robots);
    return robots;
  }

  private async throttle(host: string, crawlDelaySec?: number) {
    const interval = Math.max(this.minIntervalMs, (crawlDelaySec ?? 0) * 1000);
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + interval - Date.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt.set(host, Date.now());
  }

  private record(url: string, source: string, status: number, text: string): number | null {
    if (!this.db) return null;
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const r = this.db
      .prepare('INSERT INTO source_documents (url, source, http_status, content_hash) VALUES (?, ?, ?, ?)')
      .run(url, source, status, hash);
    return Number(r.lastInsertRowid);
  }
}
