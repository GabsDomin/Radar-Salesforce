// Detecção de país a partir do que as fontes informam (cidade, estado, país em texto livre).
// Escopo do radar: Brasil + América Latina. Local que não dá para reconhecer fica de fora
// (evita puxar vagas dos EUA ou da Europa).
import { stripAccents } from './company.ts';

export const LATAM_COUNTRIES: Record<string, string> = {
  BR: 'Brasil', AR: 'Argentina', BO: 'Bolívia', CL: 'Chile', CO: 'Colômbia', CR: 'Costa Rica', CU: 'Cuba',
  DO: 'República Dominicana', EC: 'Equador', SV: 'El Salvador', GT: 'Guatemala', HN: 'Honduras', MX: 'México',
  NI: 'Nicarágua', PA: 'Panamá', PY: 'Paraguai', PE: 'Peru', UY: 'Uruguai', VE: 'Venezuela',
};

const BR_STATES = [
  'acre', 'alagoas', 'amapa', 'amazonas', 'bahia', 'ceara', 'distrito federal', 'espirito santo', 'goias', 'maranhao',
  'mato grosso', 'mato grosso do sul', 'minas gerais', 'para', 'paraiba', 'parana', 'pernambuco', 'piaui', 'rio de janeiro',
  'rio grande do norte', 'rio grande do sul', 'rondonia', 'roraima', 'santa catarina', 'sao paulo', 'sergipe', 'tocantins',
];
const BR_UFS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to'];

// Nomes de país (pt/es/en), capitais, grandes cidades e regiões administrativas comuns em vagas.
const PLACES: [string, RegExp][] = [
  ['BR', /\b(brasil|brazil|sao paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|florianopolis|campinas|brasilia|recife|salvador|fortaleza|goiania|barueri)\b/],
  ['AR', /\b(argentina|buenos aires|cordoba|rosario|mendoza|caba)\b/],
  ['BO', /\b(bolivia|la paz|santa cruz de la sierra|cochabamba)\b/],
  ['CL', /\b(chile|santiago|valparaiso|concepcion|region metropolitana)\b/],
  ['CO', /\b(colombia|bogota|medellin|cali|barranquilla|cundinamarca|antioquia|valle del cauca)\b/],
  ['CR', /\b(costa rica|san jose)\b/],
  ['DO', /\b(republica dominicana|dominican republic|santo domingo)\b/],
  ['EC', /\b(equador|ecuador|quito|guayaquil|pichincha)\b/],
  ['SV', /\b(el salvador|san salvador)\b/],
  ['GT', /\b(guatemala)\b/],
  ['HN', /\b(honduras|tegucigalpa)\b/],
  ['MX', /\b(mexico|cdmx|ciudad de mexico|cidade do mexico|guadalajara|monterrey|jalisco|nuevo leon|queretaro|puebla)\b/],
  ['NI', /\b(nicaragua|managua)\b/],
  ['PA', /\b(panama)\b/],
  ['PY', /\b(paraguai|paraguay|asuncion|assuncao)\b/],
  ['PE', /\b(peru|lima|arequipa)\b/],
  ['UY', /\b(uruguai|uruguay|montevideo|montevideu)\b/],
  ['VE', /\b(venezuela|caracas)\b/],
];

const plain = (s: string | null | undefined) => stripAccents(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isBrazilianState(state: string | null | undefined): boolean {
  const s = plain(state);
  return BR_STATES.includes(s) || BR_UFS.includes(s);
}

// Código ISO do país, ou null quando não é possível afirmar que é Brasil/América Latina.
export function detectCountry(city?: string | null, state?: string | null, country?: string | null): string | null {
  const c = (country ?? '').trim();
  if (c) {
    const code = c.toUpperCase();
    if (code.length === 2) return LATAM_COUNTRIES[code] ? code : null;
    for (const [iso, re] of PLACES) if (re.test(plain(c))) return iso;
    return null;
  }
  if (isBrazilianState(state)) return 'BR';
  const text = `${plain(city)} ${plain(state)}`.trim();
  for (const [iso, re] of PLACES) if (re.test(text)) return iso;
  return null;
}

export const isAllowedCountry = (iso: string | null | undefined): boolean => !!iso && iso in LATAM_COUNTRIES;
export const countryName = (iso: string | null | undefined): string => (iso ? LATAM_COUNTRIES[iso] ?? iso : '—');
