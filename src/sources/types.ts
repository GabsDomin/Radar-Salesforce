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
  { id: 'smartrecruiters', name: 'SmartRecruiters (API pública)', kind: 'vagas', status: 'bloqueada', note: 'robots.txt da API proíbe robôs (verificado em 12/11/2026).' },
  { id: 'getonbrd', name: 'Get on Board (América Latina)', kind: 'vagas', status: 'ativa', note: 'API pública de busca; robots.txt libera. Revela também empresas que usam Salesforce (SDR/CRM).' },
  { id: 'pncp', name: 'PNCP (licitações)', kind: 'gatilho', status: 'planejada', note: 'API aberta, mas a conexão é recusada a partir da rede atual (12/11/2026).' },
  { id: 'workday', name: 'Workday (páginas de carreira)', kind: 'vagas', status: 'planejada', note: 'Verificar robots.txt por empresa.' },
  { id: 'solides', name: 'Sólides', kind: 'vagas', status: 'planejada', note: 'robots.txt libera, mas a página monta as vagas no navegador; falta achar a API pública.' },
  { id: 'programathor', name: 'Programathor', kind: 'vagas', status: 'planejada', note: 'robots.txt libera; sem vagas Salesforce em 12/11/2026.' },
  { id: 'trampos', name: 'Trampos', kind: 'vagas', status: 'planejada', note: 'API aberta; poucas vagas e quase todas de marketing.' },
  { id: 'vagas_com', name: 'Vagas.com', kind: 'vagas', status: 'bloqueada', note: 'Termos proíbem reproduzir o conteúdo sem autorização.' },
  { id: 'indeed', name: 'Indeed', kind: 'vagas', status: 'bloqueada', note: 'Termos de uso proíbem coleta automatizada.' },
  { id: 'linkedin', name: 'LinkedIn (coleta automática)', kind: 'vagas', status: 'bloqueada', note: 'Termos de uso proíbem raspagem.' },
  { id: 'linkedin-alerta', name: 'Alertas do LinkedIn no seu e-mail', kind: 'vagas', status: 'ativa', note: 'Lê só os e-mails de alerta que você recebe e salva em seeds/alertas-linkedin/ (comando importar-alertas).' },
  { id: 'workable', name: 'Workable / Ashby / Workday', kind: 'vagas', status: 'ativa', note: 'Achados pelo link de carreiras no site da empresa.' },
  { id: 'receita', name: 'Receita Federal via Minha Receita (CNPJ)', kind: 'cadastro', status: 'ativa', note: 'CNAE, porte e diretoria com data de entrada (troca de liderança).' },
  { id: 'catho', name: 'Catho', kind: 'vagas', status: 'bloqueada', note: 'Bloqueia acesso automatizado (HTTP 403).' },
  { id: 'infojobs', name: 'InfoJobs', kind: 'vagas', status: 'bloqueada', note: 'Aviso legal proíbe robôs e cópia por crawler.' },
  { id: 'dns', name: 'DNS (SPF/TXT/CNAME)', kind: 'tecnologia', status: 'planejada', note: 'Detecta Pardot, Marketing Cloud, Salesforce.' },
  { id: 'crtsh', name: 'Certificate Transparency (crt.sh)', kind: 'tecnologia', status: 'planejada', note: 'Subdomínios go./cloud./click.' },
  { id: 'site', name: 'HTML do site', kind: 'tecnologia', status: 'planejada', note: 'Pardot, Web-to-Lead, chat, Experience Cloud, RD Station.' },
  { id: 'cases', name: 'Cases de parceiros e da Salesforce', kind: 'tecnologia', status: 'planejada', note: 'Quem já tem Salesforce.' },
  { id: 'cade', name: 'CADE (atos de concentração)', kind: 'gatilho', status: 'planejada', note: 'Dados abertos.' },
  { id: 'reclameaqui', name: 'Reclame Aqui', kind: 'gatilho', status: 'planejada', note: 'Verificar termos.' },
  { id: 'noticias', name: 'GDELT (notícias)', kind: 'gatilho', status: 'ativa', note: 'Troca de liderança, fusão, investimento, expansão. Comando: noticias.' },
  { id: 'gnews', name: 'Google News RSS', kind: 'gatilho', status: 'bloqueada', note: 'robots.txt do Google News proíbe a busca.' },
  { id: 'receita', name: 'Receita Federal (CNPJ/CNAE)', kind: 'cadastro', status: 'planejada', note: 'Dados abertos.' },
];
