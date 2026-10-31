# nexo-assist-agent

Aplicação Mastra do Nexo Assist, com API HTTP Fastify para conversas autenticadas, recuperação de conhecimento, consultas de chamados e operações confirmadas pelo funcionário.

Execute o banco e os serviços a partir da raiz do monorepo:

```bash
pnpm db:up
pnpm db:migrate
pnpm exec turbo run dev --filter=nexo-assist-agent
```

O agente é registrado em `src/mastra/index.ts`; o `PostgresStore` inicializa o storage interno no schema `mastra_storage`, sem compartilhar tabelas de domínio Prisma. A API expõe `/health/live` e `/health/ready`, além de rotas autenticadas em `/conversations`; a porta padrão é `4111`.

As rotas privadas exigem JWT HS256 com issuer/audience configurados, claim `role: "employee"` e o UUID do funcionário em `sub`. O funcionário precisa estar ativo. O serviço de chamados recebe tokens internos emitidos pelo backend usando a mesma chave e identidade do funcionário. Operações de escrita e transferências são preparadas como drafts e só são executadas pelo endpoint de confirmação explícita.

Configure `OPENAI_API_KEY` e `OPENAI_MODEL` para classificação e composição de respostas. A recuperação busca chunks publicados com ranking híbrido lexical/vetorial; quando ainda não há embeddings, utiliza apenas o índice lexical. Embeddings existentes exigem `OPENAI_API_KEY`. Consulte a documentação principal para os contratos e decisões arquiteturais.
