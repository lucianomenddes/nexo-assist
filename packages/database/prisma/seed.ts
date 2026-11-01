import {
  AgentStatus,
  AuditStatus,
  ExecutionStatus,
  HandoffStatus,
  MessageActorType,
  Prisma,
  TicketPriority,
  TicketStatus,
  TicketType,
} from "@prisma/client";
import { prisma, withEmployeeScope } from "../src/index.js";

const employeeId = "00000000-0000-4000-8000-000000000001";
const analystId = "00000000-0000-4000-8000-000000000002";
const conversationId = "00000000-0000-4000-8000-000000000003";
const messageId = "00000000-0000-4000-8000-000000000004";
const ticketId = "00000000-0000-4000-8000-000000000005";
const historyId = "00000000-0000-4000-8000-000000000006";
const executionId = "00000000-0000-4000-8000-000000000007";
const auditId = "00000000-0000-4000-8000-000000000008";
const handoffId = "00000000-0000-4000-8000-000000000009";
const documentId = "00000000-0000-4000-8000-000000000010";
const chunkId = "00000000-0000-4000-8000-000000000011";
const idempotencyId = "00000000-0000-4000-8000-000000000012";
const idempotencyKey = "seed-ticket-create-v1";
const requestHash = "seed-request-hash";
const seededKnowledgeContent =
  "Instale o cliente VPN homologado e autentique com sua conta corporativa.";
const seededKnowledgeContentHash =
  "d33b3e47159a2d766cbe813ef7a4b9f979bc7ccba4fbe5d586f801d43a49f06b";

async function seed(): Promise<void> {
  await prisma.analyst.upsert({
    where: { id: analystId },
    create: {
      id: analystId,
      email: "analista@nexo.local",
      name: "Analista Nexo",
    },
    update: {},
  });

  await withEmployeeScope(employeeId, async (transaction) => {
    await transaction.employee.upsert({
      where: { id: employeeId },
      create: {
        id: employeeId,
        email: "funcionario@nexo.local",
        name: "Funcionário de Exemplo",
        department: "Tecnologia",
      },
      update: {},
    });

    await transaction.conversation.upsert({
      where: { id: conversationId },
      create: { id: conversationId, employeeId },
      update: {},
    });

    await transaction.message.upsert({
      where: { id: messageId },
      create: {
        id: messageId,
        employeeId,
        conversationId,
        sequence: 1,
        actorType: MessageActorType.employee,
        content: "Preciso de ajuda para acessar a VPN.",
        idempotencyKey: "seed-message-v1",
      },
      update: {},
    });

    await transaction.ticket.upsert({
      where: { id: ticketId },
      create: {
        id: ticketId,
        publicKey: "NX-1001",
        employeeId,
        affectedEmployeeId: employeeId,
        title: "Acesso à VPN",
        description: "Falha ao autenticar na VPN corporativa.",
        type: TicketType.INC,
        category: "Rede e VPN",
        priority: TicketPriority.medium,
        status: TicketStatus.open,
      },
      update: {},
    });

    await transaction.ticketHistory.upsert({
      where: { id: historyId },
      create: {
        id: historyId,
        employeeId,
        ticketId,
        actorType: MessageActorType.employee,
        actorId: employeeId,
        action: "created",
        changes: {
          publicKey: "NX-1001",
          status: TicketStatus.open,
        } satisfies Prisma.InputJsonObject,
        idempotencyKey,
        requestHash,
      },
      update: {},
    });

    await transaction.ticketIdempotency.upsert({
      where: {
        employeeId_operation_key: {
          employeeId,
          operation: "ticket.create",
          key: idempotencyKey,
        },
      },
      create: {
        id: idempotencyId,
        employeeId,
        operation: "ticket.create",
        key: idempotencyKey,
        requestHash,
        ticketId,
        response: { ticketId, publicKey: "NX-1001" },
        completedAt: new Date(),
      },
      update: {},
    });

    await transaction.agentExecution.upsert({
      where: { id: executionId },
      create: {
        id: executionId,
        employeeId,
        conversationId,
        traceId: "seed-trace-1001",
        intent: "knowledge_search",
        status: ExecutionStatus.succeeded,
        model: "openai/gpt-4.1-mini",
        completedAt: new Date(),
      },
      update: {},
    });

    await transaction.agentAudit.upsert({
      where: { id: auditId },
      create: {
        id: auditId,
        employeeId,
        executionId,
        eventType: "tool_call",
        toolName: "searchKnowledge",
        status: AuditStatus.succeeded,
        sourceRefs: ["VPN-SETUP-001"],
      },
      update: {},
    });

    await transaction.handoff.upsert({
      where: { id: handoffId },
      create: {
        id: handoffId,
        employeeId,
        conversationId,
        status: HandoffStatus.analyst_assigned,
        reason: "Solicitação do funcionário",
        summary: "Funcionário precisa de suporte para acesso à VPN.",
        assignedAnalystId: analystId,
        assignedAt: new Date(),
        events: {
          create: [
            {
              action: "requested",
              actorType: "employee",
              actorId: employeeId,
              reason: "Solicitação do funcionário",
            },
            {
              action: "assigned",
              actorType: "analyst",
              actorId: analystId,
              reason: "Atendimento atribuído ao analista de seed.",
            },
          ],
        },
      },
      update: {},
    });

    await transaction.conversation.update({
      where: { id: conversationId },
      data: {
        status: "analyst_assigned",
        agentStatus: AgentStatus.paused,
      },
    });
  });

  await prisma.knowledgeDocument.upsert({
    where: { source_version: { source: "seed/vpn", version: 1 } },
    create: {
      id: documentId,
      source: "seed/vpn",
      title: "Configuração de acesso VPN",
      category: "Rede e VPN",
      version: 1,
      status: "published",
      platforms: ["Windows", "macOS"],
      tags: ["vpn", "acesso"],
      contentHash: seededKnowledgeContentHash,
    },
    update: { contentHash: seededKnowledgeContentHash },
  });

  await prisma.knowledgeChunk.upsert({
    where: { id: chunkId },
    create: {
      id: chunkId,
      documentId,
      ordinal: 0,
      content: seededKnowledgeContent,
      tokenCount: 13,
    },
    update: {},
  });
}

seed()
  .catch((error: unknown) => {
    console.error("Could not seed Nexo Assist database", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
