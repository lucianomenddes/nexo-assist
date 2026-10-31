#  Prompts de desenvolvimento

Os prompts abaixo devem ser executados individualmente, respeitando a sequência de implementação.

## Prompt 01 — Software Architect e SDD

```text
Atue como Principal Software Architect e Senior AI Engineer,
especializado em TypeScript, Mastra, RAG e sistemas de produção.

Desenvolva a arquitetura técnica do projeto Nexo Assist.

NOME DO PROJETO MASTRA:
nexo-assist-agent

CONTEXTO:
O Nexo Assist é um agente de Service Desk de TI que permite
consultar conhecimento, abrir e atualizar chamados e transferir
atendimentos para analistas.

STACK:
- TypeScript strict
- Mastra
- Next.js
- PostgreSQL
- pgvector
- Prisma
- Zod
- OpenAI
- Docker Compose
- pnpm + Turborepo

OBJETIVOS:
1. Elaborar SDD.
2. Definir arquitetura modular.
3. Definir entidades e relacionamentos.
4. Definir contratos entre serviços.
5. Definir agente, tools e workflows.
6. Definir arquitetura RAG.
7. Definir memória e persistência.
8. Definir segurança e autorização.
9. Definir observabilidade.
10. Definir estratégia de testes.

REGRAS:
- Seguir o PRD como fonte de requisitos.
- Separar requisitos de decisões arquiteturais.
- Não utilizar multiagentes sem justificativa.
- Não delegar regras de negócio exclusivamente ao LLM.
- Garantir confirmação antes de operações de escrita.
- Garantir isolamento dos dados por funcionário.

ENTREGÁVEIS:
docs/SDD.md
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/AI_AGENT_DESIGN.md
docs/RAG_DESIGN.md
docs/API_CONTRACTS.md
docs/IMPLEMENTATION_ROADMAP.md

Não implemente código nesta etapa.
Documente diagramas utilizando Mermaid.
Revise inconsistências antes de finalizar.
```

## Prompt 02 — Bootstrap do monorepo

```text
Atue como Senior Backend Engineer.

Implemente a estrutura inicial do monorepo Nexo Assist.

PROJETO MASTRA:
nexo-assist-agent

ESTRUTURA:
apps/web
apps/nexo-assist-agent
apps/ticket-service

packages/database
packages/contracts
packages/domain
packages/config
packages/shared

REQUISITOS:
1. Configurar pnpm workspaces.
2. Configurar Turborepo.
3. Configurar TypeScript strict.
4. Configurar ESLint e Prettier.
5. Configurar Docker Compose.
6. Configurar PostgreSQL com pgvector.
7. Criar .env.example.
8. Implementar validação de variáveis com Zod.
9. Criar health checks.
10. Configurar Vitest.

O projeto Mastra deve possuir seu próprio package.json
com nome nexo-assist-agent.

Consultar a documentação atual do Mastra antes de
configurar suas APIs e dependências.

Todos os serviços devem iniciar localmente.
Documentar os comandos no README.
```

## Prompt 03 — Database e persistência

```text
Atue como Senior Database Architect e Backend Engineer.

Implemente a persistência do Nexo Assist utilizando
PostgreSQL e Prisma.

ENTIDADES:
Employee
Conversation
Message
Ticket
TicketHistory
KnowledgeDocument
KnowledgeChunk
AgentExecution
AgentAudit
Handoff

REQUISITOS:
- Criar migrations.
- Criar relacionamentos.
- Criar índices.
- Garantir integridade referencial.
- Implementar isolamento por funcionário.
- Implementar estados de conversa.
- Implementar histórico de ações.
- Garantir idempotência.
- Criar seeds de exemplo.
- Criar testes de integração.

Separar as tabelas de domínio das estruturas internas
utilizadas pelo Mastra Storage.

Não implementar regras de negócio nos controllers.
```

## Prompt 04 — Ticket Service

```text
Atue como Senior Backend Engineer.

Implemente o serviço independente de chamados do Nexo Assist.

TECNOLOGIAS:
Fastify
TypeScript
Zod
Prisma
PostgreSQL
Swegger 

ENDPOINTS:
GET /health
GET /employees/me
GET /tickets
GET /tickets/:id
GET /tickets/search
POST /tickets
PATCH /tickets/:id
POST /tickets/:id/reopen

IMPLEMENTAR:
- Tipos INC e REQ.
- Categorias do PRD.
- Prioridades.
- Validação de campos obrigatórios.
- Ownership.
- Detecção de duplicidade.
- Atualização de chamados.
- Reabertura em até sete dias.
- Histórico.
- Cálculo de SLA.
- Idempotência.

Não importar Mastra neste serviço.

Não confiar em employeeId enviado livremente pelo frontend.
Utilizar identidade autenticada e autorização no backend.

Criar testes unitários e de integração.
```

## Prompt 05 — Nexo Assistant Agent

```text
Atue como Senior AI Engineer especialista em Mastra.

Implemente o agente principal do projeto:

nexo-assist-agent

AGENTE:
Nexo Assistant Agent

OBJETIVO:
Interpretar mensagens dos funcionários e selecionar
a ferramenta ou workflow adequado.

INTENÇÕES:
KNOWLEDGE_QUERY
TICKET_CREATE
TICKET_UPDATE
TICKET_STATUS
TICKET_REOPEN
HUMAN_HANDOFF
OUT_OF_SCOPE

IMPLEMENTAR:
1. Configuração do Mastra.
2. Agente principal.
3. System instructions.
4. Tools com Zod.
5. Integração com Ticket Service.
6. Integração com RAG.
7. Memória por conversa.
8. Workflows determinísticos.
9. Persistência.
10. Observabilidade.

REGRAS:
- Não executar operações de escrita sem confirmação.
- Não inventar informações.
- Não consultar chamados de terceiros.
- Perguntar quando faltar informação.
- Respeitar o estado da conversa.
- Não responder enquanto o analista estiver atendendo.
- Encaminhar casos de baixa confiança.

Retornar informações estruturadas:
intent, selectedTool, executionStatus, confidence,
reason e traceId.

Respostas em português brasileiro.

Consultar a documentação oficial do Mastra da versão
instalada antes de implementar.
```

## Prompt 06 — RAG Pipeline

```text
Atue como AI Engineer especializado em RAG.

Implemente a infraestrutura de RAG do nexo-assist-agent.

STACK:
- Mastra RAG
- @mastra/pg
- PostgreSQL + pgvector
- OpenAI text-embedding-3-small
- TypeScript
- Zod

IMPLEMENTAR:
1. Document ingestion.
2. Extração de documentos.
3. Normalização.
4. Chunking.
5. Embeddings.
6. Persistência vetorial.
7. Metadados.
8. Versionamento.
9. Busca semântica.
10. Filtros.
11. Recuperação de fontes.
12. Integração com o agente.

METADADOS:
documentId
title
category
tags
platform
version
status
source
updatedAt

REGRAS:
- Não indexar chamados privados.
- Não recuperar documentos desativados.
- Respeitar restrições de plataforma.
- Evitar duplicação de documentos.
- Permitir reindexação.
- Retornar fontes utilizadas.
- Não inventar procedimentos.

Criar dataset de avaliação com Recall@K, MRR
e qualidade das respostas.

O pipeline deve permitir adicionar novos artigos
sem alterar o código do agente.
```

## Prompt 07 — Human Handoff

```text
Atue como Senior Software Engineer especializado
em sistemas de atendimento.

Implemente o workflow handoff-to-analyst
no projeto nexo-assist-agent.

REQUISITOS:
- Transferência solicitada pelo funcionário.
- Transferência por criticidade.
- Transferência por baixa confiança.
- Transferência por chamado vencido.
- Geração de resumo.
- Persistência.
- Pausa do agente.
- Console do analista.
- Atribuição de analista.
- Retomada do agente.
- Encerramento.

ESTADOS:
waiting_analyst
analyst_assigned
agent_resumed
resolved
closed

Não permitir dois analistas assumirem simultaneamente
a mesma conversa.

Validar transições no backend.

Registrar autoria, horário e motivo das operações.

Criar testes de concorrência e transições inválidas.
```

## Prompt 08 — Observabilidade e auditoria

```text
Atue como AI Engineer especializado em LLM Observability.

Implemente rastreabilidade completa das execuções
do nexo-assist-agent.

REGISTRAR:
- Mensagem recebida.
- Intenção.
- Ferramentas utilizadas.
- Parâmetros relevantes.
- Documentos recuperados.
- Resultados.
- Confiança.
- Justificativa operacional.
- Tempo de execução.
- Tokens.
- Erros.
- Transferências.

IMPLEMENTAR:
- TraceId.
- AgentExecution.
- AgentAudit.
- Spans por ferramenta.
- Integração com observabilidade Mastra.
- API de consulta.
- Visualização no frontend.
- Redação de dados sensíveis.

Não expor raciocínio interno privado do modelo.

A transparência deverá ser baseada nas ações,
evidências, resultados e justificativas operacionais.
```

## Prompt 09 — QA e Evaluation

```text
Atue como QA Engineer e AI Evaluation Engineer.

Implemente os testes do Nexo Assist.

COBRIR:
- Regras de negócio.
- Ticket Service.
- Tools Mastra.
- Workflows.
- RAG.
- Autorização.
- Isolamento.
- Persistência.
- Handoff.
- Indisponibilidade do serviço.
- Testes E2E.

Criar cenários para todas as regras do PRD.

Implementar testes determinísticos para o domínio
e datasets para avaliação do comportamento do agente.

Gerar relatório de cobertura.

Não considerar apenas a execução bem-sucedida
do LLM como evidência de qualidade.
```

## Prompt 10 — Revisão final

```text
Atue como Principal Engineer.

Realize uma revisão completa do projeto Nexo Assist.

PROJETO MASTRA:
nexo-assist-agent

AVALIE:
- Arquitetura.
- TypeScript.
- Mastra.
- RAG.
- Tools.
- Workflows.
- Segurança.
- Persistência.
- Observabilidade.
- Performance.
- Testes.
- Docker.
- Documentação.

IDENTIFIQUE:
- Bugs.
- Falhas de segurança.
- Violações de regras.
- Problemas de concorrência.
- Falhas de persistência.
- Dependências desnecessárias.
- Problemas de custo.
- Problemas de latência.

Corrija os problemas incrementalmente.
Execute os testes após cada alteração.

Entregar:
README completo.
.env.example.
Documentação de arquitetura.
Diagramas Mermaid.
Instruções de execução.
Trade-offs técnicos.
Limitações conhecidas.
Relatório de validação.
```