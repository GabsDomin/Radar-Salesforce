// Enriquecimento em cadeia: domínio → CNPJ (rodapé do site) → Receita (setor, porte, diretoria).
// Cada passo usa só fontes públicas e o cliente educado (robots.txt, intervalo entre requisições).
import type { DB } from '../db/index.ts';
import type { PoliteClient } from '../http/client.ts';
import { normalizeCompanyName, stripAccents } from '../normalize/company.ts';
import { fetchReceita, findCnpj, sectorFromCnae, brasilApiUrl, type ReceitaInfo } from '../sources/receita.ts';

export interface EnrichStats { leads: number; domainsFound: number; cnpjsFound: number; receitaOk: number; directors: number; leadershipChanges: number }

type Log = (m: string) => void;

// Hosts de sistemas de vagas: o link de carreira nesses hosts não é o site da empresa.
const ATS_HOST = /gupy\.io|greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|myworkdayjobs\.com|getonbrd\.com|salesforce\.com|google\.|dns\.google/;
const NEW_LEADER_DAYS = 180;

// Palavras do nome que precisam aparecer no título do site para confirmar que é a empresa certa.
function nameTokens(name: string): string[] {
  return normalizeCompanyName(name).split(' ').filter((t) => t.length >= 4);
}

export function titleMatches(html: string, name: string): boolean {
  const title = stripAccents((html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? '') + ' ' + (html.match(/property="og:site_name"[^>]*content="([^"]*)"/i)?.[1] ?? '')).toLowerCase();
  const tokens = nameTokens(name);
  return tokens.length > 0 && tokens.some((t) => title.includes(t));
}

export function domainCandidates(name: string, signalUrls: string[]): string[] {
  const fromLinks = signalUrls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } })
    .filter((h) => h && !ATS_HOST.test(h));
  const compact = normalizeCompanyName(name).replace(/\s+/g, '');
  const guesses = compact.length >= 4 ? [`${compact}.com.br`, `${compact}.com`] : [];
  return [...new Set([...fromLinks, ...guesses])];
}

async function fetchHome(client: PoliteClient, domain: string): Promise<string | null> {
  for (const url of [`https://www.${domain}/`, `https://${domain}/`]) {
    try {
      const res = await client.get(url, 'site');
      if (res.status === 200 && res.text.length > 200) return res.text;
    } catch { /* robots.txt, site fora do ar: tenta a próxima */ }
  }
  return null;
}

export function applyReceita(db: DB, companyId: number, info: ReceitaInfo, now = new Date()): { directors: number; leadershipChanges: number } {
  const sector = sectorFromCnae(info.cnae);
  const big = /demais/i.test(info.porte);
  db.prepare(`UPDATE companies SET cnpj = ?, cnae = ?, sector = ?, sector_source = ?, size_band = ?, size_source = ?,
      city = COALESCE(city, ?), state = COALESCE(state, ?), receita_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(info.cnpj, info.cnae, sector, `receita: CNAE ${info.cnae} ${info.cnaeDescricao}`,
      big ? '100+' : '<100', `receita: porte ${info.porte || 'não informado'}${big ? ' (não é micro nem pequena empresa)' : ''}`,
      info.municipio, info.uf, companyId);

  let directors = 0;
  let leadershipChanges = 0;
  const hasContact = db.prepare('SELECT 1 FROM contacts WHERE company_id = ? AND name = ?');
  const addContact = db.prepare(`INSERT INTO contacts (company_id, name, role, since, origin, legal_basis)
    VALUES (?, ?, ?, ?, 'receita: quadro de administradores', 'legitimo_interesse_b2b')`);
  const addSignal = db.prepare(`INSERT OR IGNORE INTO signals (company_id, type, subtype, title, evidence, url, source, external_id, company_raw, published_at, meta)
    VALUES (?, 'gatilho', 'lideranca', ?, ?, ?, 'receita', ?, ?, ?, ?)`);
  for (const d of info.diretoria) {
    if (!hasContact.get(companyId, d.nome)) { addContact.run(companyId, d.nome, d.cargo, d.desde); directors++; }
    if (d.desde && (now.getTime() - new Date(d.desde + 'T00:00:00Z').getTime()) / 86_400_000 <= NEW_LEADER_DAYS) {
      // O nome fica no contato (dado público da Receita); o sinal mostra só cargo e data.
      const r = addSignal.run(companyId, `Nova diretoria: ${d.cargo} desde ${d.desde.split('-').reverse().join('/')}`,
        'Quadro de sócios e administradores da Receita Federal (via Minha Receita)', brasilApiUrl(info.cnpj),
        `${info.cnpj}:${d.nome}:${d.desde}`, info.razaoSocial, `${d.desde}T00:00:00Z`,
        JSON.stringify({ kind: 'lideranca', area: null, mentionsSalesforce: false, role: d.cargo }));
      if (Number(r.changes)) leadershipChanges++;
    }
  }
  return { directors, leadershipChanges };
}

export async function runEnrich(db: DB, client: PoliteClient, log: Log, opts: { limit?: number; now?: Date } = {}): Promise<EnrichStats> {
  // Prioridade: leads com nota maior e ainda sem Receita consultada.
  const leads = db.prepare(`
    SELECT c.id, c.name, c.domain, c.cnpj FROM companies c LEFT JOIN scores s ON s.company_id = c.id
    WHERE c.excluded_reason IS NULL AND c.status <> 'descartado'
      AND (c.receita_at IS NULL OR (c.cnpj IS NOT NULL AND c.cnae IS NULL))
    ORDER BY COALESCE(s.total, 0) DESC LIMIT ?`).all(opts.limit ?? 80) as { id: number; name: string; domain: string | null; cnpj: string | null }[];
  const stats: EnrichStats = { leads: leads.length, domainsFound: 0, cnpjsFound: 0, receitaOk: 0, directors: 0, leadershipChanges: 0 };
  const urlsOf = db.prepare("SELECT url FROM signals WHERE company_id = ? AND url LIKE 'http%'");
  const setDomain = db.prepare('UPDATE companies SET domain = ? WHERE id = ? AND domain IS NULL');
  const setCnpj = db.prepare('UPDATE companies SET cnpj = ? WHERE id = ? AND cnpj IS NULL');
  const markTried = db.prepare("UPDATE companies SET receita_at = datetime('now') WHERE id = ?");

  for (const l of leads) {
    let { domain, cnpj } = l;
    let home: string | null = null;
    if (!domain) {
      for (const cand of domainCandidates(l.name, (urlsOf.all(l.id) as { url: string }[]).map((r) => r.url))) {
        const html = await fetchHome(client, cand);
        if (html && titleMatches(html, l.name)) { domain = cand; home = html; setDomain.run(cand, l.id); stats.domainsFound++; break; }
      }
    }
    if (!cnpj && domain) {
      home ??= await fetchHome(client, domain);
      const found = home ? findCnpj(home.replace(/<[^>]+>/g, ' ')) : null;
      if (found) { cnpj = found; setCnpj.run(found, l.id); stats.cnpjsFound++; }
    }
    if (cnpj) {
      try {
        const info = await fetchReceita(client, cnpj);
        if (info) {
          const r = applyReceita(db, l.id, info, opts.now);
          stats.receitaOk++; stats.directors += r.directors; stats.leadershipChanges += r.leadershipChanges;
          log(`${l.name}: ${info.cnaeDescricao} · porte ${info.porte} · ${info.diretoria.length} administrador(es)${r.leadershipChanges ? ` · ${r.leadershipChanges} entrada(s) recente(s) na diretoria` : ''}`);
          continue;
        }
      } catch (err) {
        log(`${l.name}: Receita falhou (${err instanceof Error ? err.message : err})`);
        continue; // tenta de novo na próxima execução
      }
    }
    markTried.run(l.id); // sem CNPJ por ora: não insiste a cada execução
  }
  return stats;
}
