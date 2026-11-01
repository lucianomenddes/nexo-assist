import {
  AgentStatus,
  ConversationStatus,
  HandoffActorType,
  HandoffStatus,
  MessageActorType,
  Prisma,
} from "@prisma/client";
import { withAnalystScope, withEmployeeScope } from "@nexo-assist/database";

const activeHandoffStatuses = [
  HandoffStatus.waiting_analyst,
  HandoffStatus.analyst_assigned,
];

const allowedHandoffTransitions: Record<HandoffStatus, HandoffStatus[]> = {
  waiting_analyst: [HandoffStatus.analyst_assigned],
  analyst_assigned: [
    HandoffStatus.agent_resumed,
    HandoffStatus.resolved,
    HandoffStatus.closed,
  ],
  agent_resumed: [HandoffStatus.resolved, HandoffStatus.closed],
  resolved: [HandoffStatus.closed],
  closed: [],
};

export function assertHandoffTransition(
  from: HandoffStatus,
  to: HandoffStatus,
): void {
  if (!allowedHandoffTransitions[from].includes(to)) {
    throw new InvalidHandoffTransitionError(
      `Handoff transition ${from} -> ${to} is not allowed.`,
    );
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function buildHandoffSummary(
  reason: string,
  messages: Array<{ actorType: MessageActorType; content: string }>,
): string {
  const transcript = messages
    .map(({ actorType, content }) => {
      const speaker =
        actorType === MessageActorType.employee
          ? "Funcionário"
          : actorType === MessageActorType.analyst
            ? "Analista"
            : actorType === MessageActorType.assistant
              ? "Assistente"
              : "Sistema";
      return `${speaker}: ${content.trim()}`;
    })
    .join("\n");
  return [
    `Motivo da transferência: ${reason}`,
    "Resumo factual da conversa:",
    transcript || "Ainda não há mensagens anteriores disponíveis.",
  ]
    .join("\n")
    .slice(0, 4000);
}

export class HandoffNotFoundError extends Error {
  constructor() {
    super("Handoff not found.");
    this.name = "HandoffNotFoundError";
  }
}

export class InvalidHandoffTransitionError extends Error {
  constructor(message = "Handoff state transition is invalid.") {
    super(message);
    this.name = "InvalidHandoffTransitionError";
  }
}

export class HandoffAccessError extends Error {
  constructor(message = "The analyst does not own this active handoff.") {
    super(message);
    this.name = "HandoffAccessError";
  }
}

export class HandoffService {
  async requestEmployeeHandoff(input: {
    employeeId: string;
    conversationId: string;
    idempotencyKey: string;
    reason: string;
  }) {
    return withEmployeeScope(input.employeeId, async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Conversation"
        WHERE id = ${input.conversationId}::uuid
          AND "employeeId" = ${input.employeeId}::uuid
        FOR UPDATE
      `;
      const replay = await transaction.handoff.findUnique({
        where: {
          employeeId_idempotencyKey: {
            employeeId: input.employeeId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (replay) return replay;

      const conversation = await transaction.conversation.findUnique({
        where: {
          id_employeeId: {
            id: input.conversationId,
            employeeId: input.employeeId,
          },
        },
      });
      if (
        !conversation ||
        (conversation.status !== ConversationStatus.active &&
          conversation.status !== ConversationStatus.agent_resumed) ||
        conversation.agentStatus !== AgentStatus.active
      ) {
        throw new InvalidHandoffTransitionError(
          "Only an active conversation can be transferred.",
        );
      }

      const priorMessages = await transaction.message.findMany({
        where: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
        },
        orderBy: { sequence: "desc" },
        take: 12,
        select: { actorType: true, content: true },
      });
      const summary = buildHandoffSummary(
        input.reason,
        priorMessages.reverse(),
      );
      const now = new Date();
      const handoff = await transaction.handoff.create({
        data: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
          status: HandoffStatus.waiting_analyst,
          reason: input.reason,
          summary,
          requestedAt: now,
        },
      });
      await transaction.conversation.update({
        where: {
          id_employeeId: {
            id: input.conversationId,
            employeeId: input.employeeId,
          },
        },
        data: {
          status: ConversationStatus.waiting_analyst,
          agentStatus: AgentStatus.paused,
        },
      });
      await transaction.handoffEvent.create({
        data: {
          employeeId: input.employeeId,
          handoffId: handoff.id,
          action: "requested",
          actorType: HandoffActorType.employee,
          actorId: input.employeeId,
          reason: input.reason,
          metadata: jsonValue({ generatedSummary: true }),
        },
      });
      return handoff;
    });
  }

  async listQueue(analystId: string) {
    return withAnalystScope(analystId, (transaction) =>
      transaction.handoff.findMany({
        where: {
          status: { in: activeHandoffStatuses },
        },
        orderBy: { requestedAt: "asc" },
        take: 100,
        select: {
          id: true,
          conversationId: true,
          employeeId: true,
          status: true,
          reason: true,
          summary: true,
          requestedAt: true,
          assignedAt: true,
          assignedAnalystId: true,
          conversation: {
            select: { status: true, updatedAt: true },
          },
          employee: {
            select: { name: true, email: true, department: true },
          },
        },
      }),
    );
  }

  async getHandoff(analystId: string, handoffId: string) {
    return withAnalystScope(analystId, async (transaction) => {
      const handoff = await transaction.handoff.findUnique({
        where: { id: handoffId },
        include: {
          employee: { select: { name: true, email: true, department: true } },
          conversation: {
            select: {
              id: true,
              status: true,
              agentStatus: true,
              messages: {
                orderBy: { sequence: "asc" },
                take: 200,
                select: {
                  id: true,
                  sequence: true,
                  actorType: true,
                  actorId: true,
                  content: true,
                  createdAt: true,
                },
              },
            },
          },
          events: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!handoff) throw new HandoffNotFoundError();
      return handoff;
    });
  }

  async assign(
    analystId: string,
    handoffId: string,
    reason: string,
  ): Promise<void> {
    await withAnalystScope(analystId, async (transaction) => {
      const handoff = await transaction.handoff.findUnique({
        where: { id: handoffId },
      });
      if (!handoff) throw new HandoffNotFoundError();
      assertHandoffTransition(handoff.status, HandoffStatus.analyst_assigned);

      const assigned = await transaction.handoff.updateMany({
        where: {
          id: handoffId,
          status: HandoffStatus.waiting_analyst,
          assignedAnalystId: null,
        },
        data: {
          status: HandoffStatus.analyst_assigned,
          assignedAnalystId: analystId,
          assignedAt: new Date(),
        },
      });
      if (assigned.count !== 1) {
        throw new InvalidHandoffTransitionError(
          "Another analyst already assigned this handoff.",
        );
      }
      const conversation = await transaction.conversation.updateMany({
        where: {
          id: handoff.conversationId,
          employeeId: handoff.employeeId,
          status: ConversationStatus.waiting_analyst,
          agentStatus: AgentStatus.paused,
        },
        data: { status: ConversationStatus.analyst_assigned },
      });
      if (conversation.count !== 1) {
        throw new InvalidHandoffTransitionError(
          "Conversation state changed before assignment.",
        );
      }
      await transaction.handoffEvent.create({
        data: {
          employeeId: handoff.employeeId,
          handoffId,
          action: "assigned",
          actorType: HandoffActorType.analyst,
          actorId: analystId,
          reason,
        },
      });
    });
  }

  async sendMessage(
    analystId: string,
    handoffId: string,
    content: string,
  ): Promise<{ id: string; createdAt: Date }> {
    return withAnalystScope(analystId, async (transaction) => {
      const handoff = await transaction.handoff.findUnique({
        where: { id: handoffId },
      });
      if (!handoff) throw new HandoffNotFoundError();
      if (
        handoff.status !== HandoffStatus.analyst_assigned ||
        handoff.assignedAnalystId !== analystId
      ) {
        throw new HandoffAccessError();
      }
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Handoff"
        WHERE id = ${handoffId}::uuid
        FOR UPDATE
      `;
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Conversation"
        WHERE id = ${handoff.conversationId}::uuid
          AND "employeeId" = ${handoff.employeeId}::uuid
        FOR UPDATE
      `;
      const currentHandoff = await transaction.handoff.findUniqueOrThrow({
        where: { id: handoffId },
      });
      if (
        currentHandoff.status !== HandoffStatus.analyst_assigned ||
        currentHandoff.assignedAnalystId !== analystId
      ) {
        throw new HandoffAccessError();
      }
      const lastMessage = await transaction.message.findFirst({
        where: {
          employeeId: handoff.employeeId,
          conversationId: handoff.conversationId,
        },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const now = new Date();
      const message = await transaction.message.create({
        data: {
          employeeId: handoff.employeeId,
          conversationId: handoff.conversationId,
          sequence: (lastMessage?.sequence ?? -1) + 1,
          actorType: MessageActorType.analyst,
          actorId: analystId,
          content,
          createdAt: now,
        },
        select: { id: true, createdAt: true },
      });
      await transaction.conversation.update({
        where: {
          id_employeeId: {
            id: handoff.conversationId,
            employeeId: handoff.employeeId,
          },
        },
        data: { messageCount: { increment: 1 } },
      });
      await transaction.handoffEvent.create({
        data: {
          employeeId: handoff.employeeId,
          handoffId,
          action: "message_sent",
          actorType: HandoffActorType.analyst,
          actorId: analystId,
          reason: "Analyst sent a conversation message.",
          metadata: jsonValue({ messageId: message.id }),
        },
      });
      return message;
    });
  }

  async transition(
    analystId: string,
    handoffId: string,
    nextStatus: Extract<HandoffStatus, "agent_resumed" | "resolved" | "closed">,
    reason: string,
  ): Promise<void> {
    await withAnalystScope(analystId, async (transaction) => {
      const handoff = await transaction.handoff.findUnique({
        where: { id: handoffId },
      });
      if (!handoff) throw new HandoffNotFoundError();
      if (handoff.assignedAnalystId !== analystId) {
        throw new HandoffAccessError();
      }
      assertHandoffTransition(handoff.status, nextStatus);

      const updated = await transaction.handoff.updateMany({
        where: {
          id: handoffId,
          status: handoff.status,
          assignedAnalystId: analystId,
        },
        data: {
          status: nextStatus,
          ...(nextStatus === HandoffStatus.resolved ||
          nextStatus === HandoffStatus.closed
            ? { completedAt: new Date() }
            : {}),
        },
      });
      if (updated.count !== 1) {
        throw new InvalidHandoffTransitionError(
          "Handoff state changed before transition.",
        );
      }
      const conversationStatus =
        nextStatus === HandoffStatus.agent_resumed
          ? ConversationStatus.agent_resumed
          : nextStatus === HandoffStatus.resolved
            ? ConversationStatus.resolved
            : ConversationStatus.closed;
      const conversationUpdate = await transaction.conversation.updateMany({
        where: {
          id: handoff.conversationId,
          employeeId: handoff.employeeId,
          status:
            handoff.status === HandoffStatus.analyst_assigned
              ? ConversationStatus.analyst_assigned
              : handoff.status === HandoffStatus.agent_resumed
                ? ConversationStatus.agent_resumed
                : ConversationStatus.resolved,
        },
        data: {
          status: conversationStatus,
          agentStatus:
            nextStatus === HandoffStatus.agent_resumed
              ? AgentStatus.active
              : AgentStatus.completed,
          ...(nextStatus === HandoffStatus.closed
            ? { closedAt: new Date() }
            : {}),
        },
      });
      if (conversationUpdate.count !== 1) {
        throw new InvalidHandoffTransitionError(
          "Conversation state changed before handoff transition.",
        );
      }
      await transaction.handoffEvent.create({
        data: {
          employeeId: handoff.employeeId,
          handoffId,
          action: nextStatus,
          actorType: HandoffActorType.analyst,
          actorId: analystId,
          reason,
        },
      });
    });
  }
}
