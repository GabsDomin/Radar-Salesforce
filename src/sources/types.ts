// Formato comum que toda fonte de vagas entrega ao pipeline.
export interface JobPosting {
  source: string;        // 'gupy', 'greenhouse', ...
  externalId: string;    // id da vaga na fonte
  title: string;
  description: string;
  companyName: string;   // nome do empregador como veio da fonte
  url: string;
  publishedAt: string | null;
  city: string | null;
  state: string | null;
  country: string;       // 'BR' quando a fonte é brasileira
  documentId: number | null; // source_documents.id de onde a vaga foi lida
}

// Catálogo de fontes. Fontes só são adicionadas; as bloqueadas ficam registradas com o motivo.
export interface SourceInfo {
  id: string;
  name: string;
  kind: 'vagas' | 'tecnologia' | 'gatilho' | 'cadastro';
  status: 'ativa' | 'planejada' | 'bloqueada';
  note: string;
}

export const SOURCE_CATALOG: SourceInfo[] = [
  { id: 'gupy', name: 'Gupy (portal público de vagas)', kind: 'vagas', status: 'ativa', note: 'robots.txt libera tudo; lê a busca pública do portal.' },
  { id: 'greenhouse', name: 'Greenhouse (API pública de vagas)', kind: 'vagas', status: 'ativa', note: 'API pública por empresa; quadros em seeds/quadros.csv.' },
  { id: 'lever', name: 'Lever (API pública de vagas)', kind: 'vagas', status: 'ativa', note: 'API pública por empresa; quadros em seeds/quadros.csv.' },
  { id: 'smartrecruiters', name: 'SmartRecruiters (API pública)', kind: 'vagas', status: 'ativa', note: 'API pública por empresa; quadros em seeds/quadros.csv.' },
  { id: 'workday', name: 'Workday (páginas de carreira)', kind: 'vagas', status: 'planejada', note: 'Verificar robots.txt por empresa.' },
  { id: 'solides', name: 'Sólides / Inhire / Kenoby', kind: 'vagas', status: 'planejada', note: 'Verificar robots.txt.' },
  { id: 'programathor', name: 'Programathor / GeekHunter / Trampos', kind: 'vagas', status: 'planejada', note: 'Verificar robots.txt.' },
  { id: 'vagas_com', name: 'Vagas.com', kind: 'vagas', status: 'planejada', note: 'Somente se robots.txt e termos permitirem.' },
  { id: 'indeed', name: 'Indeed', kind: 'vagas', status: 'bloqueada', note: 'Termos de uso proíbem coleta automatizada.' },
  { id: 'linkedin', name: 'LinkedIn', kind: 'vagas', status: 'bloqueada', note: 'Termos de uso proíbem raspagem.' },
  { id: 'dns', name: 'DNS (SPF/TXT/CNAME)', kind: 'tecnologia', status: 'planejada', note: 'Detecta Pardot, Marketing Cloud, Salesforce.' },
  { id: 'crtsh', name: 'Certificate Transparency (crt.sh)', kind: 'tecnologia', status: 'planejada', note: 'Subdomínios go./cloud./click.' },
  { id: 'site', name: 'HTML do site', kind: 'tecnologia', status: 'planejada', note: 'Pardot, Web-to-Lead, chat, Experience Cloud, RD Station.' },
  { id: 'cases', name: 'Cases de parceiros e da Salesforce', kind: 'tecnologia', status: 'planejada', note: 'Quem já tem Salesforce.' },
  { id: 'pncp', name: 'PNCP (licitações)', kind: 'gatilho', status: 'planejada', note: 'API aberta.' },
  { id: 'cade', name: 'CADE (atos de concentração)', kind: 'gatilho', status: 'planejada', note: 'Dados abertos.' },
  { id: 'reclameaqui', name: 'Reclame Aqui', kind: 'gatilho', status: 'planejada', note: 'Verificar termos.' },
  { id: 'noticias', name: 'Google News RSS / GDELT', kind: 'gatilho', status: 'planejada', note: 'Feeds abertos.' },
  { id: 'receita', name: 'Receita Federal (CNPJ/CNAE)', kind: 'cadastro', status: 'planejada', note: 'Dados abertos.' },
];
