// Radar de notícias: troca de liderança, fusão/aquisição, investimento e expansão.
// Fonte: GDELT DOC API (aberta; pede no máximo 1 requisição a cada 5 s).
// Google News RSS não é usado: o robots.txt dele proíbe a busca.
import type { PoliteClient } from '../http/client.ts';
import { normalizeCompanyName, stripAccents } from '../normalize/company.ts';

export type NewsKind = 'lideranca' | 'fusao' | 'investimento' | 'expansao';
export type LeaderArea = 'tecnologia' | 'comercial' | null;

export interface NewsClassification {
  kind: NewsKind;
  area: LeaderArea;          // só para liderança: área do cargo, quando identificável
  mentionsSalesforce: boolean;
}

export interface NewsItem {
  title: string;
  url: string;
  domain: string;
  publishedAt: string | null;
  documentId: number | null;
}

const plain = (s: string) => stripAccents(s).toLowerCase();

// Português e espanhol (o radar cobre Brasil e América Latina). Texto já sem acentos e em minúsculas.
const LEADER_VERB = /\b(nomeia|nomead[oa]s?|nombra|nombrad[oa]|designa|contrata|promove|asume|assume|escolhe|elige|novo (diretor|presidente|ceo|cio|cto|cmo|cfo|vice)|nova (diretora|presidente|vice)|nuevo (director|gerente|presidente|ceo|cio|cto|cmo|cfo|vicepresidente)|nueva (directora|gerente|presidenta|vicepresidenta)|deixa (a )?(diretoria|presidencia|cargo)|deja (la )?(direccion|presidencia|gerencia|cargo)|renuncia)\b/;
const LEADER_ROLE = /\b(diretor[a]?|diretoria|director[a]?|direccion|gerente|gerencia|presidente|presidenta|ceo|cio|cto|cmo|cdo|cfo|vice|vicepresidente|vp|head|executiv[oa]|ejecutiv[oa])\b/;
const AREA_TECH = /\b(ti|tecnologia|digital|dados|datos|inovacao|innovacion|transformacao digital|transformacion digital|sistemas)\b/;
const AREA_COMMERCIAL = /\b(vendas|ventas|comercial|marketing|clientes|cliente|cx|experiencia do cliente|experiencia del cliente|receita|ingresos|revops)\b/;
const MA = /\b(fusao|fusion|aquisicao|adquisicion|adquire|adquiere|adquirir|incorpora|incorporacao|compra (a|o|da|do|de la|del)|vende (a|o|da|do|la|el)|acordo para (comprar|adquirir)|acuerdo para (comprar|adquirir))\b/;
const INVEST = /\b(aporte|rodada|ronda|serie [abc]|capta|levanta|ipo|abertura de capital|salida a bolsa|investimento de r\$|investe r\$|inversion de (us)?\$|invierte)\b/;
const EXPAND = /\b(inaugura|nova (fabrica|unidade|planta|sede)|nueva (fabrica|planta|sede|sucursal)|expansao|expansion|amplia (a |la )?(producao|produccion|operacao|operacion)|abre (nova|novas|nueva|nuevas))\b/;

export function classifyNews(title: string): NewsClassification | null {
  const t = plain(title);
  const mentionsSalesforce = /salesforce/.test(t);
  if (LEADER_VERB.test(t) && LEADER_ROLE.test(t)) {
    const area: LeaderArea = AREA_TECH.test(t) ? 'tecnologia' : AREA_COMMERCIAL.test(t) ? 'comercial' : null;
    return { kind: 'lideranca', area, mentionsSalesforce };
  }
  if (MA.test(t)) return { kind: 'fusao', area: null, mentionsSalesforce };
  if (INVEST.test(t)) return { kind: 'investimento', area: null, mentionsSalesforce };
  if (EXPAND.test(t)) return { kind: 'expansao', area: null, mentionsSalesforce };
  return null;
}

// "20261101T120000Z" → "2026-11-01T12:00:00Z"
export function gdeltDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

export function parseGdelt(text: string, documentId: number | null): NewsItem[] {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '{}') return []; // sem resultados
  let json: { articles?: { url: string; title: string; seendate?: string; domain?: string }[] };
  try {
    json = JSON.parse(trimmed);
  } catch {
    // O GDELT responde texto puro quando o limite de taxa é excedido.
    throw new Error(`GDELT respondeu algo que não é JSON: ${trimmed.slice(0, 80)}`);
  }
  return (json.articles ?? []).map((a) => ({
    title: a.title.trim(),
    url: a.url,
    domain: a.domain ?? new URL(a.url).hostname,
    publishedAt: gdeltDate(a.seendate),
    documentId,
  }));
}

// A empresa precisa aparecer no título (palavras inteiras); evita notícia só parecida.
export function titleMentionsCompany(title: string, companyName: string): boolean {
  const name = normalizeCompanyName(companyName);
  if (name.length < 3) return false;
  const t = ' ' + plain(title).replace(/[^a-z0-9]+/g, ' ') + ' ';
  return t.includes(` ${name} `);
}

export function queryName(companyName: string): string {
  return companyName.replace(/[,]?\s+(S\.?\/?A\.?|Ltda\.?|EIRELI|ME)$/i, '').trim();
}

export function gdeltUrl(companyName: string): string {
  // Notícias em português e espanhol (Brasil + América Latina); o nome precisa aparecer no título.
  const q = `"${queryName(companyName)}" (sourcelang:portuguese OR sourcelang:spanish)`;
  return 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
    query: q, mode: 'artlist', maxrecords: '25', format: 'json', timespan: '3months', sort: 'datedesc',
  }).toString();
}

export interface CompanyNews {
  companyId: number;
  companyName: string;
  item: NewsItem;
  classification: NewsClassification;
}

export async function collectNews(
  client: PoliteClient,
  companies: { id: number; name: string }[],
  log: (msg: string) => void = () => {},
): Promise<CompanyNews[]> {
  const out: CompanyNews[] = [];
  for (const c of companies) {
    try {
      const res = await client.get(gdeltUrl(c.name), 'gdelt');
      if (res.status !== 200) {
        log(`gdelt: ${c.name} retornou HTTP ${res.status}, pulando`);
        continue;
      }
      let kept = 0;
      for (const item of parseGdelt(res.text, res.documentId)) {
        if (!titleMentionsCompany(item.title, c.name)) continue;
        const classification = classifyNews(item.title);
        if (!classification) continue;
        out.push({ companyId: c.id, companyName: c.name, item, classification });
        kept++;
      }
      log(`gdelt: ${c.name} → ${kept} notícia(s) com gatilho`);
    } catch (err) {
      log(`gdelt: ${c.name} falhou (${err instanceof Error ? err.message : err}), pulando`);
    }
  }
  return out;
}
