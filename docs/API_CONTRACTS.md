# Contratos de API — Nexo Assist

**Status:** contratos propostos para implementação.  
**Fonte de requisitos:** [PRD](../PRD.md) · [Agente](./AI_AGENT_DESIGN.md) · [Modelo de dados](./DATA_MODEL.md)

## 1. Convenções

- Prefixos: AI Backend `/api/v1`; Ticket Service independente nas rotas raiz documentadas.
- JSON UTF-8; datas ISO 8601 UTC; IDs opacos.
- Schemas de entrada/saída compartilhados em `packages/contracts` e validados com Zod em cada fronteira.
- Identidade (`subjectId`, `role`) vem da sessão autenticada ou credencial serviço-serviço; não do corpo da requisição.
- Ticket Service retorna erros como `{ "error": "CODE", "message": "..." }`; validação também inclui `issues`.
- Escritas recebem `Idempotency-Key`; reutilizar chave com corpo diferente retorna conflito.
- Contratos não expõem tabelas Prisma nem dados secretos de execução.

## 2. AI Backend — funcionário

| Método e rota                                                          | Uso                                                      | Autorização                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `GET /health`                                                          | Saúde do processo e dependências essenciais, sem segredo | Público/local conforme deploy                 |
| `POST /api/v1/auth/demo/login`                                         | Login de funcionário/analista seed no protótipo          | Somente modo demo                             |
| `GET /api/v1/auth/session`                                             | Consultar identidade e papel da sessão atual             | Sessão autenticada                            |
| `POST /api/v1/auth/logout`                                             | Encerrar a sessão atual                                  | Sessão autenticada                            |
| `POST /api/v1/conversations`                                           | Criar conversa própria                                   | Funcionário                                   |
| `GET /api/v1/conversations`                                            | Listar conversas próprias                                | Funcionário                                   |
| `GET /api/v1/conversations/{conversationId}`                           | Estado/resumo da conversa                                | Dono ou analista autorizado                   |
| `GET /api/v1/conversations/{conversationId}/messages`                  | Histórico paginado                                       | Dono ou analista atribuído/console autorizado |
| `POST /api/v1/conversations/{conversationId}/messages`                 | Enviar mensagem e receber SSE                            | Dono; conversa `active`; abaixo do limite     |
| `GET /api/v1/conversations/{conversationId}/executions`                | Ver ações e fontes                                       | Dono ou analista autorizado                   |
| `POST /api/v1/conversations/{conversationId}/drafts/{draftId}/confirm` | Confirmar operação exibida                               | Dono; draft atual, válido e pendente          |
| `POST /api/v1/conversations/{conversationId}/handoff`                  | Solicitar analista                                       | Dono; conversa não encerrada                  |

`employeeId` não é aceito em rotas de funcionário. Identidade é retirada do contexto servidor.

### Sessão demonstrativa

`POST /api/v1/auth/demo/login` recebe `{ "email": "usuario@nexo.example", "password": "qualquer valor" }` e só autentica um e-mail presente nos dados seed. O papel é resolvido no servidor, nunca escolhido pelo request. Em sucesso, define cookie de sessão `HttpOnly`, `SameSite` apropriado e `Secure` fora de localhost; credenciais e cookie não são incluídos nos logs. `GET /api/v1/auth/session` retorna apenas o identificador, nome e papel necessários à UI.

Esse endpoint e a aceitação de qualquer senha existem somente no protótipo local/demonstrativo. Devem ser desabilitados em builds/deploy de produção e substituídos por autenticação corporativa antes de qualquer exposição a usuários reais. O PRD não define o protocolo de produção.

### Criar conversa

`POST /api/v1/conversations`

Resposta `201`:

```json
{
  "id": "conversation-id",
  "status": "active",
  "agentStatus": "active",
  "createdAt": "2026-10-31T12:00:00Z"
}
```

### Enviar mensagem

`POST /api/v1/conversations/{id}/messages`

Headers: `Accept: text/event-stream`, `Idempotency-Key: <unique-request-id>`.

```json
{ "content": "Minha VPN apresenta erro 809." }
```

O endpoint valida o dono, estado e contador antes de persistir e iniciar execução. Se o limite de 30 mensagens do funcionário for atingido, retorna `409 MESSAGE_LIMIT_REACHED` e não aceita/persiste mensagem adicional. SSE carrega `id`, `event`, `data`:

```text
id: 14
event: agent.execution.started
data: {"executionId":"execution-id","traceId":"trace-id"}

id: 15
event: tool.completed
data: {"toolName":"searchKnowledgeBase","sourceCount":1}

id: 16
event: message.delta
data: {"text":"O artigo de VPN orienta..."}

id: 17
event: message.completed
data: {"messageId":"message-id","executionId":"execution-id"}
```

Outros eventos: `message.started`, `agent.execution.completed`, `tool.started`, `tool.failed`, `ticket.draft.created`, `ticket.created`, `ticket.updated`, `handoff.requested`, `agent.paused`, `agent.resumed`. Eventos identificam estado real; nenhum `ticket.created` é emitido antes da persistência.

Reconexão usa `Last-Event-ID` para retomar eventos persistidos ou consultar status da execução. `message.delta` é efêmero se o transporte cair; a resposta final persistida permanece recuperável.

### Rascunho e confirmação

Um `ticket.draft.created` retorna campos de preview, tipo da operação (`create | update | reopen`), `draftId`, `expiresAt` e dados de idempotência não reutilizáveis pelo cliente. A confirmação:

```json
{ "confirmation": "confirm", "draftVersion": 1 }
```

A API confere identidade, conteúdo/hash e versão do draft, confirma que a intenção explícita veio do funcionário, executa a revalidação e encaminha comando idempotente ao Ticket Service. Editar o draft cria uma nova versão e invalida confirmação anterior.

## 3. AI Backend — analista

| Método e rota                                      | Uso                                                        |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `GET /api/v1/analyst/handoffs?status=pending`      | Fila e filtros                                             |
| `GET /api/v1/analyst/conversations/{id}`           | Histórico e contexto permitido                             |
| `POST /api/v1/analyst/conversations/{id}/takeover` | Assumir atomicamente                                       |
| `POST /api/v1/analyst/conversations/{id}/return`   | Devolver ao agente                                         |
| `POST /api/v1/analyst/conversations/{id}/close`    | Encerrar atendimento                                       |
| `GET /api/v1/analyst/employees/{id}/tickets`       | Chamados necessários para atendimento, com acesso auditado |

Todas exigem papel analista. `takeover` retorna `409 HANDOFF_ALREADY_ASSIGNED` se outra pessoa venceu a corrida. Eventos SSE no console podem notificar atualização de fila e mensagem, mas não substituem o estado persistido.

## 4. Ticket Service — serviço independente

| Método e rota               | Uso                                                 |
| --------------------------- | --------------------------------------------------- |
| `GET /health`               | Health check sem dependências                       |
| `GET /health/live`          | Liveness probe                                      |
| `GET /health/ready`         | Readiness probe com verificação PostgreSQL          |
| `GET /employees/me`         | Perfil do funcionário autenticado                   |
| `GET /tickets`              | Listar chamados próprios, com paginação opcional    |
| `GET /tickets/search?q=...` | Buscar chamados próprios                            |
| `GET /tickets/{id}`         | Obter chamado próprio e histórico                   |
| `POST /tickets`             | Criar chamado ou atualizar chamado aberto duplicado |
| `PATCH /tickets/{id}`       | Atualizar chamado próprio com controle de versão    |
| `POST /tickets/{id}/reopen` | Reabrir chamado próprio elegível                    |

As rotas de negócio exigem JWT HS256 validado por issuer e audience. Para
funcionário, o `sub` verificado é o UUID da identidade interna; tokens
serviço-a-serviço usam `role: "service"` e `employeeId` como contexto
acting-on-behalf-of. O ID de ownership nunca vem do corpo ou query do cliente.
Todas as escritas exigem `Idempotency-Key`; atualizações exigem `expectedVersion`.
Somente principal `role: "service"` pode escrever; o AI Backend chama essas
rotas após validar a confirmação explícita do usuário. JWTs `role: "employee"`
são somente leitura.
Swagger UI e OpenAPI estão em `/docs` e `/docs/json`.

A regra operacional atual calcula prioridade crítica como uma hora corrida e
as demais prioridades em dias úteis de segunda a sexta, 09:00–17:00 UTC. É uma
assunção técnica temporária, não requisito confirmado pelo PRD; calendário de
feriados e timezone local devem ser definidos antes do SLA de produção.

### Criar ticket

```json
{
  "title": "VPN com erro 809",
  "description": "A conexão falha ao ...",
  "type": "INC",
  "category": "Rede e VPN",
  "priority": "Alta",
  "affectedEmployeeId": "employee-id"
}
```

O header `Idempotency-Key` é obrigatório. `employeeId` proprietário é inferido
da identidade verificada; o campo opcional `affectedEmployeeId` não altera
ownership. O Ticket Service valida os campos, ownership e duplicidade. `201`
devolve o chamado criado; `200` indica que um chamado aberto duplicado foi
atualizado. A atualização exige `expectedVersion`; `409 VERSION_CONFLICT`
solicita nova leitura/rascunho.

### Consulta de duplicidade

Recebe categoria/tipo e descrição minimizada da intenção, mas aplica ownership no servidor. Resposta inclui somente candidatos próprios e razões legíveis para a ferramenta; não revela tickets alheios. Detecção não deve executar mutação implicitamente.

## 5. Erros de domínio

| HTTP          | Código                                                                                                                                                                              | Significado                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `400`         | `VALIDATION_ERROR`                                                                                                                                                                  | Schema/formato inválido                                                           |
| `401`         | `UNAUTHENTICATED`, `UNAUTHORIZED`                                                                                                                                                   | Sessão ausente/inválida                                                           |
| `403`         | `FORBIDDEN`                                                                                                                                                                         | Papel/ação não autorizada                                                         |
| `404`         | `NOT_FOUND`, `EMPLOYEE_NOT_FOUND`, `TICKET_NOT_FOUND`                                                                                                                               | Recurso inexistente ou não pertencente ao chamador                                |
| `409`         | `CONFLICT`, `DUPLICATE_CANDIDATE`, `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`, `INVALID_TICKET_STATE`, `REOPEN_WINDOW_EXPIRED`, `MESSAGE_LIMIT_REACHED`, `HANDOFF_ALREADY_ASSIGNED` | Conflito que exige intervenção                                                    |
| `422`         | `CONFIRMATION_REQUIRED`, `DRAFT_STALE`                                                                                                                                              | Estado/regra impede ação                                                          |
| `429`         | `RATE_LIMITED`                                                                                                                                                                      | Limite temporário                                                                 |
| `502/503/504` | `TICKET_SERVICE_UNAVAILABLE`, `DEPENDENCY_TIMEOUT`                                                                                                                                  | Falha de dependência; nenhuma garantia de escrita até consultar chave idempotente |
| `500`         | `INTERNAL_SERVER_ERROR`                                                                                                                                                             | Falha inesperada; operação de escrita deve ser verificada pela mesma chave        |

Retornar `404` para recurso de terceiro evita confirmar existência; auditoria interna pode registrar tentativa negada sem incluir conteúdo sensível.

## 6. Semântica de retry e idempotência

- O cliente usa chave única por envio lógico; reconectar SSE não reenvia a mensagem.
- Ticket Service registra chave, escopo, hash do request e resultado em transação junto ao efeito e histórico.
- Mesma chave + mesmo payload devolve resultado original; mesma chave + payload divergente retorna `409`.
- Timeout após envio de escrita é resultado desconhecido, não falha definitiva. Consultar/repetir com a mesma chave.
- Retry limitado para reads; escrita só repete com mesma chave idempotente.

## 7. Versionamento e compatibilidade

Contratos de API usam `/v1`; schemas Zod compartilhados são testados em provider/consumer. Campos novos opcionais podem ser adicionados sem breaking change; renomear/remover campo, alterar enum ou semântica exige versão/migração coordenada. `GET /health` não expõe URL de banco, tokens ou detalhes internos.
