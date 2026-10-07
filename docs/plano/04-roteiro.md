# Roteiro de Implementação

## Feito ✅
| Etapa | Entrega | Status |
|---|---|---|
| 0 | Esqueleto: projeto, banco, cliente HTTP com robots.txt e limite de requisições, testes | ✅ `npm test` passa (23 testes) |
| 1 | Coletor da Gupy, classificação de vaga, deduplicação de empresa | ✅ `node src/cli.ts coletar` |
| 2 | Importação do CSV de exclusões (clientes/concorrentes/recrutadoras) | ✅ `node src/cli.ts excluir` (ver `seeds/concorrentes.csv`, lista inicial a validar com Gabriel) |
| 3 | Pontuação v1 com explicação por regra + sugestão de oferta | ✅ `node src/cli.ts pontuar` |
| 4 | Painel: lista, filtros, detalhe, exportação CSV, acompanhamento de status/funil | ✅ `node src/cli.ts painel` → http://localhost:3333 |

Primeira coleta real: 50 vagas → 26 contas → 4 excluídas. Abaixo da meta de 30 contas
visíveis — esperado, só a Gupy está ativa.

## Pendente
| Etapa | Entrega | Depende de |
|---|---|---|
| 5 | Greenhouse, Lever, SmartRecruiters e Vagas.com (se permitido) | Nada — pode começar já |
| 6 | Detecção de tecnologia: DNS/crt.sh e HTML (Pardot, Web-to-Lead, chat, Experience Cloud, RD Station) | Nada |
| 7 | Enriquecimento por CNPJ/CNAE (Receita Federal) | Decidir se baixa a base aberta completa (alguns GB) ou usa consulta por CNPJ quando disponível |
| 8 | Notícias (Google News RSS/GDELT) + PNCP + CADE | Nada |
| 9 | Hipótese de necessidade e rascunho de abordagem via Claude API | Chave da Anthropic API |
| 10 | `radar run --daily` agendado (Agendador de Tarefas do Windows) + relatório da execução | Etapas 5–9 concluídas |

## Critério de pronto do MVP
Rodar o pipeline e ver no painel pelo menos **30 contas reais, ranqueadas**, cada uma
com nota explicada, evidências com link e um rascunho de abordagem (etapa 9).
