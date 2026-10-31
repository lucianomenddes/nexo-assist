import {
  AuditStatus,
  ExecutionStatus,
  MessageActorType,
  TicketPriority,
  TicketType,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkDatabaseConnection,
  prisma,
  transitionConversation,
  withEmployeeScope,
} from "./index.js";
import {
  ConversationStateConflictError,
  InvalidConversationTransitionError,
} from "./conversations.js";
import {
  createTicketIdempotently,
  IdempotencyConflictError,
} from "./tickets.js";

const employeeA = randomUUID();
const employeeB = randomUUID();
const conversationA = randomUUID();
const conversationB = randomUUID();
const analystId = randomUUID();
const documentId = randomUUID();

describe.sequential("PostgreSQL domain persistence", () => {
  beforeAll(async () => {
    await prisma.analyst.create({
      data: {
        id: analystId,
        email: `${analystId}@example.test`,
        name: "Integration Analyst",
      },
    });

    for (const { employeeId, conversationId } of [
      { employeeId: employeeA, conversationId: conversationA },
      { employeeId: employeeB, conversationId: conversationB },
    ]) {
      await withEmployeeScope(employeeId, async (transaction) => {
        await transaction.employee.create({
          data: {
            id: employeeId,
            email: `${employeeId}@example.test`,
            name: "Integration Employee",
          },
        });
        await transaction.conversation.create({
          data: { id: conversationId, employeeId },
        });
      });
    }

    await prisma.knowledgeDocument.create({
      data: {
        id: documentId,
        source: `integration/${documentId}`,
        title: "Integration document",
        version: 1,
        contentHash: documentId,
        chunks: {
          create: {
            ordinal: 0,
            content: "Integration knowledge chunk.",
          },
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.knowledgeDocument.delete({ where: { id: documentId } });

    for (const employeeId of [employeeA, employeeB]) {
      await withEmployeeScope(employeeId, async (transaction) => {
        await transaction.agentAudit.deleteMany({ where: { employeeId } });
        await transaction.handoff.deleteMany({ where: { employeeId } });
        await transaction.ticketHistory.deleteMany({ where: { employeeId } });
        await transaction.ticketIdempotency.deleteMany({
          where: { employeeId },
        });
        await transaction.ticket.deleteMany({ where: { employeeId } });
        await transaction.agentExecution.deleteMany({ where: { employeeId } });
        await transaction.message.deleteMany({ where: { employeeId } });
        await transaction.conversation.deleteMany({ where: { employeeId } });
        await transaction.employee.delete({ where: { id: employeeId } });
      });
    }

    await prisma.analyst.delete({ where: { id: analystId } });
    await prisma.$disconnect();
  });

  it("isolates employees with PostgreSQL row-level security", async () => {
    await checkDatabaseConnection();

    const visibleConversation = await withEmployeeScope(
      employeeA,
      (transaction) =>
        transaction.conversation.findUnique({
          where: { id: conversationB },
        }),
    );

    expect(visibleConversation).toBeNull();
  });

  it("enforces tenant-consistent foreign keys for messages", async () => {
    await expect(
      withEmployeeScope(employeeB, (transaction) =>
        transaction.message.create({
          data: {
            employeeId: employeeB,
            conversationId: conversationA,
            sequence: 1,
            actorType: MessageActorType.employee,
            content: "Cross-tenant reference must fail.",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("transitions conversation state and rejects stale or invalid transitions", async () => {
    const waiting = await transitionConversation({
      employeeId: employeeA,
      conversationId: conversationA,
      expectedStatus: "active",
      nextStatus: "waiting_analyst",
    });

    expect(waiting.status).toBe("waiting_analyst");
    expect(waiting.agentStatus).toBe("paused");
    await expect(
      transitionConversation({
        employeeId: employeeA,
        conversationId: conversationA,
        expectedStatus: "active",
        nextStatus: "resolved",
      }),
    ).rejects.toBeInstanceOf(ConversationStateConflictError);
    await expect(
      transitionConversation({
        employeeId: employeeA,
        conversationId: conversationA,
        expectedStatus: "waiting_analyst",
        nextStatus: "closed",
      }),
    ).rejects.toBeInstanceOf(InvalidConversationTransitionError);
  });

  it("persists ticket history and replays idempotent creation", async () => {
    const command = {
      employeeId: employeeA,
      idempotencyKey: randomUUID(),
      publicKey: `NX-${randomUUID()}`,
      affectedEmployeeId: employeeA,
      title: "VPN access",
      description: "Cannot connect to VPN.",
      type: TicketType.INC,
      category: "Rede e VPN",
      priority: TicketPriority.high,
      actorType: MessageActorType.employee,
      actorId: employeeA,
    } as const;

    const created = await createTicketIdempotently(command);
    const replay = await createTicketIdempotently(command);
    const historyCount = await withEmployeeScope(employeeA, (transaction) =>
      transaction.ticketHistory.count({
        where: { ticketId: created.ticket.id },
      }),
    );

    expect(created.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.ticket.id).toBe(created.ticket.id);
    expect(historyCount).toBe(1);
    await expect(
      createTicketIdempotently({ ...command, title: "Different request" }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("persists execution audit, analyst handoff, and knowledge chunks", async () => {
    const executionId = randomUUID();
    const handoffId = randomUUID();
    const execution = await withEmployeeScope(employeeA, async (transaction) =>
      transaction.agentExecution.create({
        data: {
          id: executionId,
          employeeId: employeeA,
          conversationId: conversationA,
          traceId: randomUUID(),
          intent: "knowledge_search",
          status: ExecutionStatus.succeeded,
          completedAt: new Date(),
          audits: {
            create: {
              eventType: "tool_call",
              toolName: "searchKnowledge",
              status: AuditStatus.succeeded,
              sourceRefs: ["integration-source"],
            },
          },
        },
        include: { audits: true },
      }),
    );

    const handoff = await withEmployeeScope(employeeA, (transaction) =>
      transaction.handoff.create({
        data: {
          id: handoffId,
          employeeId: employeeA,
          conversationId: conversationA,
          reason: "Employee requested an analyst.",
          summary: "VPN access support.",
          assignedAnalystId: analystId,
          assignedAt: new Date(),
        },
      }),
    );

    const document = await prisma.knowledgeDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { chunks: true },
    });

    expect(execution.audits).toHaveLength(1);
    expect(handoff.assignedAnalystId).toBe(analystId);
    expect(document.chunks).toHaveLength(1);
  });

  it("allows only one active handoff for a conversation", async () => {
    await expect(
      withEmployeeScope(employeeA, (transaction) =>
        transaction.handoff.create({
          data: {
            employeeId: employeeA,
            conversationId: conversationA,
            reason: "Duplicate active handoff.",
            summary: "Must be rejected.",
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
