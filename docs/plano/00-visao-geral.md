# Radar de Oportunidades Salesforce — Visão Geral

## Contexto
Sottelli: consultoria brasileira especializada em Salesforce (Managed Partner; Sales,
Service e Marketing Cloud), clientes em indústria, serviços financeiros e agronegócio.
Time comercial reduzido — Gabriel está sozinho na prospecção.

## Objetivo
Um sistema que descobre empresas com sinal de necessidade Salesforce, entrega uma lista
priorizada de contas com nota explicada e evidências, e funciona como **copiloto
comercial**: faz o trabalho de preparação de um executivo de contas (prospectar,
pesquisar, preparar abordagem, organizar o funil), enquanto Gabriel decide, revisa e
envia. **O sistema nunca envia nada automaticamente.**

## As três ofertas da Sottelli (o que o Radar precisa mapear)
| Oferta | O que é | Sinal que indica |
|---|---|---|
| **Keep** | Suporte/sustentação Salesforce | Salesforce antigo sem time interno, funcionalidades descontinuadas, reclamações de atendimento |
| **Improve** | Profissional alocado por banco de horas | Vaga Salesforce difícil de preencher, republicada, ou aberta há tempo |
| **Ágil** | Projeto (implantação, migração, integração) | Primeira vaga Salesforce, vaga de Arquiteto/Tech Lead, licitação, fusão, migração de outra ferramenta |

Cada conta no painel mostra qual oferta encaixa e por quê — não só "tem potencial".

## Restrições (não negociáveis)
- Não raspar LinkedIn. Respeitar robots.txt e aplicar limite de requisições em toda fonte.
- LGPD: coleta de **empresas**. Dados pessoais só cadastro manual (Gabriel encontra a
  pessoa), base legal = legítimo interesse B2B, com opt-out. Sem coleta automática de
  pessoas no MVP — a melhorar no futuro (ver [[05-pendencias]]).
- Sistema nunca envia mensagem. Só gera rascunho para revisão humana.
- Excluir contas que já são clientes (importação de CSV).
- Todo dado guarda fonte e data de coleta.

## Decisões já tomadas (não reabrir sem motivo)
1. **Sem orçamento** para dados pagos (Econodata, BuiltWith, SerpAPI, Sales Navigator). Só fontes gratuitas/públicas.
2. **Sem conectores internos por ora** (HubSpot, Gmail, Drive, Confluence) — o Salesforce da
   Sottelli será autorizado depois, para cruzar com o CRM.
3. **Fontes só crescem, nunca encolhem.** Cada fonte é um módulo independente e cadastrado
   no catálogo (ver [[03-fontes]]), mesmo as "planejadas" ainda não implementadas.
4. **Indeed e LinkedIn ficam de fora** (termos de uso proíbem raspagem) — compensado por
   Gupy, Greenhouse, Lever, SmartRecruiters, Workday, Sólides, Programathor.
5. **Porte mínimo do perfil ideal: 100+ funcionários** (não 200+). Sem dado pago, o porte é
   **inferido** combinando 4 sinais gratuitos (ver [[01-arquitetura-e-modelo-de-dados]]).
6. **Capacidade do Gabriel: a semana toda** — a página "Hoje" do painel pode entregar um
   volume maior de contas por dia (a calibrar quando a etapa de funil for construída).
7. **Stack: Node.js 24 + TypeScript**, não Python — Python não está instalado na máquina e
   não há como instalar sem TI; Node já vem com SQLite, test runner e TS nativos.
8. **Projeto mora em** `C:\Users\gabriel.fernandes_so\radar-salesforce` (também acessível
   pelo atalho `Desktop\radar-salesforce`, que é um *junction* para a mesma pasta, não uma cópia).
9. **Contatos**: cadastro manual por ora (nome, cargo, e-mail, origem, base legal,
   opt-out); Gabriel quer melhorar isso no futuro.
10. **Manual de marca da Sottelli**: ainda não recebido (o link do Google Chat deu erro
    403 — exige login). O painel está com visual neutro até o arquivo ser salvo em
    `docs/manual-marca/`.

## Estado atual do código
Etapas 0–4 do roteiro (ver [[04-roteiro]]) implementadas e testadas (23 testes).
Coleta real já rodou: 50 vagas da Gupy → 26 contas → 4 excluídas (cliente/concorrente/
recrutadora) → pontuadas. **Abaixo da meta de 30 contas visíveis**, porque só a Gupy
está ativa; a etapa 5 (mais fontes de vaga) deve resolver isso.

Durante o desenvolvimento, foi encontrado e corrigido um bug real: a detecção de setor
por palavra-chave marcava quase tudo como "financeiro", porque termos como "crédito"
e "previdência" aparecem na lista de **benefícios** de quase qualquer vaga brasileira
(vale, previdência privada), não no texto sobre o setor da empresa. Corrigido com
regras mais específicas e testes de regressão com os casos reais encontrados.

## Como rodar localmente
```
cd C:\Users\gabriel.fernandes_so\radar-salesforce
npm install
npm test                  # 23 testes
node src/cli.ts excluir   # importa seeds/concorrentes.csv
node src/cli.ts coletar   # coleta a Gupy, classifica, deduplica, pontua
node src/cli.ts painel    # http://localhost:3333
```

## Índice dos demais documentos
- [[01-arquitetura-e-modelo-de-dados]] — stack, arquitetura, tabelas do banco
- [[02-pontuacao-e-ofertas]] — regras de pontuação 0-100 e mapeamento para Keep/Improve/Ágil
- [[03-fontes]] — catálogo completo de fontes (ativas, planejadas, bloqueadas)
- [[04-roteiro]] — ordem de implementação, etapa a etapa
- [[05-pendencias]] — decisões em aberto que dependem do Gabriel
