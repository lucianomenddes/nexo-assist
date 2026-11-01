import { createHash, randomUUID } from "node:crypto";
import {
  AgentStatus,
  AuditStatus,
  ConversationStatus,
  ExecutionStatus,
  MessageActorType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { withEmployeeScope } from "@nexo-assist/database";
import {
  agentTurnResultSchema,
  type AgentTurnResult,
} from "../mastra/domain.js";
import { conversationWorkflow } from "../mastra/workflows/conversation-workflow.js";
import {
  TicketServiceClient,
  TicketServiceRequestError,
  TicketServiceUnavailableError,
} from "./ticket-service-client.js";
import { HandoffService } from "./handoff-service.js";

const maximumEmployeeMessages = 30;

export class ConversationNotFoundError extends Error {
  constructor() {
    super("Conversation not found.");
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationNotActiveError extends Error {
  constructor() {
    super("Conversation is not active for agent responses.");
    this.name = "ConversationNotActiveError";
  }
}

export class MessageLimitReachedError extends Error {
  constructor() {
    super("The conversation message limit has been reached.");
    this.name = "MessageLimitReachedError";
  }
}

export class AgentRequestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRequestConflictError";
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationRequiredError";
  }
}

export class AgentUpstreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentUpstreamError";
  }
}

type PendingDraft = {
  id: string;
  operation: "create" | "update" | "reopen" | "handoff";
  payload: Record<string, unknown>;
  summary: string;
  reason: string;
  expiresAt: string;
  status: "pending" | "confirmed";
  confirmationResult?: unknown;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function payloadHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseDraft(value: unknown): PendingDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parsed = pendingDraftRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const pendingDraftRecordSchema = z.object({
  id: z.string().uuid(),
  operation: z.enum(["create", "update", "reopen", "handoff"]),
  payload: z.record(z.string(), z.unknown()),
  summary: z.string(),
  reason: z.string(),
  expiresAt: z.string().datetime(),
  status: z.enum(["pending", "confirmed"]),
  confirmationResult: z.unknown().optional(),
});

function resultFromMessageMetadata(
  value: Prisma.JsonValue | null,
): AgentTurnResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value.result;
  const parsed = agentTurnResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export class ConversationService {
  private readonly ticketClient = new TicketServiceClient();
  private readonly handoffService = new HandoffService();

  async createConversation(employeeId: string) {
    return withEmployeeScope(employeeId, async (transaction) => {
      const employee = await transaction.employee.findUnique({
        where: { id: employeeId },
        select: { active: true },
      });
      if (!employee?.active) throw new ConversationNotFoundError();

      const conversation = await transaction.conversation.create({
        data: { employeeId },
        select: {
          id: true,
          status: true,
          agentStatus: true,
          createdAt: true,
        },
      });
      return conversation;
    });
  }

  async listConversations(employeeId: string) {
    return withEmployeeScope(employeeId, async (transaction) =>
      transaction.conversation.findMany({
        where: { employeeId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          agentStatus: true,
          createdAt: true,
          updatedAt: true,
          messageCount: true,
        },
      }),
    );
  }

  async listMessages(employeeId: string, conversationId: string) {
    return withEmployeeScope(employeeId, async (transaction) => {
      const conversation = await transaction.conversation.findUnique({
        where: {
          id_employeeId: { id: conversationId, employeeId },
        },
        select: { id: true },
      });
      if (!conversation) throw new ConversationNotFoundError();
      return transaction.message.findMany({
        where: { employeeId, conversationId },
        orderBy: { sequence: "asc" },
        take: 200,
        select: {
          id: true,
          sequence: true,
          actorType: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      });
    });
  }

  async sendMessage(
    employeeId: string,
    conversationId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<AgentTurnResult> {
    const traceId = randomUUID();
    const accepted = await this.acceptEmployeeMessage({
      employeeId,
      conversationId,
      content,
      idempotencyKey,
      traceId,
    });
    if (accepted.replay) return accepted.replay;
    if (accepted.pausedResult) return accepted.pausedResult;
    if (!accepted.recentMessages) {
      throw new Error("Accepted message is missing workflow context.");
    }

    try {
      const workflowRun = await conversationWorkflow.createRun({
        runId: traceId,
        resourceId: employeeId,
      });
      const workflowResult = await workflowRun.start({
        inputData: {
          employeeId,
          conversationId,
          traceId,
          content,
          idempotencyKey,
          recentMessages: accepted.recentMessages,
        },
        tracingOptions: {
          traceId,
          rootSpanName: "nexo.conversation.turn",
          metadata: { employeeId, conversationId },
        },
      });
      if (workflowResult.status !== "success") {
        throw new AgentUpstreamError(
          "The conversation workflow did not complete successfully.",
        );
      }
      return workflowResult.result;
    } catch (error) {
      await this.markExecutionFailed(employeeId, traceId, error);
      if (
        error instanceof TicketServiceRequestError ||
        error instanceof TicketServiceUnavailableError
      ) {
        throw new AgentUpstreamError(
          error instanceof TicketServiceRequestError
            ? `Ticket Service rejected the operation (${error.statusCode}).`
            : "Ticket Service is unavailable.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  async confirmDraft(
    employeeId: string,
    conversationId: string,
    draftId: string,
  ): Promise<AgentTurnResult> {
    const draftMessage = await withEmployeeScope(
      employeeId,
      async (transaction) => {
        await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Conversation"
        WHERE id = ${conversationId}::uuid
          AND "employeeId" = ${employeeId}::uuid
        FOR UPDATE
      `;
        const conversation = await transaction.conversation.findUnique({
          where: { id_employeeId: { id: conversationId, employeeId } },
        });
        if (!conversation) throw new ConversationNotFoundError();
        if (
          (conversation.status !== ConversationStatus.active &&
            conversation.status !== ConversationStatus.agent_resumed) ||
          conversation.agentStatus !== AgentStatus.active
        ) {
          throw new ConversationNotActiveError();
        }

        const messages = await transaction.message.findMany({
          where: {
            employeeId,
            conversationId,
            actorType: MessageActorType.assistant,
          },
          orderBy: { sequence: "desc" },
          take: 100,
          select: { id: true, metadata: true },
        });
        const match = messages.find((message) => {
          if (
            !message.metadata ||
            typeof message.metadata !== "object" ||
            Array.isArray(message.metadata)
          ) {
            return false;
          }
          const draft = parseDraft(message.metadata.pendingDraft);
          return draft?.id === draftId;
        });
        if (!match) throw new ConfirmationRequiredError("Draft not found.");

        const draft = parseDraft(
          (match.metadata as Prisma.JsonObject).pendingDraft,
        );
        if (!draft) throw new ConfirmationRequiredError("Draft is invalid.");
        if (draft.status === "confirmed") {
          const result = agentTurnResultSchema.parse(draft.confirmationResult);
          return { messageId: match.id, draft, replay: result };
        }
        if (new Date(draft.expiresAt).getTime() <= Date.now()) {
          throw new ConfirmationRequiredError("Draft has expired.");
        }
        return { messageId: match.id, draft };
      },
    );
    if (draftMessage.replay) {
      return { ...draftMessage.replay, replayed: true };
    }

    const traceId = randomUUID();
    const intent = intentByOperation[draftMessage.draft.operation];
    await this.startConfirmationExecution({
      employeeId,
      conversationId,
      traceId,
      intent,
    });

    try {
      let data: unknown;
      if (draftMessage.draft.operation === "create") {
        data = await this.ticketClient.create(
          employeeId,
          draftMessage.draft.payload,
          draftId,
        );
      } else if (draftMessage.draft.operation === "update") {
        const { ticketId, ...patch } = draftMessage.draft.payload;
        if (typeof ticketId !== "string") {
          throw new ConfirmationRequiredError(
            "Draft is missing its ticket ID.",
          );
        }
        data = await this.ticketClient.patch(
          employeeId,
          ticketId,
          patch,
          draftId,
        );
      } else if (draftMessage.draft.operation === "reopen") {
        const ticketId = draftMessage.draft.payload.ticketId;
        if (typeof ticketId !== "string") {
          throw new ConfirmationRequiredError(
            "Draft is missing its ticket ID.",
          );
        }
        data = await this.ticketClient.reopen(employeeId, ticketId, draftId);
      } else {
        data = await this.handoffService.requestEmployeeHandoff({
          employeeId,
          conversationId,
          idempotencyKey: draftMessage.draft.id,
          reason:
            typeof draftMessage.draft.payload.reason === "string"
              ? draftMessage.draft.payload.reason
              : "Solicitação do funcionário",
        });
      }

      const ticketOperation =
        draftMessage.draft.operation === "create" ||
        draftMessage.draft.operation === "update" ||
        draftMessage.draft.operation === "reopen";
      const ticketData =
        data !== null && typeof data === "object" ? data : undefined;
      const ticketIsOverdue =
        ticketData !== undefined &&
        "overdue" in ticketData &&
        ticketData.overdue === true;
      const ticketIsCritical =
        ticketData !== undefined &&
        ("priorityCode" in ticketData
          ? ticketData.priorityCode === "critical"
          : "priority" in ticketData && ticketData.priority === "Crítica");
      const ticketRequiresHandoff =
        ticketOperation && (ticketIsOverdue || ticketIsCritical);
      let ticketHandoff: Awaited<
        ReturnType<HandoffService["requestEmployeeHandoff"]>
      > | null = null;
      if (ticketRequiresHandoff) {
        const publicKey =
          ticketData && "publicKey" in ticketData
            ? String(ticketData.publicKey)
            : "Chamado";
        ticketHandoff = await this.handoffService.requestEmployeeHandoff({
          employeeId,
          conversationId,
          idempotencyKey: `ticket-handoff:${draftId}`,
          reason: ticketIsOverdue
            ? `Chamado vencido: ${publicKey}`
            : `Chamado crítico: ${publicKey}`,
        });
      }

      const confirmedResult = agentTurnResultSchema.parse({
        intent,
        selectedTool:
          draftMessage.draft.operation === "handoff"
            ? "request_human_handoff"
            : "ticket_service_write",
        executionStatus: "succeeded",
        confidence: 1,
        reason: "Operação executada após confirmação explícita do funcionário.",
        traceId,
        answer:
          draftMessage.draft.operation === "handoff"
            ? "A conversa foi transferida para a fila de analistas."
            : ticketHandoff
              ? "A operação do chamado foi concluída e a conversa foi encaminhada para a fila de analistas."
              : "A operação foi confirmada e executada pelo Ticket Service.",
        sources: [],
        data: ticketHandoff ? { ticket: data, handoff: ticketHandoff } : data,
      });
      await this.finishConfirmationExecution({
        employeeId,
        traceId,
        messageId: draftMessage.messageId,
        draft: draftMessage.draft,
        result: confirmedResult,
      });
      return confirmedResult;
    } catch (error) {
      await this.markExecutionFailed(employeeId, traceId, error);
      if (
        error instanceof TicketServiceRequestError ||
        error instanceof TicketServiceUnavailableError
      ) {
        throw new AgentUpstreamError(
          error instanceof TicketServiceRequestError
            ? `Ticket Service rejected the confirmed operation (${error.statusCode}).`
            : "Ticket Service is unavailable.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async acceptEmployeeMessage(input: {
    employeeId: string;
    conversationId: string;
    content: string;
    idempotencyKey: string;
    traceId: string;
  }): Promise<{
    replay?: AgentTurnResult;
    pausedResult?: AgentTurnResult;
    recentMessages?: {
      actor: "employee" | "assistant" | "analyst";
      content: string;
    }[];
  }> {
    const hash = payloadHash(input.content);
    return withEmployeeScope(input.employeeId, async (transaction) => {
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Conversation"
        WHERE id = ${input.conversationId}::uuid
          AND "employeeId" = ${input.employeeId}::uuid
        FOR UPDATE
      `;
      const prior = await transaction.message.findUnique({
        where: {
          employeeId_idempotencyKey: {
            employeeId: input.employeeId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { id: true, metadata: true, conversationId: true },
      });
      if (prior) {
        if (prior.conversationId !== input.conversationId) {
          throw new AgentRequestConflictError(
            "Idempotency key was already used in another conversation.",
          );
        }
        const metadata =
          prior.metadata && typeof prior.metadata === "object"
            ? (prior.metadata as Prisma.JsonObject)
            : {};
        if (metadata.requestHash !== hash) {
          throw new AgentRequestConflictError(
            "Idempotency key was reused with a different message.",
          );
        }
        const assistantMessage = await transaction.message.findUnique({
          where: {
            employeeId_idempotencyKey: {
              employeeId: input.employeeId,
              idempotencyKey: `assistant:${input.idempotencyKey}`,
            },
          },
          select: { metadata: true },
        });
        const replay = resultFromMessageMetadata(
          assistantMessage?.metadata ?? null,
        );
        if (replay) return { replay: { ...replay, replayed: true } };
        const paused = metadata.pausedResult;
        const parsedPaused = agentTurnResultSchema.safeParse(paused);
        if (parsedPaused.success) {
          return { pausedResult: { ...parsedPaused.data, replayed: true } };
        }
        throw new AgentRequestConflictError(
          "The same message is still being processed or previously failed.",
        );
      }

      const conversation = await transaction.conversation.findUnique({
        where: {
          id_employeeId: {
            id: input.conversationId,
            employeeId: input.employeeId,
          },
        },
      });
      if (!conversation) throw new ConversationNotFoundError();
      if (
        conversation.status === ConversationStatus.closed ||
        conversation.status === ConversationStatus.resolved
      ) {
        throw new ConversationNotActiveError();
      }
      if (conversation.messageCount >= maximumEmployeeMessages) {
        throw new MessageLimitReachedError();
      }

      const paused = conversation.agentStatus !== AgentStatus.active;
      const message = await transaction.message.create({
        data: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          sequence: conversation.messageCount * 2 + 1,
          actorType: MessageActorType.employee,
          content: input.content,
          idempotencyKey: input.idempotencyKey,
          metadata: jsonValue({ requestHash: hash, traceId: input.traceId }),
        },
      });
      await transaction.conversation.update({
        where: {
          id_employeeId: {
            id: input.conversationId,
            employeeId: input.employeeId,
          },
        },
        data: { messageCount: { increment: 1 } },
      });

      if (paused) {
        const pausedResult = agentTurnResultSchema.parse({
          intent: "HUMAN_HANDOFF",
          selectedTool: null,
          executionStatus: "paused",
          confidence: 1,
          reason: "Um analista está atendendo esta conversa.",
          traceId: input.traceId,
          answer: "",
          sources: [],
        });
        const execution = await transaction.agentExecution.create({
          data: {
            employeeId: input.employeeId,
            conversationId: input.conversationId,
            traceId: input.traceId,
            intent: "HUMAN_HANDOFF",
            confidence: 1,
            reason: pausedResult.reason,
            status: ExecutionStatus.cancelled,
            completedAt: new Date(),
          },
        });
        await transaction.agentAudit.create({
          data: {
            employeeId: input.employeeId,
            executionId: execution.id,
            eventType: "agent_paused",
            status: AuditStatus.skipped,
            outputSummary: "Message stored; no agent response generated.",
          },
        });
        await transaction.message.update({
          where: {
            id: message.id,
          },
          data: {
            metadata: jsonValue({
              requestHash: hash,
              traceId: input.traceId,
              pausedResult,
            }),
          },
        });
        return { pausedResult };
      }

      await transaction.agentExecution.create({
        data: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          traceId: input.traceId,
          intent: "pending",
          status: ExecutionStatus.running,
        },
      });
      const recent = await transaction.message.findMany({
        where: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
        },
        orderBy: { sequence: "desc" },
        take: 11,
        select: { actorType: true, content: true, id: true },
      });
      return {
        recentMessages: recent
          .filter((entry) => entry.id !== message.id)
          .reverse()
          .map((entry) => ({
            actor:
              entry.actorType === MessageActorType.employee
                ? ("employee" as const)
                : entry.actorType === MessageActorType.analyst
                  ? ("analyst" as const)
                  : ("assistant" as const),
            content: entry.content,
          })),
      };
    });
  }

  private async startConfirmationExecution(input: {
    employeeId: string;
    conversationId: string;
    traceId: string;
    intent: string;
  }): Promise<void> {
    await withEmployeeScope(input.employeeId, async (transaction) => {
      const execution = await transaction.agentExecution.create({
        data: {
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          traceId: input.traceId,
          intent: input.intent,
          status: ExecutionStatus.running,
        },
      });
      await transaction.agentAudit.create({
        data: {
          employeeId: input.employeeId,
          executionId: execution.id,
          eventType: "confirmation_received",
          status: AuditStatus.started,
        },
      });
    });
  }

  private async finishConfirmationExecution(input: {
    employeeId: string;
    traceId: string;
    messageId: string;
    draft: PendingDraft;
    result: AgentTurnResult;
  }): Promise<void> {
    await withEmployeeScope(input.employeeId, async (transaction) => {
      const message = await transaction.message.findUnique({
        where: {
          id: input.messageId,
        },
      });
      if (
        !message ||
        !message.metadata ||
        typeof message.metadata !== "object"
      ) {
        throw new ConfirmationRequiredError(
          "Draft message could not be loaded.",
        );
      }
      const metadata = message.metadata as Prisma.JsonObject;
      const savedDraft = parseDraft(metadata.pendingDraft);
      if (!savedDraft || savedDraft.id !== input.draft.id) {
        throw new ConfirmationRequiredError(
          "Draft changed before confirmation.",
        );
      }

      const confirmedDraft: PendingDraft = {
        ...savedDraft,
        status: "confirmed",
        confirmationResult: input.result,
      };
      await transaction.message.update({
        where: {
          id: input.messageId,
        },
        data: {
          metadata: jsonValue({
            ...metadata,
            pendingDraft: confirmedDraft,
          }),
        },
      });
      const execution = await transaction.agentExecution.updateMany({
        where: {
          employeeId: input.employeeId,
          traceId: input.traceId,
          status: ExecutionStatus.running,
        },
        data: {
          status: ExecutionStatus.succeeded,
          confidence: 1,
          reason: input.result.reason,
          completedAt: new Date(),
        },
      });
      if (execution.count !== 1) {
        throw new Error("Confirmation execution was not running.");
      }
      const record = await transaction.agentExecution.findUniqueOrThrow({
        where: {
          employeeId_traceId: {
            employeeId: input.employeeId,
            traceId: input.traceId,
          },
        },
        select: { id: true },
      });
      await transaction.agentAudit.create({
        data: {
          employeeId: input.employeeId,
          executionId: record.id,
          eventType: "confirmed_operation_completed",
          toolName: input.result.selectedTool,
          outputSummary: input.draft.operation,
          status: AuditStatus.succeeded,
        },
      });
    });
  }

  private async markExecutionFailed(
    employeeId: string,
    traceId: string,
    error: unknown,
  ): Promise<void> {
    await withEmployeeScope(employeeId, async (transaction) => {
      const updated = await transaction.agentExecution.updateMany({
        where: {
          employeeId,
          traceId,
          status: ExecutionStatus.running,
        },
        data: { status: ExecutionStatus.failed, completedAt: new Date() },
      });
      if (updated.count === 0) return;
      const record = await transaction.agentExecution.findUniqueOrThrow({
        where: { employeeId_traceId: { employeeId, traceId } },
        select: { id: true },
      });
      await transaction.agentAudit.create({
        data: {
          employeeId,
          executionId: record.id,
          eventType: "workflow_failed",
          status: AuditStatus.failed,
          outputSummary:
            error instanceof Error ? error.name : "Unknown workflow failure",
        },
      });
    });
  }
}

const intentByOperation: Record<PendingDraft["operation"], string> = {
  create: "TICKET_CREATE",
  update: "TICKET_UPDATE",
  reopen: "TICKET_REOPEN",
  handoff: "HUMAN_HANDOFF",
};
