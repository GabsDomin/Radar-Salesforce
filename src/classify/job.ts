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
  sector: { sector: string; evidence: string } | null;
}

const CLOUDS: [string, RegExp][] = [
  ['Sales Cloud', /sales cloud/],
  ['Service Cloud', /service cloud/],
  ['Marketing Cloud', /marketing cloud|\bsfmc\b|exact ?target|journey builder|ampscript/],
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

const SALESFORCE_RE = /salesforce|pardot|marketing cloud|service cloud|sales cloud|\bapex\b|\blwc\b|lightning web|visualforce|account engagement|agentforce/;

// Indícios de que quem contrata é consultoria, outsourcing ou recrutadora.
const CONSULTANCY_PATTERNS: [string, RegExp][] = [
  ['menciona "nossos clientes"', /nossos clientes|clientes da (empresa|consultoria)|projetos (em|para) clientes|atuar em clientes/],
  ['vaga de alocação', /aloca(cao|do|da) (em|no|na)|body ?shop|outsourcing/],
  ['descreve-se como consultoria', /somos uma consultoria|consultoria (especializada|de tecnologia|em (crm|salesforce))|empresa de consultoria/],
  ['parceira Salesforce', /parceir[oa] (salesforce|oficial)|salesforce (partner|consulting partner)|partner salesforce/],
  ['vaga de recrutadora', /nosso cliente|para (um|uma) (cliente|empresa) (do|de|no)|hunting|recrutamento e sele(cao)/],
  ['time de delivery para clientes', /delivery (para|com) clientes|bu (de )?crm/],
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

  const consultancyReasons = CONSULTANCY_PATTERNS.filter(([, re]) => re.test(all)).map(([reason]) => reason);

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
