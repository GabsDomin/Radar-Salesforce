// Rascunhos de abordagem por oferta, montados com a evidência do lead.
// São sugestões para a pessoa revisar e enviar; nada é enviado automaticamente.
// Quando houver ANTHROPIC_API_KEY, dá para trocar por um texto gerado pela Claude API (etapa 9).

export type Offer = 'Improve' | 'Keep' | 'Ágil';

export interface DraftInput {
  company: string;
  offer: Offer;
  // Improve: vaga aberta
  jobTitle?: string;
  daysOpen?: number;
  jobCount?: number;
  clouds?: string[];
  // Keep: o que usa de Salesforce e como foi visto
  salesforceProducts?: string[];
  seenHow?: string;
  // Ágil: CRM concorrente, dor ou gatilho
  competitor?: string;
  competitorWhere?: string;
  trigger?: { kind: string; title: string; source?: string };
  painLabel?: string;
}

export interface Draft { subject: string; body: string; targetRole: string }

export const TARGET_ROLE: Record<Offer, string> = {
  Improve: 'Gestor(a) de TI ou de CRM, Tech Lead Salesforce, ou quem abriu a vaga (RH / Tech Recruiter)',
  Keep: 'Gerente de CRM ou de Sistemas Comerciais, Product Owner do Salesforce, Gerente de TI',
  'Ágil': 'CIO / Diretor(a) de TI e Diretor(a) Comercial ou de Marketing (patrocinador do projeto)',
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

export function draftMessage(i: DraftInput): Draft {
  const sign = '\n\nAbraço,\n[seu nome] — Sottelli';
  if (i.offer === 'Improve') {
    const tempo = i.daysOpen && i.daysOpen >= 21 ? `está aberta há ${i.daysOpen} dias` : 'foi aberta recentemente';
    const mais = i.jobCount && i.jobCount > 1 ? ` (e mais ${i.jobCount - 1} vaga(s) Salesforce)` : '';
    const stack = i.clouds?.length ? ` com experiência em ${list(i.clouds.slice(0, 3))}` : ' em Salesforce';
    return {
      targetRole: TARGET_ROLE.Improve,
      subject: `Vaga de ${i.jobTitle ?? 'Salesforce'} na ${i.company}`,
      body: `Olá, tudo bem?\n\nVi que a vaga de ${i.jobTitle ?? 'Salesforce'} da ${i.company} ${tempo}${mais}. `
        + `Contratar perfil Salesforce tem levado tempo no mercado. Enquanto vocês fecham a posição, a Sottelli pode alocar `
        + `um(a) profissional${stack} para começar em poucos dias, por horas ou por mês, sem tirar o foco da contratação.\n\n`
        + `Faz sentido conversarmos 15 minutos esta semana?${sign}`,
    };
  }
  if (i.offer === 'Keep') {
    const usa = i.salesforceProducts?.length ? list(i.salesforceProducts.slice(0, 3)) : 'Salesforce';
    return {
      targetRole: TARGET_ROLE.Keep,
      subject: `${usa} na ${i.company}: sustentação e evolução`,
      body: `Olá, tudo bem?\n\nVi que a ${i.company} usa ${usa}${i.seenHow ? ` (${i.seenHow})` : ''}. `
        + `É comum, depois da implantação, a demanda de ajustes, melhorias e suporte crescer sem um time dedicado a isso. `
        + `A Sottelli faz a sustentação de Salesforce com time sênior e acordo de nível de serviço, e também evolui a org `
        + `(automação, novos processos, Agentforce).\n\nHoje vocês têm alguém cuidando disso? Posso mostrar em 15 minutos como trabalhamos.${sign}`,
    };
  }
  // Ágil: projeto (migração, integração, implantação)
  if (i.competitor) {
    return {
      targetRole: TARGET_ROLE['Ágil'],
      subject: `${i.competitor} → Salesforce na ${i.company}`,
      body: `Olá, tudo bem?\n\nVi que a ${i.company} trabalha com ${i.competitor}${i.competitorWhere ? ` (${i.competitorWhere})` : ''}. `
        + `Quando a operação comercial cresce, costuma chegar o momento de unificar processos, dados e atendimento em uma plataforma `
        + `como o Salesforce. A Sottelli conduz migrações de ${i.competitor} para Salesforce em projeto ágil, com entregas a cada duas semanas `
        + `e sem parar a operação.\n\nEstão avaliando algo nessa linha para os próximos meses?${sign}`,
    };
  }
  if (i.trigger) {
    const motivo = i.trigger.kind === 'fusao'
      ? 'Integrar duas operações costuma passar por unificar CRM, dados de clientes e processos comerciais'
      : i.trigger.kind === 'lideranca'
        ? 'Lideranças novas costumam revisar as ferramentas e prioridades de vendas, marketing e atendimento no primeiro ano'
        : 'Momentos de expansão costumam exigir estruturar vendas, marketing e atendimento em uma plataforma única';
    return {
      targetRole: TARGET_ROLE['Ágil'],
      subject: i.trigger.source === 'receita' ? `${i.company}: novos planos para vendas e atendimento?` : `${i.company}: ${i.trigger.title.slice(0, 60)}`,
      body: `Olá, tudo bem?\n\n${i.trigger.source === 'receita' ? `Vi que a ${i.company} tem uma composição nova na diretoria` : `Vi a notícia "${i.trigger.title}"`}. ${motivo}. A Sottelli apoia esse tipo de movimento com projetos Salesforce `
        + `em ciclos curtos, começando pelo que dá resultado mais rápido.\n\nFaz sentido trocarmos uma ideia sobre os planos de vocês?${sign}`,
    };
  }
  return {
    targetRole: TARGET_ROLE['Ágil'],
    subject: `Projeto Salesforce na ${i.company}`,
    body: `Olá, tudo bem?\n\nVi sinais de que a ${i.company} está ${i.painLabel ? `lidando com ${i.painLabel}` : 'estruturando a operação comercial'}. `
      + `A Sottelli conduz projetos Salesforce em ciclos curtos, com entregas a cada duas semanas.\n\nPodemos conversar 15 minutos?${sign}`,
  };
}
