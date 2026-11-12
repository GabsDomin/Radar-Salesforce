// Classificação de vagas: papel, Clouds citadas, senioridade, setor provável e
// se a vaga parece ser de consultoria/recrutadora (que não é prospect).
import { stripAccents } from '../normalize/company.ts';

export type JobRole = 'arquiteto' | 'tech_lead' | 'developer' | 'admin' | 'funcional' | 'qa' | 'usuario_crm' | 'outro';

export interface JobClassification {
  isSalesforce: boolean;
  role: JobRole;
  senior: boolean;
  clouds: string[];
  projectHints: string[];   // implantação, migração... (indica oferta Ágil)
  supportHints: string[];   // sustentação, suporte... (indica oferta Keep)
  consultancyReasons: string[];
  // Indício forte (a vaga se descreve como consultoria/alocação/recrutadora): a vaga é descartada.
  // Indício fraco (só "nossos clientes"): fica, marcada para revisão.
  consultancyStrong: boolean;
  pain: PainHint[];         // indícios de insatisfação com o sistema atual, cada um com trecho de prova
  competitorCrms: string[]; // CRMs concorrentes citados (HubSpot, RD Station, Dynamics...)
  opsRole: boolean;         // cargo de RevOps/Sales Ops/CRM no título
  sector: { sector: string; evidence: string } | null;
}

export type PainKind = 'migracao_crm' | 'sistema_legado' | 'org_mal_aproveitada' | 'processo_manual';
export interface PainHint { kind: PainKind; label: string; evidence: string }

const CRM_OTHERS = 'rd station|hubspot|zoho|pipedrive|dynamics|bitrix|sugar ?crm|vtiger|sap crm|totvs crm|crm proprio|crm atual';

// Cada padrão procura uma frase que revela insatisfação ou troca iminente. Frases genéricas
// ("planilhas", "legado" sozinhos) ficam de fora: aparecem em listas de requisitos de toda vaga.
const PAIN_PATTERNS: [PainKind, string, RegExp][] = [
  ['migracao_crm', 'migração/substituição de CRM', new RegExp(
    String.raw`(migra\w+|substitui\w+|troca|transi\w+) (do|da|de|dos)? ?(${CRM_OTHERS})` +
    String.raw`|(${CRM_OTHERS})[^.\n]{0,60}(para|->|→|pelo) (o )?salesforce` +
    String.raw`|substitui\w+ (do|de|d[oa]) (crm|sistema) atual`)],
  ['sistema_legado', 'sistema legado', /(crm|sistema|plataforma|ferramenta) legad[oa]|migra\w+ (de|do|da) (sistemas? )?legad[oa]s?|descontinua\w+ (d[oa]|de) (crm|sistema)/],
  ['org_mal_aproveitada', 'Salesforce existente com problemas', /org (existente|atual|legada)|debito tecnico|baixa adocao|adocao (do|da|de) (salesforce|crm|plataforma)|reestrutura\w+ (do|da|de) (crm|org|salesforce|plataforma)|assumir (a )?(sustenta\w+|org|plataforma)|otimiza\w+ (do|da|de) (org|salesforce|crm|plataforma)|melhor\w+ (o|do) uso (do|da) (salesforce|crm)/],
  ['processo_manual', 'processo manual / falta de integração', /(controles?|processos?|relatorios?|vendas|atendimento) (em|via|por|feitos? em) planilhas?|processos? manuais|controles? manuais|falta de integra\w+ entre|sistemas? (nao|sem) integrad\w+/],
];

export function detectPain(all: string, radius = 70): PainHint[] {
  const out: PainHint[] = [];
  for (const [kind, label, re] of PAIN_PATTERNS) {
    const m = re.exec(all);
    if (!m) continue;
    const start = Math.max(0, m.index - radius);
    const snippet = all.slice(start, m.index + m[0].length + radius).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    out.push({ kind, label, evidence: (start > 0 ? '…' : '') + snippet + '…' });
  }
  return out;
}

// "Sales/Service/Marketing Cloud" também são nomes de produtos da SAP, Oracle e Adobe:
// só contam como Salesforce quando não vêm logo depois desses nomes.
const NOT_OTHER_VENDOR = String.raw`(?<!(sap|oracle|adobe|microsoft) )`;
const CLOUDS: [string, RegExp][] = [
  ['Sales Cloud', new RegExp(NOT_OTHER_VENDOR + 'sales cloud')],
  ['Service Cloud', new RegExp(NOT_OTHER_VENDOR + 'service cloud')],
  ['Marketing Cloud', new RegExp(NOT_OTHER_VENDOR + String.raw`marketing cloud|\bsfmc\b|exact ?target|journey builder|ampscript`)],
  ['Account Engagement (Pardot)', /pardot|account engagement/],
  ['Experience Cloud', /experience cloud|community cloud/],
  ['Data Cloud', /data cloud/],
  ['CPQ / Revenue Cloud', /\bcpq\b|revenue cloud/],
  ['Commerce Cloud', /commerce cloud/],
  ['Field Service', /field service/],
  ['Financial Services Cloud', /financial services cloud|\bfsc\b/],
  ['Health Cloud', /health cloud/],
  ['Agentforce', /agentforce|einstein/],
  ['MuleSoft', /mulesoft/],
  ['Tableau / CRM Analytics', /tableau|crm analytics/],
];

const SALESFORCE_RE = new RegExp(String.raw`salesforce|pardot|${NOT_OTHER_VENDOR}(marketing|service|sales) cloud|\bapex\b|\blwc\b|lightning web|visualforce|account engagement|agentforce`);

// CRMs concorrentes: vaga que pede um deles é candidata a migração para Salesforce.
export const COMPETITOR_CRMS: [string, RegExp][] = [
  ['HubSpot', /\bhubspot\b/],
  ['RD Station', /\brd ?station\b/],
  ['Microsoft Dynamics', /dynamics ?365|dynamics crm|microsoft dynamics|\bms dynamics\b/],
  ['Zoho CRM', /\bzoho\b/],
  ['Pipedrive', /\bpipedrive\b/],
  ['SAP CRM / C4C', /sap (crm|c4c|cx|sales cloud|service cloud|customer experience)|\bc4c\b/],
  ['Oracle CX', /oracle (cx|siebel|sales cloud|service cloud|marketing cloud)|\bsiebel\b/],
  ['Adobe Marketo', /\bmarketo\b|adobe marketing cloud/],
  ['SugarCRM', /sugar ?crm/],
  ['Bitrix24', /\bbitrix/],
  ['Ploomes', /\bploomes\b/],
  ['Agendor', /\bagendor\b/],
  ['PipeRun', /\bpipe ?run\b/],
  ['Freshsales', /freshsales|freshworks crm/],
];

// Cargo de operação comercial/CRM no título: mostra processo comercial estruturado.
const OPS_ROLE = /\b(revops|revenue operations|sales ?ops|sales operations|marketing ?ops|marketing operations|gerente de crm|coordenador[a]? de crm|especialista (em|de) crm|analista de crm|crm manager|head de crm|crm specialist|cs ?ops|customer success operations)\b/;

// Indícios de que quem contrata é consultoria, outsourcing ou recrutadora.
const CONSULTANCY_PATTERNS: [string, RegExp, boolean][] = [
  ['menciona "nossos clientes"', /nossos clientes|clientes da (empresa|consultoria)|projetos (em|para) clientes|atuar em clientes/, false],
  ['vaga de alocação', /aloca(cao|do|da) (em|no|na)|body ?shop|outsourcing/, true],
  ['descreve-se como consultoria', /somos uma consultoria|consultoria (especializada|de tecnologia|em (crm|salesforce))|empresa de consultoria/, true],
  ['parceira Salesforce', /parceir[oa] (salesforce|oficial)|salesforce (partner|consulting partner)|partner salesforce/, true],
  ['vaga de recrutadora', /nosso cliente|para (um|uma) (cliente|empresa) (do|de|no)|hunting|recrutamento e sele(cao)/, true],
  ['time de delivery para clientes', /delivery (para|com) clientes|bu (de )?crm/, true],
  // Espanhol (Get on Board e vagas da América Latina).
  ['consultoria (vaga em espanhol)', /somos una (consultora|empresa de (servicios|consultoria|tecnologia))|\buna consultora\b|consultora (especializada|tecnologica|de ti|lider)|empresa de servicios (de ti|tecnologicos)|staffing|fabrica de software|para (un |una )?(importante|reconocid[oa]|gran) (cliente|empresa)|para (nuestro|un) cliente|partner (de |oficial de )?salesforce|socio de salesforce|proyectos para clientes/, true],
  ['menciona "nuestros clientes"', /nuestros clientes/, false],
  ['agência ou parceira de CRM', /somos uma agencia|agencia (de marketing|digital|de performance|parceira)|parceir[oa] (hubspot|rd station|microsoft)|(hubspot|rd station) partner|partner (hubspot|rd station)/, true],
];

// Delimitadores de palavra em todos os termos: sem eles, "credito" casa dentro de
// "acredito" e "banco" casa dentro de "banco de talentos" (termo de RH, não banco).
// Termos genéricos (crédito, previdência, seguro, financeiro) aparecem na lista de
// BENEFÍCIOS de quase toda vaga brasileira (vale, previdência privada, plano de saúde)
// e não indicam o setor da empresa, por isso ficam fora. "banco" também pode ser
// "banco de dados"/"banco de talentos"/"banco de horas", por isso a exclusão.
const SECTORS: [string, RegExp][] = [
  ['financeiro', /\bbanco\b(?! de (talentos|dados|horas|preco[s]?)| oracle)|\bbank\b|\bseguradora\b|\bfintechs?\b|cooperativa de credito|corretora de (seguros|valores|cambio)|\bmercado financeiro\b|meios de pagamento|\b(gestora|asset) de (recursos|investimentos)\b/],
  ['agro', /\bagronegocio\b|\bagro\b|\bagricol\w*\b|\bgraos\b|\bsementes\b|\bfertilizant\w*\b|\bdefensiv\w*\b|\busina\b|sucroenerg\w*|\bpecuaria\b|frigorific\w*|cooperativa agro|insumos agricolas/],
  ['industria', /\bindustria\w*\b|\bfabrica\b|\bmanufatura\b|\balimentos\b|\bbebidas\b|\bquimic\w*\b|metalurg\w*|siderurg\w*|automotiv\w*|\btextil\b|embalage\w*|farmaceutic\w*|cosmetic\w*/],
];

export function classifyJob(title: string, description: string): JobClassification {
  const t = stripAccents(title).toLowerCase();
  const d = stripAccents(description).toLowerCase();
  const all = `${t}\n${d}`;

  const role = classifyRole(t, all);
  const senior = /\b(senior|sr\.?|especialista|lead|lider|principal|iii)\b/.test(t);
  const clouds = CLOUDS.filter(([, re]) => re.test(all)).map(([name]) => name);
  if (!clouds.length && SALESFORCE_RE.test(all)) clouds.push('Salesforce (Cloud não especificada)');

  const projectHints = matchHints(all, [
    ['implantação', /implanta(cao|r)|implementa(cao|r) (do|de|o) (salesforce|crm)/],
    ['migração', /migra(cao|r)/],
    ['novo projeto', /novo projeto|projeto de (crm|transformacao)|greenfield/],
    ['integrações', /integra(cao|coes) (com|entre)/],
  ]);
  const supportHints = matchHints(all, [
    ['sustentação', /sustenta(cao|r)/],
    ['suporte', /suporte (ao|a|n3|n2|tecnico)|atendimento a (chamados|usuarios)/],
    ['melhoria contínua', /melhoria continua|evolu(cao|ir) (da|do) (org|plataforma)/],
  ]);

  const consultancyHits = CONSULTANCY_PATTERNS.filter(([, re]) => re.test(all));
  const consultancyReasons = consultancyHits.map(([reason]) => reason);
  const consultancyStrong = consultancyHits.some(([, , strong]) => strong);

  let sector: JobClassification['sector'] = null;
  for (const [name, re] of SECTORS) {
    const m = all.match(re);
    if (m) { sector = { sector: name, evidence: m[0] }; break; }
  }

  return {
    isSalesforce: SALESFORCE_RE.test(all),
    role,
    senior,
    clouds,
    projectHints,
    supportHints,
    consultancyReasons,
    consultancyStrong,
    pain: detectPain(all),
    competitorCrms: COMPETITOR_CRMS.filter(([, re]) => re.test(all)).map(([name]) => name),
    opsRole: OPS_ROLE.test(t),
    sector,
  };
}

function classifyRole(title: string, all: string): JobRole {
  if (/arquitet|architect/.test(title)) return 'arquiteto';
  if (/tech ?lead|lider(anca)? tecnic|technical lead/.test(title)) return 'tech_lead';
  if (/\b(qa|testes?|quality)\b/.test(title)) return 'qa';
  if (/desenvolvedor|developer|\bdev\b|programador|engenheir|apex|lwc/.test(title)) return 'developer';
  if (/admin/.test(title)) return 'admin';
  if (/funcional|consultor|business analyst|analista de negocios/.test(title)) return 'funcional';
  // "Analista de CRM (Salesforce Marketing Cloud)" é usuário da plataforma, não time técnico Salesforce.
  if (/\bcrm\b|marketing(?! cloud)|vendas|sales ops|revops|atendimento|customer/.test(title) && SALESFORCE_RE.test(all)) return 'usuario_crm';
  if (/salesforce/.test(title)) return 'funcional';
  return 'outro';
}

function matchHints(text: string, hints: [string, RegExp][]): string[] {
  return hints.filter(([, re]) => re.test(text)).map(([h]) => h);
}
