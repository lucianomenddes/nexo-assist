# nexo-assist-agent

Aplicação Mastra do Nexo Assist, com API HTTP Fastify para conversas autenticadas, recuperação de conhecimento, consultas de chamados e operações confirmadas pelo funcionário.

Execute o banco e os serviços a partir da raiz do monorepo:

```bash
pnpm db:up
pnpm db:migrate
pnpm exec turbo run dev --filter=nexo-assist-agent
```

O agente é registrado em `src/mastra/index.ts`; o `PostgresStore` inicializa o storage interno no schema `mastra_storage`, sem compartilhar tabelas de domínio Prisma. A API expõe `/health/live` e `/health/ready`, além de rotas autenticadas em `/conversations`; a porta padrão é `4111`.

`pnpm dev` na raiz do monorepo inicia os apps e o Mastra Studio em `http://localhost:4113`; a documentação Swagger do Ticket Service fica em `http://localhost:4112/docs`. Para iniciar somente o Studio, use `pnpm studio:agent` na raiz. A porta separada evita conflito com a API Fastify do agente em `4111`.

As rotas privadas exigem JWT HS256 com issuer/audience configurados, claim `role: "employee"` e o UUID do funcionário em `sub`. O funcionário precisa estar ativo. O serviço de chamados recebe tokens internos emitidos pelo backend usando a mesma chave e identidade do funcionário. Operações de escrita e transferências são preparadas como drafts e só são executadas pelo endpoint de confirmação explícita.

Configure `GROQ_API_KEY` e, opcionalmente, `GROQ_MODEL` para classificação e composição de respostas. O modelo padrão é `groq/openai/gpt-oss-20b`; `groq/openai/gpt-oss-120b` também está disponível. `OPENAI_API_KEY` é necessário para embeddings RAG (`text-embedding-3-small`), mantendo a dimensão de vetores já usada pelo índice. O catálogo de modelos Groq verificado não disponibiliza modelo de embeddings, e os modelos GPT-OSS são modelos de geração, não de embeddings. O agente combina busca semântica Mastra `PgVector` (HNSW, schema `mastra_storage`) com busca lexical PostgreSQL e fusão Reciprocal Rank Fusion. O filtro SQL valida novamente que cada chunk pertence a documento publicado e compatível com categoria, tags e plataforma; artigos sem restrição de plataforma só são combinados com artigos específicos da plataforma pedida. Sem plataforma identificada, apenas artigos gerais são elegíveis.

## Preparação, configuração e execução

Requisitos: Node.js 24+, pnpm 11.25.0, Docker e Docker Compose. Na raiz do monorepo:

```bash
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm exec turbo run dev --filter=nexo-assist-agent
```

O arquivo `.env.example` deste diretório lista somente as configurações usadas pelo agente. O exemplo na raiz também contém as variáveis do web e do Ticket Service. `GROQ_API_KEY` e `OPENAI_API_KEY` podem ficar vazias para inicializar o serviço sem chamar esses provedores; geração/classificação requer Groq, e consultas/ingestão RAG requerem OpenAI. A validação de ambiente trata string vazia como variável opcional não configurada. O segredo JWT de exemplo é exclusivamente local; substitua-o por um segredo forte gerenciado externamente antes de qualquer ambiente compartilhado.

| Variável                               | Obrigatória para               | Observação                                                                    |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Inicialização do serviço       | Papel de runtime `nexo_app`; schema de domínio `public`.                      |
| `DIRECT_URL`                           | Migrations                     | Conexão de administração; não use nas requisições da aplicação.               |
| `AUTH_JWT_SECRET`                      | Autenticação                   | Mínimo de 32 caracteres; use segredo aleatório fora do desenvolvimento local. |
| `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE` | Autenticação                   | Devem corresponder aos claims dos tokens emitidos pelo backend confiável.     |
| `GROQ_API_KEY`                         | Classificação e respostas      | Opcional no startup, obrigatória ao processar mensagens.                      |
| `GROQ_MODEL`                           | Classificação e respostas      | Padrão `groq/openai/gpt-oss-20b`.                                             |
| `OPENAI_API_KEY`                       | Ingestão e busca semântica RAG | Opcional no startup, necessária para gerar embeddings.                        |
| `TICKET_SERVICE_URL`                   | Operações de chamados          | Padrão `http://localhost:4112`; timeout de chamada atualmente fixo em 5 s.    |
| `WEB_ORIGIN`                           | CORS do console                | Uma origem exata, sem curingas; padrão `http://localhost:3000`.               |
| `AGENT_PORT`                           | Servidor HTTP                  | Padrão `4111`.                                                                |

Comandos de validação do pacote:

```bash
pnpm --filter nexo-assist-agent test
pnpm --filter nexo-assist-agent check-types
pnpm --filter nexo-assist-agent lint
pnpm --filter nexo-assist-agent build
```

O Compose na raiz provisiona somente PostgreSQL/pgvector para desenvolvimento; não há imagem Docker de produção para o agente neste repositório. Use a execução Node/pnpm acima. Para verificar o banco, use `pnpm db:up`; readiness do agente verifica a conectividade PostgreSQL.

## API do funcionário

As rotas privadas aceitam JWT HS256 validado por issuer e audience. Os tokens de funcionário precisam de `role: "employee"`, `sub` UUID e registro ativo. A autenticação não oferece endpoint de login ou emissão de token neste pacote: a integração deve receber tokens de um emissor confiável.

| Método e rota                                                        | Uso                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /health/live`, `GET /health/ready`                              | Liveness e readiness.                                        |
| `POST /api/v1/conversations`                                         | Criar conversa para o funcionário autenticado.               |
| `GET /api/v1/conversations`                                          | Listar conversas próprias.                                   |
| `GET /api/v1/conversations/:conversationId/messages`                 | Ler mensagens próprias.                                      |
| `POST /api/v1/conversations/:conversationId/messages`                | Enviar mensagem; requer `Idempotency-Key`.                   |
| `POST /api/v1/conversations/:conversationId/drafts/:draftId/confirm` | Confirmar operação com body `{ "confirmation": "confirm" }`. |
| `GET /api/v1/conversations/:conversationId/executions`               | Listar execuções e métricas redigidas.                       |
| `GET /api/v1/conversations/:conversationId/executions/:traceId`      | Obter execução e eventos de auditoria redigidos.             |

Escritas de chamados e transferências são primeiro persistidas como rascunhos e exigem confirmação explícita. Idempotência permite repetir com segurança o mesmo envio; uma chave reutilizada com conteúdo diferente é conflito.

## Console e workflow do analista

O console web fica em `/analyst` e chama a API autenticada `/api/v1/analyst/handoffs`. Forneça um JWT com `role: "analyst"` e `sub` igual ao UUID de um analista ativo, assinado com `AUTH_JWT_SECRET` e os valores configurados de issuer/audience. O token é mantido somente na memória da página. Configure `WEB_ORIGIN` com a origem exata do console; o CORS não aceita origens curingas.

O fluxo grava resumo factual construído com as mensagens recentes, motivo e eventos auditáveis. Estados suportados: `waiting_analyst`, `analyst_assigned`, `agent_resumed`, `resolved` e `closed`. O analista pode assumir atomicamente, enviar mensagens, retomar o agente, resolver ou encerrar. Handoffs solicitados pelo funcionário, motivados por baixa confiança, chamados críticos ou chamados vencidos passam pelo rascunho e confirmação explícita antes da persistência; enquanto aguardam ou estão atribuídos, o agente não gera respostas automáticas.

Rotas do console:

- `GET /api/v1/analyst/handoffs` e `GET /api/v1/analyst/handoffs/:handoffId`
- `POST /api/v1/analyst/handoffs/:handoffId/assign` com `{ "reason": "..." }`
- `POST /api/v1/analyst/handoffs/:handoffId/messages` com `{ "content": "..." }`
- `POST /api/v1/analyst/handoffs/:handoffId/resume|resolve|close` com `{ "reason": "..." }`

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

## Arquitetura, trade-offs e limitações

O [documento de arquitetura](./docs/ARCHITECTURE.md) descreve os componentes reais, fluxos, persistência, trade-offs e limites operacionais. A [validação atual](./docs/VALIDATION.md) registra comandos e resultados verificados.

Trade-offs explícitos:

- Classificação e redação são duas gerações separadas para manter o roteamento de operações determinístico e validável; isso acrescenta latência e custo por turno.
- RAG usa embedding + busca lexical e RRF para combinar semântica e correspondência exata. A dimensão e o provedor de embeddings são acoplados ao índice atual; mudar modelo exige reindexação controlada.
- Dados de domínio Prisma e armazenamento interno Mastra usam o mesmo PostgreSQL, mas schemas e proprietários diferentes; isso simplifica operação, porém compartilha capacidade e falhas do banco.
- Escritas no Ticket Service ficam fora da transação do banco de conversas. Chaves idempotentes e drafts mitigam repetição, mas não fornecem transação distribuída.
- O handler HTTP retorna o resultado da geração em uma resposta JSON; não há streaming de tokens.

Limitações conhecidas:

- O Compose é para desenvolvimento local e não inclui imagem/container de aplicação, proxy TLS, alta disponibilidade ou rotação de segredos.
- A aplicação depende dos provedores externos configurados, sem fallback automático de modelo ou embeddings.
- A avaliação RAG requer banco, corpus indexado e chamadas a modelo julgador; seus thresholds ainda precisam ser definidos a partir de um baseline aprovado.
- Timeout do Ticket Service é fixo em 5 segundos; políticas de retry/circuit breaker e rate limiting do agente não estão configuradas neste pacote.
- A execução do processo de ingestão atualiza PostgreSQL de domínio e pgvector em operações distintas; o filtro de publicação do domínio protege a recuperação, mas uma falha parcial pode exigir reexecutar a ingestão/reindexação.
