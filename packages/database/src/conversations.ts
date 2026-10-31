import { AgentStatus, ConversationStatus } from "@prisma/client";
import { withEmployeeScope } from "./scope.js";

const allowedTransitions: Record<
  ConversationStatus,
  readonly ConversationStatus[]
> = {
  [ConversationStatus.active]: [
    ConversationStatus.waiting_analyst,
    ConversationStatus.resolved,
  ],
  [ConversationStatus.waiting_analyst]: [
    ConversationStatus.analyst_assigned,
    ConversationStatus.active,
  ],
  [ConversationStatus.analyst_assigned]: [
    ConversationStatus.active,
    ConversationStatus.resolved,
  ],
  [ConversationStatus.resolved]: [ConversationStatus.closed],
  [ConversationStatus.closed]: [],
};

const agentStatusByConversation: Record<ConversationStatus, AgentStatus> = {
  [ConversationStatus.active]: AgentStatus.active,
  [ConversationStatus.waiting_analyst]: AgentStatus.paused,
  [ConversationStatus.analyst_assigned]: AgentStatus.paused,
  [ConversationStatus.resolved]: AgentStatus.completed,
  [ConversationStatus.closed]: AgentStatus.completed,
};

export class InvalidConversationTransitionError extends Error {
  constructor(from: ConversationStatus, to: ConversationStatus) {
    super(`Conversation cannot transition from "${from}" to "${to}".`);
    this.name = "InvalidConversationTransitionError";
  }
}

export class ConversationStateConflictError extends Error {
  constructor() {
    super("Conversation state changed before the requested transition.");
    this.name = "ConversationStateConflictError";
  }
}

export async function transitionConversation(input: {
  employeeId: string;
  conversationId: string;
  expectedStatus: ConversationStatus;
  nextStatus: ConversationStatus;
}) {
  const { employeeId, conversationId, expectedStatus, nextStatus } = input;

  if (!allowedTransitions[expectedStatus].includes(nextStatus)) {
    throw new InvalidConversationTransitionError(expectedStatus, nextStatus);
  }

  return withEmployeeScope(employeeId, async (transaction) => {
    const result = await transaction.conversation.updateMany({
      where: {
        id: conversationId,
        employeeId,
        status: expectedStatus,
      },
      data: {
        status: nextStatus,
        agentStatus: agentStatusByConversation[nextStatus],
        closedAt:
          nextStatus === ConversationStatus.closed ? new Date() : undefined,
      },
    });

    if (result.count !== 1) {
      throw new ConversationStateConflictError();
    }

    return transaction.conversation.findUniqueOrThrow({
      where: {
        id_employeeId: { id: conversationId, employeeId },
      },
    });
  });
}
