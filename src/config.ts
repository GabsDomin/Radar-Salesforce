// Configuração central do Radar. Tudo que é "regra de negócio ajustável" fica aqui.
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.RADAR_DATA_DIR ?? path.join(ROOT, 'data');
export const DB_PATH = process.env.RADAR_DB ?? path.join(DATA_DIR, 'radar.db');

export const http = {
  userAgent: 'RadarSottelli/0.1 (+https://www.sottelli.com)',
  // Intervalo mínimo entre requisições ao mesmo domínio.
  minIntervalMs: 2000,
  timeoutMs: 20000,
  maxRetries: 2,
};

// GDELT pede no máximo 1 requisição a cada 5 s.
export const gdeltIntervalMs = 5500;

// Termos buscados nas fontes de vagas.
export const jobSearchTerms = [
  'salesforce',
  'marketing cloud',
  'service cloud',
  'sales cloud',
  'pardot',
  'account engagement',
  'apex',
  'crm salesforce',
  'experience cloud',
  'data cloud',
  'agentforce',
];

// Termos para achar empresas que usam CRM concorrente (candidatas a migração) e
// times de operação comercial. Só entra vaga que cite algum CRM (Salesforce ou concorrente).
export const competitorSearchTerms = [
  'hubspot',
  'rd station',
  'dynamics 365',
  'zoho crm',
  'pipedrive',
  'sap c4c',
  'revops',
  'sales ops',
  'gerente de crm',
];

// Perfil de cliente ideal (ICP).
export const icp = {
  sectors: ['industria', 'financeiro', 'agro'] as const,
  minEmployees: 100,
  country: 'BR',
};

// Vagas: janelas de tempo usadas na pontuação.
export const jobWindows = {
  freshDays: 30,
  activeDays: 90,
  // Vaga publicada há mais tempo que isso e ainda aberta = dificuldade de contratar.
  hardToFillDays: 45,
  // Vaga vista na fonte nos últimos N dias = ainda aberta.
  stillOpenDays: 21,
  // Aberta há mais que isso = vaga "permanente" (cadastro contínuo), não contratação de verdade.
  maxRealOpenDays: 180,
};

// Títulos que não são contratação de verdade (banco de talentos, cadastro reserva...).
export const EVERGREEN_TITLE = /banco de talentos|talent pool|cadastro reserva|vagas? futuras?|oportunidades futuras|cadastre seu curr/i;

// Pontos por tempo de vaga aberta: quanto mais tempo aberta, maior a dificuldade de contratar
// e mais chance de aceitar profissional alocado (Improve). [dias mínimos, pontos extras]
// Cargos técnicos Salesforce: são os que a Sottelli supre com alocação (Improve).
export const TECH_ROLES = ['developer', 'admin', 'funcional', 'qa', 'arquiteto', 'tech_lead'];

export const OPEN_AGE_BONUS: [number, number][] = [[60, 25], [45, 20], [30, 14], [15, 7]];

export const RULES_VERSION = 'v1.4';
