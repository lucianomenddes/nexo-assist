# Modelo de dados — Nexo Assist

**Fonte funcional:** [PRD](../PRD.md) · **Arquitetura:** [ARCHITECTURE](./ARCHITECTURE.md)

## 1. Princípios

- PostgreSQL é a fonte de verdade para domínio, conversa, auditoria e conhecimento.
- O Ticket Service é proprietário de funcionários de demonstração e tickets; o AI Backend é proprietário das conversas e execuções.
- O storage do Mastra é separado e não substitui mensagens/auditoria de domínio.
- IDs são opacos (UUID/ULID); timestamps são UTC e apresentados em timezone de negócio configurado.
- Toda leitura de chamado é escopada ao funcionário autenticado; toda mutação confirma ownership novamente no serviço dono do dado.
- Não indexar tickets, mensagens ou dados pessoais no RAG institucional.

## 2. Entidades

| Entidade            | Campos principais                                                                                                                                                                     | Regras/índices                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Employee`          | `id`, `email`, `name`, `department`, `active`, `createdAt`                                                                                                                            | `email` único normalizado; apenas registros seed no protótipo.                                            |
| `Analyst`           | `id`, `email`, `name`, `active`                                                                                                                                                       | Papel distinto; no futuro vínculo com IdP/grupos.                                                         |
| `Conversation`      | `id`, `employeeId`, `status`, `agentStatus`, `messageCount`, `createdAt`, `updatedAt`, `closedAt`                                                                                     | Índice por `(employeeId, updatedAt)`; sessão do funcionário.                                              |
| `Message`           | `id`, `conversationId`, `sequence`, `actorType`, `actorId?`, `content`, `createdAt`, `metadata?`                                                                                      | Unique `(conversationId, sequence)`; conteúdo com retenção definida.                                      |
| `Ticket`            | `id`, `publicKey`, `employeeId`, `affectedEmployeeId`, `title`, `description`, `type`, `category`, `priority`, `status`, `createdAt`, `updatedAt`, `resolvedAt?`, `dueAt?`, `version` | `publicKey` único; índices por proprietário/status e vencimento. `affectedEmployeeId` não concede acesso. |
| `TicketHistory`     | `id`, `ticketId`, `actorType`, `actorId`, `action`, `changes`, `createdAt`, `idempotencyKey?`                                                                                         | Apêndice de auditoria; índices por ticket/data.                                                           |
| `TicketIdempotency` | `key`, `operation`, `requestHash`, `ticketId?`, `response`, `createdAt`, `expiresAt?`                                                                                                 | Unique por chave/escopo; mesma chave com payload divergente é conflito.                                   |
| `Handoff`           | `id`, `conversationId`, `status`, `reason`, `summary`, `requestedAt`, `assignedAnalystId?`, `assignedAt?`, `completedAt?`                                                             | No máximo um handoff ativo por conversa; atribuição concorrente atômica.                                  |
| `AgentExecution`    | `id`, `conversationId`, `traceId`, `intent`, `status`, `confidence?`, `reason?`, `startedAt`, `completedAt?`, `model?`, `usage?`                                                      | Índices por conversa/tempo e `traceId`.                                                                   |
| `AgentAudit`        | `id`, `executionId`, `eventType`, `toolName?`, `inputSummary?`, `outputSummary?`, `status`, `sourceRefs?`, `createdAt`                                                                | Eventos append-only; não incluir segredo ou chain-of-thought.                                             |
| `KnowledgeDocument` | `id`, `source`, `title`, `category`, `version`, `status`, `platforms`, `tags`, `updatedAt`, `contentHash`                                                                             | Unique `(source, version)` ou chave equivalente; somente `published` recuperável.                         |
| `KnowledgeChunk`    | `id`, `documentId`, `ordinal`, `content`, `tokenCount`, `embedding vector(1536)`, `metadata`                                                                                          | Unique `(documentId, ordinal)`; dimensão alinhada ao embedding escolhido.                                 |

### Distinção de solicitante e afetado

O PRD exige identificar “de quem é afetado” no chamado e também exige privacidade para quem o abriu. Portanto, `employeeId`/solicitante e `affectedEmployeeId` são conceitos distintos. Na experiência do funcionário do MVP, o afetado pode ser o próprio solicitante; informar terceiro não concede acesso ao chamado.

### Conversa e mensagens

`actorType` assume `employee`, `assistant`, `analyst` ou `system`. Mensagens de ação usam metadata estruturada apontando para `executionId`; a transcrição continua legível mesmo sem visualizador de auditoria. Dados técnicos de SSE não são mensagens persistidas.

## 3. Relacionamentos

```mermaid
erDiagram
    EMPLOYEE ||--o{ CONVERSATION : owns
    EMPLOYEE ||--o{ TICKET : opens
    EMPLOYEE ||--o{ TICKET : may_be_affected
    CONVERSATION ||--o{ MESSAGE : contains
    CONVERSATION ||--o{ AGENT_EXECUTION : has
    CONVERSATION ||--o{ HANDOFF : may_request
    ANALYST o|--o{ HANDOFF : assigned_to
    TICKET ||--o{ TICKET_HISTORY : records
    AGENT_EXECUTION ||--o{ AGENT_AUDIT : emits
    KNOWLEDGE_DOCUMENT ||--|{ KNOWLEDGE_CHUNK : splits_into

    EMPLOYEE {
        uuid id PK
        string email UK
        string name
        boolean active
    }
    CONVERSATION {
        uuid id PK
        uuid employeeId FK
        string status
        string agentStatus
        int messageCount
    }
    MESSAGE {
        uuid id PK
        uuid conversationId FK
        int sequence
        string actorType
        text content
    }
    TICKET {
        uuid id PK
        string publicKey UK
        uuid employeeId FK
        uuid affectedEmployeeId FK
        string type
        string category
        string priority
        string status
    }
    HANDOFF {
        uuid id PK
        uuid conversationId FK
        uuid assignedAnalystId FK
        string status
    }
    AGENT_EXECUTION {
        uuid id PK
        uuid conversationId FK
        string traceId
        string intent
        string status
    }
    AGENT_AUDIT {
        uuid id PK
        uuid executionId FK
        string eventType
        string status
    }
    KNOWLEDGE_DOCUMENT {
        uuid id PK
        string source
        int version
        string status
    }
    KNOWLEDGE_CHUNK {
        uuid id PK
        uuid documentId FK
        int ordinal
        vector embedding
    }
```

`Analyst` e `Handoff` são propriedade do AI Backend. `Employee`, `Ticket`, histórico e idempotência pertencem ao Ticket Service. No monólito de banco do protótipo, relações entre schemas podem ser referências por ID sem FK cross-service; o contrato do serviço valida existência/ownership quando necessário.

## 4. Enums e estados

### Chamado (valores fixos do PRD)

- Tipo: `INC` (incidente), `REQ` (requisição).
- Categoria: `Acesso`, `Rede e VPN`, `Hardware`, `Software`, `E-mail`, `Outros`.
- Prioridade: `Crítica`, `Alta`, `Média`, `Baixa`.
- Estado: PRD não define enumeração completa. Serviço simulado deve suportar pelo menos aberto, aguardando analista, resolvido e encerrado, preservando estados representados nos dados de exemplo e documentando o mapeamento. Não inferir que “Aprovado” é encerrado ou resolvido.

### Conversa e agente

```mermaid
stateDiagram-v2
    [*] --> active
    active --> waiting_analyst: pedido/crítico/vencido/baixa segurança
    waiting_analyst --> analyst_assigned: analista assume
    analyst_assigned --> active: analista devolve ao agente
    analyst_assigned --> resolved: analista resolve e encerra
    active --> resolved: atendimento resolvido
    resolved --> closed: encerramento
    closed --> [*]
```

`Conversation.status`: `active | waiting_analyst | analyst_assigned | resolved | closed`.  
`agentStatus`: `active | paused | completed`. `waiting_analyst` e `analyst_assigned` implicam `paused`; validação de domínio impede combinações inválidas. O agente só retoma por transição autorizada.

`Handoff.status`: `pending | assigned | returned | closed | cancelled`. Cada transição registra analista, data e motivo.

## 5. SLA e prioridade

Armazenar prioridade atribuída e instante limite calculado (`dueAt`), além do instante e dados necessários para explicar o cálculo. Critérios fornecidos pelo PRD: crítica — equipe/empresa parada, uma hora; alta — uma pessoa impedida ou compromisso no mesmo dia, quatro horas úteis; média — há alternativa, três dias úteis; baixa — pedido/melhoria sem urgência, cinco dias úteis. SLA vencido é comparação do relógio atual com prazo persistido.

Calendário, feriados, timezone, pausas por status e regra de atualização são questões abertas no [SDD](./SDD.md), portanto o MVP não deve alegar precisão maior que as regras configuradas.

## 6. Invariantes de consistência e privacidade

1. `Conversation.employeeId` vem da sessão; toda rota valida dono da conversa.
2. Consultas de ticket usam `id + employeeId` (ou API equivalente), não `id` isolado.
3. `affectedEmployeeId` não altera ownership nem autorização de leitura.
4. Uma escrita usa chave idempotente; o ticket e o registro de histórico são persistidos atomicamente pelo Ticket Service.
5. A criação/atualização só acontece após confirmação inequívoca do rascunho vigente e autorização novamente validada.
6. Contador de mensagens do funcionário é atualizado atomicamente e não ultrapassa 30 por conversa.
7. Handoff ativo impede nova execução de resposta do agente; mudanças de estado usam comparação/versionamento para prevenir corrida.
8. Exclusão ou retenção de conteúdo segue política de privacidade definida antes de produção; logs técnicos evitam duplicar conteúdo integral.

## 7. Migrations e índices

Prisma Migrate é proposto para schemas de domínio. `CREATE EXTENSION vector` e índices vetoriais podem exigir migrations SQL customizadas, dependendo da versão Prisma/adapter escolhida. O campo vetorial, dimensão, operadores e índice devem ser validados na versão fixada. Em um corpus inicial de 5–10 artigos, busca exata é a referência; HNSW é decisão posterior baseada em latência/recall medidos. Migrations Mastra pertencem ao mecanismo de storage da versão instalada, em schema separado.
