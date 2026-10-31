# nexo-assist-agent

Aplicação Mastra do Nexo Assist, com API HTTP Fastify para health checks e integração futura com o chat.

Execute o banco e os serviços a partir da raiz do monorepo:

```bash
pnpm db:up
pnpm db:migrate
pnpm exec turbo run dev --filter=nexo-assist-agent
```

O agente é registrado em `src/mastra/index.ts`; o `PostgresStore` inicializa o storage interno no schema `mastra_storage`, sem compartilhar tabelas de domínio Prisma. O servidor Fastify expõe `/health/live` e `/health/ready` na porta `4111` por padrão. O modelo usa o formato `provider/model` e lê a chave OpenAI de `OPENAI_API_KEY`.
