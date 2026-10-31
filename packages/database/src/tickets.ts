import { createHash } from "node:crypto";
import {
  MessageActorType,
  Prisma,
  TicketPriority,
  TicketType,
} from "@prisma/client";
import { withEmployeeScope } from "./scope.js";

export interface CreateTicketCommand {
  employeeId: string;
  idempotencyKey: string;
  publicKey: string;
  affectedEmployeeId: string;
  title: string;
  description: string;
  type: TicketType;
  category: string;
  priority: TicketPriority;
  dueAt?: Date | null;
  actorType: MessageActorType;
  actorId?: string | null;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different request.");
    this.name = "IdempotencyConflictError";
  }
}

const operation = "ticket.create";

function getRequestHash(command: CreateTicketCommand): string {
  const request = {
    employeeId: command.employeeId,
    publicKey: command.publicKey,
    affectedEmployeeId: command.affectedEmployeeId,
    title: command.title,
    description: command.description,
    type: command.type,
    category: command.category,
    priority: command.priority,
    dueAt: command.dueAt?.toISOString() ?? null,
    actorType: command.actorType,
    actorId: command.actorId ?? null,
  };

  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function findIdempotencyRecord(
  transaction: Prisma.TransactionClient,
  employeeId: string,
  key: string,
) {
  return transaction.ticketIdempotency.findUnique({
    where: {
      employeeId_operation_key: {
        employeeId,
        operation,
        key,
      },
    },
    include: { ticket: true },
  });
}

async function replayOrThrow(
  employeeId: string,
  key: string,
  requestHash: string,
) {
  return withEmployeeScope(employeeId, async (transaction) => {
    const record = await findIdempotencyRecord(transaction, employeeId, key);

    if (!record) {
      return null;
    }

    if (record.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }

    if (!record.ticket) {
      throw new Error("Completed idempotency record has no associated ticket.");
    }

    return { ticket: record.ticket, replayed: true };
  });
}

export async function createTicketIdempotently(command: CreateTicketCommand) {
  const requestHash = getRequestHash(command);

  try {
    return await withEmployeeScope(command.employeeId, async (transaction) => {
      const existing = await findIdempotencyRecord(
        transaction,
        command.employeeId,
        command.idempotencyKey,
      );

      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }

        if (!existing.ticket) {
          throw new Error(
            "Completed idempotency record has no associated ticket.",
          );
        }

        return { ticket: existing.ticket, replayed: true };
      }

      const changes = {
        publicKey: command.publicKey,
        status: "open",
        title: command.title,
      } satisfies Prisma.InputJsonObject;

      const ticket = await transaction.ticket.create({
        data: {
          publicKey: command.publicKey,
          employeeId: command.employeeId,
          affectedEmployeeId: command.affectedEmployeeId,
          title: command.title,
          description: command.description,
          type: command.type,
          category: command.category,
          priority: command.priority,
          dueAt: command.dueAt ?? null,
          history: {
            create: {
              actorType: command.actorType,
              actorId: command.actorId ?? null,
              action: "created",
              changes,
              idempotencyKey: command.idempotencyKey,
              requestHash,
            },
          },
        },
      });

      await transaction.ticketIdempotency.create({
        data: {
          employeeId: command.employeeId,
          operation,
          key: command.idempotencyKey,
          requestHash,
          ticketId: ticket.id,
          response: { ticketId: ticket.id, publicKey: ticket.publicKey },
          completedAt: new Date(),
        },
      });

      return { ticket, replayed: false };
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }

    const replay = await replayOrThrow(
      command.employeeId,
      command.idempotencyKey,
      requestHash,
    );

    if (!replay) {
      throw error;
    }

    return replay;
  }
}
