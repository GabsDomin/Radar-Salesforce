# Arquitetura e Modelo de Dados

Ver [[00-visao-geral]] para o contexto e as decisões já tomadas.

## Stack
| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem | **Node.js 24 + TypeScript** | Python não está instalado na máquina; Node 24 já traz SQLite (`node:sqlite`), test runner (`node --test`) e execução direta de `.ts` nativos — quase nada para instalar |
| Banco | **SQLite** via `node:sqlite` | Zero instalação; WAL habilitado; migração para Postgres é trivial se precisar de servidor depois |
| HTTP | `fetch` nativo + cliente próprio (`src/http/client.ts`) | Respeita robots.txt, limita requisições por domínio, identifica o robô no User-Agent, grava toda página buscada em `source_documents` |
| Painel | HTTP nativo (`node:http`) + HTML renderizado no servidor | Sem build de frontend; filtros via querystring; funciona em `localhost` |
| Testes | `node --test` | Nativo, sem dependência extra |
| IA (etapa 9) | Claude API | Hipótese de necessidade e rascunho de abordagem, sempre citando o sinal de origem |

## Arquitetura (pipeline)
```
Coletores (diários)       Enriquecimento        Pontuação         IA              Entrega
┌─────────────┐        ┌──────────────┐     ┌────────────┐   ┌────────────┐   ┌────────────┐
│ vagas       │──┐     │ normaliza/   │     │ regras     │   │ hipótese   │   │ painel web │
│ (Gupy, ...) │  │     │ dedup        │     │ versionadas│   │ rascunho   │   │ filtros    │
│ tecnologia  │──┼───▶ │ CNPJ/CNAE    │──▶  │ nota 0-100 │──▶│ (só        │──▶│ detalhe    │
│ (DNS/site)  │  │     │ exclui       │     │ + motivo   │   │ rascunho)  │   │ CSV        │
│ gatilhos    │──┘     │ cliente/     │     │ por regra  │   │            │   │            │
└─────────────┘        │ concorrente  │     └────────────┘   └────────────┘   └────────────┘
                        └──────────────┘
```
Toda resposta HTTP bruta é registrada em `source_documents` (URL, status, hash, data).

## Módulos implementados (`src/`)
- `config.ts` — configuração central (termos de busca, ICP, janelas de tempo, User-Agent)
- `db/` — schema SQL e abertura do banco
- `http/robots.ts` + `http/client.ts` — interpretação de robots.txt (RFC 9309) e cliente educado
- `normalize/company.ts` — normalização de nome de empresa para deduplicar
- `classify/job.ts` — classifica vaga: cargo, Clouds citadas, senioridade, indícios de
  projeto/sustentação, indícios de consultoria/recrutadora, setor
- `sources/gupy.ts` + `sources/types.ts` — coletor da Gupy e catálogo de fontes
- `pipeline/companies.ts` — upsert de conta, checagem de exclusão
- `pipeline/ingestJobs.ts` — grava vagas como sinais ligados a contas
- `pipeline/exclusions.ts` — importação do CSV de clientes/concorrentes/recrutadoras
- `scoring/score.ts` — pontuação 0-100 explicada + sugestão de oferta
- `web/` — consultas, views HTML, servidor, exportação CSV
- `cli.ts` — comandos: `coletar`, `pontuar`, `excluir`, `painel`, `fontes`

## Modelo de dados (SQLite — `src/db/schema.sql`)
- **companies**: id, nome, nome normalizado, CNPJ, domínio, setor (+ fonte do setor),
  CNAE, porte (+ fonte do porte), cidade/UF, status, etapa do funil, próxima ação,
  anotações, motivo de exclusão (cliente/concorrente/recrutadora).
- **company_aliases**: variações do nome e a fonte de cada uma (deduplicação).
- **source_documents**: URL, fonte, status HTTP, hash do conteúdo, data da coleta.
- **signals**: empresa, tipo (vaga/tecnologia/gatilho), subtipo, título, evidência
  (trecho), URL, fonte, id externo, nome da empresa como veio da fonte, data de
  publicação, data de coleta, `meta` (JSON com Clouds/senioridade/classificação),
  `review_flag` (motivo para revisão humana, ex.: "possível consultoria").
- **exclusions**: lista de clientes/concorrentes/recrutadoras (nome, CNPJ, domínio, origem).
- **scores**: nota total, aderência, sinal, ofertas sugeridas (JSON), breakdown
  completo (JSON, regra por regra), versão das regras, data do cálculo.
- **contacts**: cadastro manual de pessoas (nome, cargo, e-mail, origem, base legal,
  opt-out) — nunca populado automaticamente.
- **collection_runs**: histórico de execuções do coletor (início, fim, estatísticas, erro).

## Porte da empresa (sem dado pago)
Combinação de 4 sinais gratuitos, sempre marcados como **"inferido"** com a fonte:
1. Porte "Demais" na Receita (faturamento acima de R$ 4,8 milhões) e capital social
2. Quantidade de vagas abertas e de áreas contratando
3. Menções no próprio site ("mais de 300 colaboradores")
4. Presença em rankings/listas setoriais

(Enriquecimento por CNPJ/Receita ainda não implementado — etapa 7 do [[04-roteiro]].)
