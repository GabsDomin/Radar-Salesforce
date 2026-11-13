# Estratégia: do radar ao cliente (revisão de 12/11/2026)

## O problema
O radar já encontra empresas (26 → 170+ leads), mas cliente vem de **conversa no momento certo, com a
pessoa certa e com um motivo concreto**. O que faltava eram as etapas 4 a 6:

| Etapa | Antes | Agora |
|---|---|---|
| 1. Quem pode comprar | ✅ várias fontes | ✅ + Workday/Workable/Ashby pelo site, alertas do LinkedIn por e-mail |
| 2. Por que agora | 🟡 misturado | ✅ página **Hoje** separa por oferta e momento |
| 3. O que oferecer | 🟡 sugestão solta | ✅ Hoje organizado por Improve / Ágil / Keep |
| 4. Com quem falar | 🔴 nada | ✅ cargo-alvo por oferta + diretoria da Receita + contatos cadastrados |
| 5. O que dizer | 🔴 nada | ✅ rascunho por oferta com a evidência do lead (revisar e enviar) |
| 6. Rotina e resultado | 🔴 nada | ✅ Contatei → Respondeu → Reunião, retornos pendentes, resultado por fonte |

## Oferta × sinal × velocidade
| Oferta | Quem compra agora | Sinal | Velocidade |
|---|---|---|---|
| **Improve** (alocação) | Quem tem vaga Salesforce aberta (sobretudo 30+ dias) | Vagas | A mais rápida: orçamento aprovado e dor imediata |
| **Ágil** (projeto) | CRM concorrente, migração, fusão, diretoria nova | Vagas de CRM, DNS/site, Receita, notícias | Mais longa, contrato maior |
| **Keep** (sustentação) | Já usa Salesforce, sem time visível | DNS/site, casos publicados | Média; depende do contrato atual |

## Rotina sugerida
1. Abrir **Hoje** todo dia: cobrar os **retornos pendentes** primeiro.
2. Escolher 5–10 leads (Improve primeiro), achar a pessoa do cargo-alvo no LinkedIn **manualmente**,
   cadastrar o contato no lead, revisar o rascunho e enviar.
3. Marcar **Contatei**; depois **Respondeu** / **Reunião marcada** / **Sem resposta**.
4. Uma vez por semana: **Triagem** dos leads novos e o cartão **Resultado por fonte** no Dashboard.
5. Uma vez por mês: exportar a **lista de co-venda** e levar aos executivos de contas da Salesforce.

## Canais além do radar
- **Co-venda com a Salesforce** (executivos de contas indicam parceiros): `/co-venda.csv`.
- **Base instalada** (aba Tecnologia e seção Keep): sustentação, melhorias, Agentforce/Data Cloud.
  Confirmar datas de fim de suporte de recursos (ex.: Workflow Rules / Process Builder) antes de usar como argumento.
- **Comunidade Trailblazer, eventos** e **indicações**: botão "Adicionar lead" (origem evento/indicação).
- **Clientes atuais**: expansão e indicação (fora do radar, maior conversão).

## Pesquisa de fontes de vagas (verificado em 12/11/2026)
| Fonte | Decisão | Motivo |
|---|---|---|
| LinkedIn (coleta automática) | ❌ | Termos proíbem; entra pelos **alertas no seu e-mail** (`importar-alertas`) |
| Indeed, Glassdoor | ❌ | Termos proíbem |
| Catho | ❌ | Bloqueia acesso automatizado (HTTP 403) |
| InfoJobs | ❌ | Aviso legal proíbe robôs/crawlers e reprodução |
| Vagas.com | ❌ | Termos proíbem reproduzir conteúdo sem autorização |
| SmartRecruiters | ❌ | robots.txt da API proíbe robôs (coletor removido) |
| Gupy (busca do portal) | ✅ | robots.txt libera |
| Get on Board | ✅ | API pública, robots.txt libera |
| Greenhouse, Lever, Workable, Ashby, Workday | ✅ | APIs públicas por empresa; descobertas pelo site da empresa e pelo nome |
| Receita via BrasilAPI | ✅ | Dados públicos por CNPJ (CNAE, porte, diretoria) |
| GDELT e PNCP | ⏸ | Bloqueados **nesta rede**; rodar a coleta em outra rede (ex.: GitHub Actions) |

## Pendências que dependem do Gabriel
1. **Lista de clientes da Sottelli** (exclusão) — maior risco com 170+ leads.
2. **Chave da Anthropic API** — trocar os rascunhos por texto gerado pela Claude.
3. **Alertas do LinkedIn** — criar alertas e salvar os e-mails em `seeds/alertas-linkedin/`.
4. **Onde decidir** — se o time precisa aprovar pelo link da Vercel, falta banco na nuvem + login.
5. **Coleta diária fora desta rede** (GitHub Actions + token da Vercel) — destrava GDELT/PNCP.
