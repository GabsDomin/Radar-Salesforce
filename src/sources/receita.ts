// Dados cadastrais da Receita Federal por CNPJ, via Minha Receita (minhareceita.org: projeto aberto,
// dados públicos da Receita). A BrasilAPI tem o mesmo formato, mas o robots.txt dela proíbe /api/ para robôs.
// Traz CNAE (setor real), porte, município e o quadro de sócios e administradores (QSA) com data de entrada.
import type { PoliteClient } from '../http/client.ts';

export interface ReceitaInfo {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnae: string;            // 7 dígitos
  cnaeDescricao: string;
  porte: string;           // MICRO EMPRESA | EMPRESA DE PEQUENO PORTE | DEMAIS
  situacao: string;        // ATIVA, BAIXADA...
  municipio: string | null;
  uf: string | null;
  diretoria: { nome: string; cargo: string; desde: string | null }[];
}

export const onlyDigits = (s: string) => s.replace(/\D/g, '');

// Dígitos verificadores do CNPJ: evita pegar números quaisquer do rodapé.
export function isValidCnpj(raw: string): boolean {
  const c = onlyDigits(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

// Primeiro CNPJ válido no texto (rodapé do site costuma trazer "CNPJ: 00.000.000/0001-00").
export function findCnpj(text: string): string | null {
  for (const m of text.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    if (isValidCnpj(m[0])) return onlyDigits(m[0]);
  }
  return null;
}

// Setor do perfil pela divisão do CNAE (2 primeiros dígitos).
export function sectorFromCnae(cnae: string): 'agro' | 'industria' | 'financeiro' | 'outro' {
  const div = Number(cnae.slice(0, 2));
  if (div >= 1 && div <= 3) return 'agro';
  if (div >= 5 && div <= 33) return 'industria';
  if (div >= 64 && div <= 66) return 'financeiro';
  return 'outro';
}

const LEADER_ROLE = /diretor|presidente|administrador/i;

export function parseBrasilApi(json: string): ReceitaInfo {
  const j = JSON.parse(json);
  return {
    cnpj: onlyDigits(String(j.cnpj ?? '')),
    razaoSocial: j.razao_social ?? '',
    nomeFantasia: j.nome_fantasia || null,
    cnae: String(j.cnae_fiscal ?? '').padStart(7, '0'),
    cnaeDescricao: j.cnae_fiscal_descricao ?? '',
    porte: j.porte ?? j.descricao_porte ?? '',
    situacao: j.descricao_situacao_cadastral ?? '',
    municipio: j.municipio ?? null,
    uf: j.uf ?? null,
    diretoria: ((j.qsa ?? []) as { nome_socio?: string; qualificacao_socio?: string; data_entrada_sociedade?: string }[])
      .filter((s) => s.nome_socio && LEADER_ROLE.test(s.qualificacao_socio ?? ''))
      .map((s) => ({ nome: s.nome_socio!.trim(), cargo: s.qualificacao_socio!.trim(), desde: s.data_entrada_sociedade || null })),
  };
}

export const brasilApiUrl = (cnpj: string) => `https://minhareceita.org/${onlyDigits(cnpj)}`;

export async function fetchReceita(client: PoliteClient, cnpj: string): Promise<ReceitaInfo | null> {
  const res = await client.get(brasilApiUrl(cnpj), 'receita');
  if (res.status === 404 || res.status === 400) return null;
  if (res.status !== 200) throw new Error(`Minha Receita respondeu HTTP ${res.status}`);
  return parseBrasilApi(res.text);
}
