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

Configure `GROQ_API_KEY` e, opcionalmente, `GROQ_MODEL` para classificação, tool calling, avaliação e composição de respostas. O modelo padrão é `groq/openai/gpt-oss-20b`; `groq/openai/gpt-oss-120b` também está disponível. `OPENAI_API_KEY` permanece necessário para embeddings RAG (`text-embedding-3-small`), mantendo a dimensão de vetores já usada pelo índice. O catálogo de modelos Groq verificado não disponibiliza modelo de embeddings, e os modelos GPT-OSS são modelos de geração, não de embeddings. O agente combina busca semântica Mastra `PgVector` (HNSW, schema `mastra_storage`) com busca lexical PostgreSQL e fusão Reciprocal Rank Fusion. O filtro SQL valida novamente que cada chunk pertence a documento publicado e compatível com categoria, tags e plataforma; artigos sem restrição de plataforma só são combinados com artigos específicos da plataforma pedida. Sem plataforma identificada, apenas artigos gerais são elegíveis.

## Ingestão de artigos

O pipeline aceita Markdown, TXT, HTML e PDF; extrai texto localmente, normaliza espaços/Unicode, divide o conteúdo com `MDocument` (Markdown preserva cabeçalhos), gera vetores de 1536 dimensões com `text-embedding-3-small` e persiste os chunks de domínio e vetores Mastra. Chamados, mensagens e anexos privados não são entradas aceitas pelo fluxo do agente. A ingestão é uma operação administrativa via CLI, não uma tool disponível ao LLM.

Crie um manifesto JSON com o arquivo e seus metadados. `file` é relativo a `knowledge-base/`; `source` é a chave estável do artigo. `status` começa como `draft` por padrão; use `published` somente para conteúdo aprovado:

```json
{
  "file": "example.md",
  "metadata": {
    "recordType": "knowledge_article",
    "source": "nexo://knowledge-base/example",
    "title": "Artigo exemplo",
    "category": "Acesso",
    "tags": ["acesso"],
    "platforms": [],
    "version": 1,
    "status": "published"
  }
}
```

```bash
pnpm --filter nexo-assist-agent rag:ingest -- ./evals/fixtures/vpn-error-809.json
pnpm --filter nexo-assist-agent rag:ingest -- ./evals/fixtures/service-desk-hours.json
```

`file` deve estar dentro de `knowledge-base/`, e `recordType: "knowledge_article"` é obrigatório; não há ingestão de tickets, mensagens ou anexos privados pelo agente. `(source, version)` é imutável quanto ao conteúdo. A mesma versão e o mesmo conteúdo são idempotentes; conteúdo repetido sob outra fonte é reportado como duplicado; conteúdo alterado exige uma versão superior. `reindex: true` no manifesto força novo chunking e embeddings da mesma versão. Use `reindex: true` para migrar documentos antigos que ainda só tenham o campo legado `KnowledgeChunk.embedding`. Publicar nova versão arquiva as versões anteriores dessa fonte. Se o processo falhar, artigos não publicados não entram na recuperação; uma nova execução pode completar a ingestão.

## Avaliação

O dataset versionado está em `evals/rag-evaluation.json`, com consultas, filtros, fontes esperadas, fatos e resposta de referência. Os fixtures são cópias dos exemplos de conhecimento especificados no PRD; ingira-os antes de avaliar. O comando mede Recall@K e MRR nos casos com fontes esperadas, correção de abstenção nos casos sem fonte e qualidade julgada por modelo (groundedness, relevância e cobertura):

```bash
pnpm --filter nexo-assist-agent rag:evaluate
```

As métricas não têm thresholds de aprovação pré-configurados; estabeleça o baseline com o corpus aprovado antes de liberar alterações de chunking, ranking ou prompt.
