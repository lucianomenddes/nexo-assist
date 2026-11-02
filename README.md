# Nexo Assist

Monorepo inicial do agente de Service Desk Nexo Assist. A aplicação Mastra tem o nome `nexo-assist-agent`; as APIs do agente e do serviço de chamados usam Fastify. O banco local é PostgreSQL com pgvector.

## Requisitos

- Node.js 24 ou superior
- pnpm 11.25.0
- Docker e Docker Compose

## Preparação local

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

O comando `pnpm dev` inicia os três apps em modo de desenvolvimento via Turborepo:

| Serviço             | URL                   | Health                                                         |
| ------------------- | --------------------- | -------------------------------------------------------------- |
| Next.js web         | http://localhost:3000 | `/api/health`                                                  |
| Mastra agent API    | http://localhost:4111 | `/health/live`, `/health/ready`                                |
| Ticket Service      | http://localhost:4112 | `/health`, `/health/live`, `/health/ready`; Swagger em `/docs` |
| PostgreSQL/pgvector | localhost:55432       | Docker health check                                            |

O readiness dos serviços Fastify verifica a conexão real com PostgreSQL. A chave OpenAI é opcional para inicializar os serviços, mas necessária para classificar mensagens, recuperar semanticamente a base e compor respostas.

`DATABASE_URL` usa o papel de runtime sem superusuário; `DIRECT_URL` é reservado às migrations. As migrations ativam RLS nas tabelas de domínio e criam o schema `mastra_storage` separado do schema `public` gerenciado pelo Prisma. `NEXO_APP_PASSWORD` provisiona o papel local do Compose; em produção, configure credenciais distintas em um secret manager e use uma conexão privilegiada separada para migrations. As credenciais do `.env.example` são somente para desenvolvimento local.

Para encerrar os processos, use `Ctrl+C`; para parar o banco sem apagar os dados:

```bash
pnpm db:down
```

O volume `postgres_data` é persistente. O script `packages/database/docker/init.sql` habilita a extensão pgvector no primeiro provisionamento do volume; as migrations Prisma também garantem a extensão.

## Comandos úteis

```bash
pnpm dev                                  # inicia todos os apps do workspace
pnpm exec turbo run dev --filter=web
pnpm exec turbo run dev --filter=nexo-assist-agent
pnpm exec turbo run dev --filter=@nexo-assist/ticket-service
pnpm --filter nexo-assist-agent rag:ingest -- ./evals/fixtures/vpn-error-809.json
pnpm --filter nexo-assist-agent rag:evaluate
pnpm db:up                                # inicia PostgreSQL
pnpm db:migrate                           # aplica migrations em desenvolvimento
pnpm db:seed                              # insere exemplos idempotentes
pnpm db:generate                          # gera Prisma Client
pnpm build                                # build dos apps e packages
pnpm check-types                          # verificação TypeScript
pnpm lint                                 # ESLint
pnpm test                                 # Vitest
pnpm test:e2e                             # fluxos HTTP E2E do Ticket Service
pnpm test:coverage                        # suíte unitária com relatórios text/html/json-summary
pnpm test:integration                     # testes reais; requer PostgreSQL e migrations
pnpm format:check                         # verifica formatação Prettier
```

## Estrutura

```text
apps/
  web/                 Next.js e endpoint de health
  nexo-assist-agent/   agente Mastra e API Fastify
  ticket-service/      serviço Fastify independente
packages/
  config/              validação Zod de ambiente
  contracts/           schemas Zod compartilhados
  database/            Prisma Client, schema e migrations
  domain/              tipos e conceitos de domínio
  shared/              utilitários compartilhados
  eslint-config/       configuração compartilhada de ESLint
  typescript-config/   bases TypeScript strict
```

`pnpm-workspace.yaml` inclui explicitamente os três apps executáveis e os pacotes internos. O antigo app `apps/docs` do starter não faz parte do workspace ativo.

## Configuração

`.env.example` lista as variáveis para desenvolvimento. Copie-o para `.env`; valores de banco incluídos são somente credenciais locais de desenvolvimento. Nunca use esses valores em produção nem versiona `.env`.

Variáveis são validadas no início dos serviços por `@nexo-assist/config`, com Zod. Falha de validação interrompe o startup e informa as variáveis inválidas.

## Ticket Service

O serviço Fastify oferece `GET /employees/me`, `GET /tickets`, `GET /tickets/search`,
`GET /tickets/:id`, `POST /tickets`, `PATCH /tickets/:id` e
`POST /tickets/:id/reopen`. A especificação OpenAPI e a interface Swagger ficam
disponíveis em `http://localhost:4112/docs`.

As rotas de negócio exigem um JWT assinado com HS256 e validado por issuer e
audience configurados em `AUTH_JWT_ISSUER` e `AUTH_JWT_AUDIENCE`. Um token de
funcionário usa o UUID do registro de funcionário em `sub` e `role: "employee"`.
Tokens de serviço usam `role: "service"` e `employeeId` para representar o
funcionário atendido; em ambos os casos o token deve ser emitido por um emissor
confiável. O cliente nunca escolhe a identidade proprietária do chamado no body
ou query. O exemplo local não inclui endpoint de emissão de tokens: a integração
deve receber tokens do provedor de identidade/serviço confiável.

Todas as escritas exigem `Idempotency-Key`. Atualizações também exigem
`expectedVersion` no body para evitar sobrescrita concorrente. Escritas aceitam
somente JWT `role: "service"` emitido para o backend confiável; o workflow do
agente deve obter confirmação explícita antes de enviar a operação. JWTs de
funcionário são somente leitura. A prioridade
crítica usa uma hora corrida; as prioridades alta, média e baixa usam horas
úteis de segunda a sexta, das 09:00 às 17:00 UTC. Esse calendário é uma
assunção provisória de implementação: feriados e timezone operacional não estão
definidos pelo PRD e devem ser confirmados antes do uso com SLA de produção.

## Mastra

O pacote `apps/nexo-assist-agent` é identificado como `nexo-assist-agent` e registra o agente `Nexo Assist` usando a API `Agent` de `@mastra/core`. O storage PostgreSQL do Mastra usa o schema `mastra_storage`; tabelas de domínio Prisma permanecem no schema `public`. O servidor HTTP é Fastify para manter consistência com a decisão de arquitetura; Mastra fornece a abstração do agente. A geração usa Groq via `GROQ_API_KEY` e `GROQ_MODEL` (padrão `groq/openai/gpt-oss-20b`); `OPENAI_API_KEY` permanece configurada para embeddings, pois os modelos GPT-OSS não fornecem vetores de embedding e o catálogo Groq atual não lista um modelo de embedding.

O console de analistas está em `apps/web/app/analyst` e consome o workflow de handoff no agente. O backend valida estados e autoria; a atribuição usa compare-and-set e RLS de escopo analista. Consulte o [README do agente](./apps/nexo-assist-agent/README.md) para as rotas e configuração da origem web.

A recuperação RAG combina `PgVector`/pgvector com busca lexical, usando somente artigos publicados e respeitando filtros de plataforma e metadados. Artigos TXT, Markdown, HTML e PDF são ingeridos pelo CLI administrativo; consulte [README do agente](./apps/nexo-assist-agent/README.md) e [desenho RAG](./docs/RAG_DESIGN.md) para manifestos e avaliação.

## Qualidade

- ESLint usa a configuração compartilhada do monorepo.
- Prettier usa configuração na raiz.
- TypeScript herda configuração `strict`.
- Vitest executa testes unitários e testes HTTP com `fastify.inject()`, sem abrir portas.
- `pnpm test:e2e` verifica contratos HTTP do Ticket Service, autorização, identidade autenticada, escritas confirmadas, validação e idempotência.
- `pnpm test:coverage` gera relatório V8 no terminal, `coverage/index.html` e `coverage/coverage-summary.json`; cobertura mede execução de código, não substitui asserts comportamentais.
- `apps/nexo-assist-agent/evals/agent-behavior.json` contém casos de intenção, confirmação, propriedade de dados, handoff, escopo, evidência RAG e indisponibilidade. `agent-evaluation.test.ts` pontua resultados previstos de forma determinística, sem inferência do LLM.
- `pnpm test:integration` usa PostgreSQL real para validar RLS, chaves estrangeiras compostas, idempotência e restrições de handoff. A URL de runtime de teste precisa usar o papel `nexo_app`, sem privilégios `SUPERUSER` ou `BYPASSRLS`.

## Arquitetura e requisitos

Consulte [SDD](./docs/SDD.md), [Arquitetura](./docs/ARCHITECTURE.md), [Modelo de dados](./docs/DATA_MODEL.md), [Desenho do agente](./docs/AI_AGENT_DESIGN.md), [RAG](./docs/RAG_DESIGN.md), [Contratos de API](./docs/API_CONTRACTS.md) e [Roadmap](./docs/IMPLEMENTATION_ROADMAP.md). O [PRD](./PRD.md) é a fonte de requisitos do produto.
