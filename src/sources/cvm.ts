// Cadastro de companhias abertas da CVM (dados abertos, dados.cvm.gov.br).
// Dá nome, CNPJ, setor e e-mail de RI de ~760 empresas ativas; o domínio do e-mail vira o site.
import type { PoliteClient } from '../http/client.ts';
import { parseCsv } from '../util/csv.ts';

export const CVM_URL = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv';

// Setor da CVM → setor do perfil (ICP). Holdings ("Emp. Adm. Part.") e securitizadoras ficam de fora.
const SECTOR_MAP: [RegExp, 'financeiro' | 'industria' | 'agro'][] = [
  [/^(bancos|seguradoras e corretoras|intermedia[cç][aã]o financeira|arrendamento mercantil)$/i, 'financeiro'],
  [/^agricultura/i, 'agro'],
  [/^(m[aá]quinas|metalurgia|t[eê]xtil|alimentos|farmac[eê]utico|petroqu[ií]micos|papel e celulose|bebidas|extra[cç][aã]o mineral|petr[oó]leo e g[aá]s|brinquedos)/i, 'industria'],
];

const GENERIC_MAIL = /^(gmail|hotmail|outlook|live|yahoo|uol|bol|terra|ig|globo|icloud|msn)\./i;

export interface CvmCompany {
  name: string;
  cnpj: string;
  cvmSector: string;
  sector: 'financeiro' | 'industria' | 'agro';
  domain: string | null;
  city: string | null;
  state: string | null;
}

export function domainFromEmail(email: string | undefined): string | null {
  const m = (email ?? '').trim().toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m || GENERIC_MAIL.test(m[1])) return null;
  return m[1].replace(/^(mail|email|ri|investidores|ir)\./, '');
}

export function cleanCompanyName(raw: string): string {
  return raw
    .replace(/\s*-\s*em recupera[cç][aã]o judicial.*$/i, '')
    .replace(/\s+(s\.?\/?a\.?|ltda\.?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|\s|-)\S/g, (c) => c.toUpperCase());
}

export function parseCvm(text: string): CvmCompany[] {
  const out: CvmCompany[] = [];
  for (const r of parseCsv(text)) {
    if (r.sit !== 'ATIVO') continue;
    const name = r.denom_comerc || r.denom_social;
    if (!name || /recupera[cç][aã]o judicial|em liquida[cç][aã]o|participa[cç][oõ]es/i.test(`${r.denom_social} ${name}`)) continue;
    const sector = SECTOR_MAP.find(([re]) => re.test((r.setor_ativ ?? '').trim()))?.[1];
    if (!sector) continue;
    out.push({
      name: cleanCompanyName(name),
      cnpj: r.cnpj_cia,
      cvmSector: r.setor_ativ,
      sector,
      domain: domainFromEmail(r.email) ?? domainFromEmail(r.email_resp),
      city: r.mun ? cleanCompanyName(r.mun) : null,
      state: r.uf || null,
    });
  }
  return out;
}

export async function fetchCvm(client: PoliteClient): Promise<CvmCompany[]> {
  const res = await client.get(CVM_URL, 'cvm', { encoding: 'latin1' });
  if (res.status !== 200) throw new Error(`CVM respondeu HTTP ${res.status}`);
  return parseCvm(res.text);
}
