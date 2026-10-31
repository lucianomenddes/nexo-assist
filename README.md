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
pnpm dev
```

O comando `pnpm dev` inicia os três apps em modo de desenvolvimento via Turborepo:

| Serviço             | URL                   | Health                          |
| ------------------- | --------------------- | ------------------------------- |
| Next.js web         | http://localhost:3000 | `/api/health`                   |
| Mastra agent API    | http://localhost:4111 | `/health/live`, `/health/ready` |
| Ticket Service      | http://localhost:4112 | `/health/live`, `/health/ready` |
| PostgreSQL/pgvector | localhost:55432       | Docker health check             |

O readiness dos serviços Fastify verifica a conexão real com PostgreSQL. A chave OpenAI é opcional para inicializar os serviços; será necessária quando a geração de respostas for ligada ao endpoint de chat.

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
pnpm db:up                                # inicia PostgreSQL
pnpm db:migrate                           # aplica migrations em desenvolvimento
pnpm db:generate                          # gera Prisma Client
pnpm build                                # build dos apps e packages
pnpm check-types                          # verificação TypeScript
pnpm lint                                 # ESLint
pnpm test                                 # Vitest
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

## Mastra

O pacote `apps/nexo-assist-agent` é identificado como `nexo-assist-agent` e registra o agente `Nexo Assist` usando a API `Agent` de `@mastra/core`. O servidor HTTP é Fastify para manter consistência com a decisão de arquitetura; Mastra fornece a abstração do agente. O modelo usa o formato `provider/model` e a credencial OpenAI é fornecida via `OPENAI_API_KEY`.

## Qualidade

- ESLint usa a configuração compartilhada do monorepo.
- Prettier usa configuração na raiz.
- TypeScript herda configuração `strict`.
- Vitest executa testes unitários e testes HTTP com `fastify.inject()`, sem abrir portas.
- Os testes atuais validam schema de ambiente e health/readiness. Regras de chamados e fluxos de IA serão adicionados nas etapas seguintes.

## Arquitetura e requisitos

Consulte [SDD](./docs/SDD.md), [Arquitetura](./docs/ARCHITECTURE.md), [Modelo de dados](./docs/DATA_MODEL.md), [Desenho do agente](./docs/AI_AGENT_DESIGN.md), [RAG](./docs/RAG_DESIGN.md), [Contratos de API](./docs/API_CONTRACTS.md) e [Roadmap](./docs/IMPLEMENTATION_ROADMAP.md). O [PRD](./PRD.md) é a fonte de requisitos do produto.
