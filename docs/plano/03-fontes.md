# Catálogo de Fontes

Cadastradas em `src/sources/types.ts` (`SOURCE_CATALOG`). Regra geral: **fontes só
crescem, nunca encolhem** — cada fonte nova é um módulo independente nessa lista.
Ver status atual com `node src/cli.ts fontes`.

## Vagas
| Fonte | Status | Observação |
|---|---|---|
| **Gupy** | ✅ Ativa | Busca pública do portal (`portal.gupy.io/job-search`); robots.txt libera tudo |
| Greenhouse | Planejada | API pública por empresa |
| Lever | Planejada | API pública por empresa |
| SmartRecruiters | Planejada | API pública por empresa |
| Workday | Planejada | Páginas de carreira; verificar robots.txt por empresa |
| Sólides / Inhire / Kenoby | Planejada | Verificar robots.txt |
| Programathor / GeekHunter / Trampos | Planejada | Verificar robots.txt |
| Vagas.com | Planejada | Só se robots.txt e termos permitirem |
| **Indeed** | ❌ Bloqueada | Termos de uso proíbem coleta automatizada |
| **LinkedIn** | ❌ Bloqueada | Termos de uso proíbem raspagem (restrição do próprio Gabriel) |

## Tecnologia (quem já tem Salesforce ou concorrente)
| Fonte | Status | Observação |
|---|---|---|
| DNS (SPF/TXT/CNAME) | Planejada | Detecta Pardot, Marketing Cloud, Salesforce sem acessar o site |
| Certificate Transparency (crt.sh) | Planejada | Subdomínios `go.`, `cloud.`, `click.` apontando para Marketing Cloud/Pardot |
| HTML do site | Planejada | Pardot, Web-to-Lead, chat do Service Cloud, Experience Cloud, RD Station (candidato a migração) |
| Cases de parceiros e da Salesforce | Planejada | Quem já tem Salesforce, Cloud e ano do projeto |

## Gatilhos
| Fonte | Status | Observação |
|---|---|---|
| PNCP (licitações) | Planejada | API aberta; intenção de compra explícita, com prazo e valor |
| CADE (atos de concentração) | Planejada | Dados abertos; fusões exigem integrar dois CRMs |
| Reclame Aqui | Planejada | Verificar termos; dor de atendimento = argumento para Service Cloud |
| Google News RSS / GDELT | Planejada | Expansão, fusão, nova diretoria |

## Cadastro (enriquecimento)
| Fonte | Status | Observação |
|---|---|---|
| Receita Federal (CNPJ/CNAE) | Planejada | Dados abertos; confirma setor e porte |

## Fontes descartadas (sem orçamento, ver [[05-pendencias]])
Econodata, Speedio, Neoway, BuiltWith, Wappalyzer API, SerpAPI, LinkedIn Sales
Navigator — todas pagas, fora do MVP por decisão do Gabriel.

## Conectores internos (fora do MVP por ora)
HubSpot, Gmail, Google Drive, Confluence/Jira — disponíveis no ambiente, mas não
usados como fonte por decisão do Gabriel. O Salesforce da Sottelli será autorizado
depois para cruzar contas com o CRM.
