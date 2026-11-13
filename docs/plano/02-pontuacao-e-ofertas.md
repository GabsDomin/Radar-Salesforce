# Pontuação (0–100) e Ofertas Sugeridas

Implementado em `src/scoring/score.ts`. Determinística (sem IA) e explicada: cada
ponto tem uma regra, um motivo em texto e os `signalIds` que o comprovam.

## Aderência ao perfil ideal (ICP) — até 40 pontos
| Regra | Pontos | Detalhe |
|---|---|---|
| Setor-alvo (indústria, financeiro ou agro) | 15 | 8 se **inferido** pela vaga, 15 se confirmado pelo CNAE (etapa 7, ainda não implementada) |
| Porte 100+ funcionários | 15 | 7 se inferido, 15 se confirmado |
| Atua no Brasil | 10 | Baseado no país das vagas coletadas |

## Força do sinal — até 60 pontos
| Regra | Pontos | Detalhe |
|---|---|---|
| Vaga Salesforce aberta (v1.4) | até 40 | **Quanto mais tempo aberta, mais pontos** (dificuldade de contratar → alocação). Vaga técnica aberta: 10 + bônus por tempo (15+ dias: +7, 30+: +14, 45+: +20, 60+: +25); **+5** se houver 2+ vagas técnicas ou vaga sênior/arquitetura. Vaga de outra área que só cita Salesforce: 8 fixos. Vaga que sumiu da fonte (21+ dias sem aparecer), banco de talentos ou aberta há mais de 180 dias: 3 |
| Tecnologia Salesforce | até 20 | 20 se confirmada no site/DNS (etapa 6), 10 se só citada em vaga |
| Momento da empresa (gatilho em 90 dias) | 15 | Notícia de expansão, fusão, nova diretoria (etapa 8) |

## Ajuste
| Regra | Pontos | Quando se aplica |
|---|---|---|
| Possível consultoria/recrutadora | **−30** | Todas as vagas da conta indicam contratação para atender clientes (ex.: "nossos clientes", "consultoria especializada") — sinalizado para revisão humana, não exclui automaticamente |

Nota final = aderência + sinal + ajuste, limitada a [0, 100].

## Janelas de tempo (`src/config.ts`)
- `freshDays = 30` — vaga "fresca"
- `activeDays = 90` — vaga ainda considerada ativa
- `hardToFillDays = 45` — vaga aberta há mais tempo que isso = dificuldade de contratar (indica Improve)
- `stillOpenDays = 21` — vaga vista na fonte nos últimos 21 dias = ainda aberta
- `maxRealOpenDays = 180` — acima disso é vaga "permanente", não contratação de verdade
- `OPEN_AGE_BONUS` — bônus por tempo de vaga aberta; `TECH_ROLES` — cargos que ganham o bônus

## Mapeamento para as ofertas da Sottelli
Cada conta pode receber mais de uma sugestão, ordenadas pela quantidade de evidências.

| Oferta | Sinais que a sugerem |
|---|---|
| **Improve** | Vaga de Developer/Admin/Funcional/QA aberta há mais de 45 dias (dificuldade de contratar) ou vaga recente do mesmo tipo (precisa de capacidade já) |
| **Ágil** | Vaga de Arquiteto ou Tech Lead; descrição cita implantação, migração, novo projeto ou integrações |
| **Keep** | Descrição cita sustentação, suporte N2/N3 ou melhoria contínua; ou a vaga é de "usuário de CRM" (usa Salesforce no dia a dia sem contratar time técnico) |

## Setor por palavra-chave: cuidado conhecido
A classificação de setor a partir do texto da vaga (`classifyJob`, `src/classify/job.ts`)
usa regras **restritas de propósito**: termos genéricos como "crédito", "previdência"
e "seguro" aparecem na lista de **benefícios** (vale, previdência privada, plano de
saúde) de quase qualquer vaga brasileira, e "banco" também significa "banco de dados"
ou "banco de talentos". Por isso o setor financeiro só é marcado com frases fortes e
específicas ("mercado financeiro", "fintech", nome de banco como "Porto Bank",
"cooperativa de crédito"). Esse ajuste foi feito depois de um bug real encontrado na
primeira coleta (quase tudo saía como "financeiro"); os casos ficaram registrados como
testes de regressão em `test/classify.test.ts`.
