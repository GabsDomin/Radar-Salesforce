# Roteiro de Implementação

## Feito ✅
| Etapa | Entrega | Status |
|---|---|---|
| 0 | Esqueleto: projeto, banco, cliente HTTP com robots.txt e limite de requisições, testes | ✅ `npm test` passa (23 testes) |
| 1 | Coletor da Gupy, classificação de vaga, deduplicação de empresa | ✅ `node src/cli.ts coletar` |
| 2 | Importação do CSV de exclusões (clientes/concorrentes/recrutadoras) | ✅ `node src/cli.ts excluir` (ver `seeds/concorrentes.csv`, lista inicial a validar com Gabriel) |
| 3 | Pontuação v1 com explicação por regra + sugestão de oferta | ✅ `node src/cli.ts pontuar` |
| 4 | Painel: lista, filtros, detalhe, exportação CSV, acompanhamento de status/funil | ✅ `node src/cli.ts painel` → http://localhost:3333 |
| 5 | Greenhouse, Lever e SmartRecruiters (`src/sources/boards.ts`) | ✅ `npm test` passa (24 testes). Lê os quadros de `seeds/quadros.csv` (`fonte;slug;empresa`), **hoje vazio**: precisa ser preenchido com empresas brasileiras que usam essas plataformas |
| 4b | Painel estático para a Vercel (`npm run site` → `publicar/`) | ✅ somente leitura, protegido por senha (HTTP Basic via `RADAR_SENHA`) |
| 8a | Notícias via GDELT: troca de liderança (TI/comercial), fusão/aquisição, investimento, expansão → gatilho na nota (`npm run noticias`) | ✅ testado com respostas simuladas; **ainda não validado contra o GDELT real** (limite de taxa por IP no dia do teste) |
| 11 | Central de atualização e painéis: `npm run atualizar` (vagas + notícias + site, `--publicar` envia à Vercel), página **Dashboard** e página **Atualizar** (botão, andamento ao vivo) no painel local | ✅ `npm test` passa (33 testes) |
| 12 | Modalidades separadas, cada uma com tela própria: **Vagas**, **Liderança**, **Outros gatilhos** (fusão, investimento, expansão) e **Dor** (indício de insatisfação com o sistema atual, nota v1.2 com bônus de até +15) | ✅ `npm test` passa (37 testes). Liderança e gatilhos ficam vazias até a primeira atualização de notícias |
| 13 | Fluxo de trabalho: **Leads** (antes "Contas") com abas Todos/Vagas/Liderança/Outros gatilhos/Dor; situação A triar/Aprovadas/Adiadas/Descartadas; **Triagem** lead a lead com atalhos (A/D/S/J/K/O); aprovar, descartar com motivo, adiar, reabrir; histórico por lead; nota subiu/desceu; "Seu trabalho" e próximas ações no dashboard | ✅ `npm test` passa (46 testes). Decisões só no painel local; o site da Vercel é cópia somente leitura |
| 14 | Mais fontes e mais leads (26 → 170): Get on Board (América Latina), quadros Greenhouse/Lever descobertos automaticamente (`descobrir-quadros`), vagas de CRM concorrente e de operação comercial, CVM + detecção de tecnologia no DNS/site (etapa 6), casos de clientes da Salesforce Brasil, lead manual (indicação/ex-cliente/evento), junção de duplicados entre fontes, filtros próprios em cada aba | ✅ `npm test` passa (61 testes) |
| 15 | Do radar ao cliente (ver [[06-estrategia]]): página **Hoje** por oferta (Improve/Ágil/Keep) com motivo, cargo-alvo, contatos e rascunho; abordagem Contatei → Respondeu → Reunião; retornos pendentes; resultado por fonte; lista de co-venda; enriquecimento site → CNPJ → Receita (Minha Receita: CNAE, porte, diretoria e troca de diretoria); Workday/Workable/Ashby achados pelo site; alertas do LinkedIn por e-mail; Dor virou filtro; abas vazias somem | ✅ `npm test` passa (75 testes) |

Verificado em 12/11/2026 e **fora**: SmartRecruiters (robots.txt proíbe), AppExchange (busca e avaliações proibidas), Vagas.com (`/api/` proibido; termos não verificados), Programathor (sem vagas Salesforce), Sólides (sem API pública conhecida), PNCP (conexão recusada nesta rede). O HubSpot conectado é uma conta pessoal sem negócios, não o CRM da Sottelli.

## Modalidades do radar
| Tela | O que mostra | Fonte | Atualizar |
|---|---|---|---|
| `/radar/vagas` | Vagas Salesforce no Brasil, sem consultorias | Gupy e quadros | "Só vagas e dor" |
| `/radar/lideranca` | Troca de diretor/executivo | GDELT (notícias) | "Só liderança e gatilhos" |
| `/radar/gatilhos` | Fusão, investimento, expansão | GDELT (notícias) | "Só liderança e gatilhos" |
| `/radar/dor` | Migração de CRM, sistema legado, org com problemas, processo manual | Descrição das vagas | "Só vagas e dor" |

## Regras fixas (decididas pelo Gabriel)
- **Brasil + América Latina** (alterado em 12/11/2026; antes era só Brasil): o país vem de `src/normalize/location.ts` (estado brasileiro, nome de país, capitais e grandes cidades). Local não reconhecido fica de fora (evita EUA/Europa). Na nota, "Atua no Brasil / América Latina" vale 10 no Brasil e 6 em outro país da região. Notícias em português e espanhol.
- **Sem consultorias:** vaga com indício forte (se descreve como consultoria, parceira Salesforce, alocação, recrutadora) ou com nome de consultoria/outsourcing/recrutadora **não é gravada**; o que já estava no banco é limpo a cada coleta ou `npm run pontuar`. Indício fraco ("nossos clientes") fica marcado para revisão, com -30 na nota.

Primeira coleta real: 50 vagas → 26 contas → 4 excluídas. Abaixo da meta de 30 contas
visíveis — esperado, só a Gupy está ativa.

## Pendente
| Etapa | Entrega | Depende de |
|---|---|---|
| 5b | Vagas.com (se robots.txt e termos permitirem) | Verificar permissão |
| 6 | Detecção de tecnologia: DNS/crt.sh e HTML (Pardot, Web-to-Lead, chat, Experience Cloud, RD Station) | Nada |
| 7 | Enriquecimento por CNPJ/CNAE (Receita Federal) | Decidir se baixa a base aberta completa (alguns GB) ou usa consulta por CNPJ quando disponível |
| 8 | Notícias (Google News RSS/GDELT) + PNCP + CADE | Nada |
| 9 | Hipótese de necessidade e rascunho de abordagem via Claude API | Chave da Anthropic API |
| 10 | `radar run --daily` agendado (Agendador de Tarefas do Windows) + relatório da execução | Etapas 5–9 concluídas |

## Critério de pronto do MVP
Rodar o pipeline e ver no painel pelo menos **30 contas reais, ranqueadas**, cada uma
com nota explicada, evidências com link e um rascunho de abordagem (etapa 9).
