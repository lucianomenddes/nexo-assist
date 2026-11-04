import { createHash, randomUUID } from "node:crypto";
import { MessageActorType, Prisma, TicketStatus } from "@prisma/client";
import { IdempotencyConflictError } from "@nexo-assist/database";
import { ticketRepository } from "./tickets.repository.js";
import {
  ticketDomainPriority,
  ticketDomainType,
  ticketDisplayPriority,
  ticketDisplayStatus,
} from "./tickets.schema.js";
import {
  EmployeeNotFoundError,
  InvalidTicketStateError,
  ReopenWindowExpiredError,
  TicketConflictError,
  TicketNotFoundError,
} from "../../shared/errors/ticket-errors.js";
import { calculateSlaDueAt, isSlaOverdue } from "../../shared/utils/sla.js";

const activeStatuses: TicketStatus[] = [
  TicketStatus.open,
  TicketStatus.awaiting_analyst,
];
const idempotencyOperationByAction = {
  create: "ticket.create.api",
  patch: "ticket.patch.api",
  reopen: "ticket.reopen.api",
} as const;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

type TicketRecord = Prisma.TicketGetPayload<{
  include: { history: { orderBy: { createdAt: "desc" } } };
}>;

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function storedDuplicateFlag(value: Prisma.JsonValue | null): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.duplicateUpdated === true;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isDuplicateTicket(
  existing: { title: string; description: string },
  incoming: { title: string; description: string },
): boolean {
  const existingTitle = normalizeText(existing.title);
  const incomingTitle = normalizeText(incoming.title);
  const existingDescription = normalizeText(existing.description);
  const incomingDescription = normalizeText(incoming.description);

  return (
    existingTitle === incomingTitle ||
    (existingDescription.length >= 20 &&
      existingDescription === incomingDescription)
  );
}

function toTicketResponse(
  ticket: TicketRecord,
  now: Date,
  replayed = false,
  duplicateUpdated = false,
) {
  return {
    id: ticket.id,
    publicKey: ticket.publicKey,
    title: ticket.title,
    description: ticket.description,
    type: ticket.type,
    category: ticket.category,
    priority: ticketDisplayPriority[ticket.priority],
    priorityCode: ticket.priority,
    status: ticketDisplayStatus[ticket.status],
    statusCode: ticket.status,
    affectedEmployeeId: ticket.affectedEmployeeId,
    dueAt: ticket.dueAt,
    overdue: isSlaOverdue(ticket.dueAt, now),
    version: ticket.version,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt,
    history: ticket.history.map((entry) => ({
      id: entry.id,
      actorType: entry.actorType,
      action: entry.action,
      changes: entry.changes,
      createdAt: entry.createdAt,
    })),
    ...(replayed ? { replayed: true } : {}),
    duplicateUpdated,
  };
}

async function lockEmployee(
  transaction: Prisma.TransactionClient,
  employeeId: string,
): Promise<void> {
  await transaction.$queryRaw<string[]>`
    SELECT pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))::text AS lock
  `;
}

async function getIdempotentReplay(
  employeeId: string,
  operation: string,
  key: string,
  hash: string,
) {
  return ticketRepository.withEmployeeScope(employeeId, async (transaction) => {
    const record = await transaction.ticketIdempotency.findUnique({
      where: {
        employeeId_operation_key: { employeeId, operation, key },
      },
    });

    if (!record) return null;
    if (record.requestHash !== hash) throw new IdempotencyConflictError();
    if (!record.ticketId) {
      throw new Error("Completed idempotency record has no ticket.");
    }

    const ticket = await transaction.ticket.findUnique({
      where: {
        id_employeeId: { id: record.ticketId, employeeId },
      },
      include: { history: { orderBy: { createdAt: "desc" } } },
    });

    if (!ticket) throw new Error("Idempotent ticket result no longer exists.");
    return {
      ...toTicketResponse(ticket, new Date(), true),
      duplicateUpdated: storedDuplicateFlag(record.response),
    };
  });
}

async function saveIdempotencyResult(
  transaction: Prisma.TransactionClient,
  input: {
    employeeId: string;
    operation: string;
    key: string;
    requestHash: string;
    ticketId: string;
    result: unknown;
  },
): Promise<void> {
  await transaction.ticketIdempotency.create({
    data: {
      employeeId: input.employeeId,
      operation: input.operation,
      key: input.key,
      requestHash: input.requestHash,
      ticketId: input.ticketId,
      response: input.result as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

export class TicketService {
  private readonly now: () => Date;
  private readonly publicKeyFactory: (type: "INC" | "REQ") => string;

  constructor(
    now: () => Date = () => new Date(),
    publicKeyFactory: (type: "INC" | "REQ") => string = (type) =>
      `${type}-${randomUUID().slice(0, 8).toUpperCase()}`,
  ) {
    this.now = now;
    this.publicKeyFactory = publicKeyFactory;
  }

  async getEmployee(employeeId: string) {
    return ticketRepository.withEmployeeScope(
      employeeId,
      async (transaction) => {
        const employee = await transaction.employee.findUnique({
          where: { id: employeeId },
          select: {
            id: true,
            email: true,
            name: true,
            department: true,
            active: true,
          },
        });

        if (!employee?.active) throw new EmployeeNotFoundError();
        return employee;
      },
    );
  }

  async listTickets(
    employeeId: string,
    query: import("./tickets.schema.js").TicketListQuery,
  ) {
    await this.getEmployee(employeeId);
    return ticketRepository.withEmployeeScope(
      employeeId,
      async (transaction) => {
        const tickets = await transaction.ticket.findMany({
          where: {
            employeeId,
            ...(query.status ? { status: query.status } : {}),
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: query.limit + 1,
          ...(query.cursor
            ? {
                cursor: { id: query.cursor },
                skip: 1,
              }
            : {}),
          include: { history: { orderBy: { createdAt: "desc" }, take: 10 } },
        });
        const hasMore = tickets.length > query.limit;
        const page = tickets.slice(0, query.limit);

        return {
          items: page.map((ticket) => toTicketResponse(ticket, this.now())),
          nextCursor: hasMore ? page.at(-1)?.id : null,
        };
      },
    );
  }

  async searchTickets(employeeId: string, query: string, limit: number) {
    await this.getEmployee(employeeId);
    return ticketRepository.withEmployeeScope(
      employeeId,
      async (transaction) => {
        const tickets = await transaction.ticket.findMany({
          where: {
            employeeId,
            OR: [
              { publicKey: { contains: query, mode: "insensitive" } },
              { title: { contains: query, mode: "insensitive" } },
              { description: { contains: query, mode: "insensitive" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          include: { history: { orderBy: { createdAt: "desc" }, take: 5 } },
        });

        return tickets.map((ticket) => toTicketResponse(ticket, this.now()));
      },
    );
  }

  async getTicket(employeeId: string, ticketId: string) {
    await this.getEmployee(employeeId);
    return ticketRepository.withEmployeeScope(
      employeeId,
      async (transaction) => {
        const ticket = await transaction.ticket.findUnique({
          where: { id_employeeId: { id: ticketId, employeeId } },
          include: { history: { orderBy: { createdAt: "desc" } } },
        });
        if (!ticket) throw new TicketNotFoundError();
        return toTicketResponse(ticket, this.now());
      },
    );
  }

  async createTicket(
    employeeId: string,
    input: import("./tickets.schema.js").CreateTicketInput,
    idempotencyKey: string,
  ) {
    await this.getEmployee(employeeId);
    const hash = requestHash(input);
    const operation = idempotencyOperationByAction.create;

    try {
      return await ticketRepository.withEmployeeScope(
        employeeId,
        async (transaction) => {
          await lockEmployee(transaction, employeeId);
          const existingRecord = await transaction.ticketIdempotency.findUnique(
            {
              where: {
                employeeId_operation_key: {
                  employeeId,
                  operation,
                  key: idempotencyKey,
                },
              },
            },
          );
          if (existingRecord) {
            if (existingRecord.requestHash !== hash)
              throw new IdempotencyConflictError();
            if (!existingRecord.ticketId)
              throw new Error("Completed idempotency record has no ticket.");
            const existingTicket = await transaction.ticket.findUniqueOrThrow({
              where: {
                id_employeeId: {
                  id: existingRecord.ticketId,
                  employeeId,
                },
              },
              include: { history: { orderBy: { createdAt: "desc" } } },
            });
            return {
              ...toTicketResponse(existingTicket, this.now(), true),
              duplicateUpdated: storedDuplicateFlag(existingRecord.response),
            };
          }

          const type = ticketDomainType[input.type];
          const priority = ticketDomainPriority[input.priority];
          const affectedEmployeeId = input.affectedEmployeeId ?? employeeId;
          const duplicateCandidates = await transaction.ticket.findMany({
            where: {
              employeeId,
              affectedEmployeeId,
              type,
              category: input.category,
              status: { in: activeStatuses },
            },
            orderBy: { updatedAt: "desc" },
            take: 100,
          });
          const duplicate = duplicateCandidates.find((candidate) =>
            isDuplicateTicket(candidate, input),
          );
          const dueAt = calculateSlaDueAt(priority, this.now());
          const changes = duplicate
            ? {
                description: {
                  from: duplicate.description,
                  to: input.description,
                },
                priority: { from: duplicate.priority, to: priority },
              }
            : {
                title: input.title,
                type,
                category: input.category,
                priority,
                affectedEmployeeId,
              };
          const ticket = duplicate
            ? await transaction.ticket.update({
                where: {
                  id_employeeId: { id: duplicate.id, employeeId },
                },
                data: {
                  description: input.description,
                  priority,
                  dueAt,
                  version: { increment: 1 },
                  history: {
                    create: {
                      actorType: MessageActorType.employee,
                      actorId: employeeId,
                      action: "duplicate_updated",
                      changes,
                      idempotencyKey: `${operation}:${idempotencyKey}`,
                      requestHash: hash,
                    },
                  },
                },
                include: { history: { orderBy: { createdAt: "desc" } } },
              })
            : await transaction.ticket.create({
                data: {
                  publicKey: this.publicKeyFactory(input.type),
                  employeeId,
                  affectedEmployeeId,
                  title: input.title,
                  description: input.description,
                  type,
                  category: input.category,
                  priority,
                  dueAt,
                  history: {
                    create: {
                      actorType: MessageActorType.employee,
                      actorId: employeeId,
                      action: "created",
                      changes,
                      idempotencyKey: `${operation}:${idempotencyKey}`,
                      requestHash: hash,
                    },
                  },
                },
                include: { history: { orderBy: { createdAt: "desc" } } },
              });
          const result = {
            ...toTicketResponse(ticket, this.now()),
            duplicateUpdated: Boolean(duplicate),
          };
          await saveIdempotencyResult(transaction, {
            employeeId,
            operation,
            key: idempotencyKey,
            requestHash: hash,
            ticketId: ticket.id,
            result,
          });
          return result;
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await getIdempotentReplay(
          employeeId,
          operation,
          idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async patchTicket(
    employeeId: string,
    ticketId: string,
    input: import("./tickets.schema.js").PatchTicketInput,
    idempotencyKey: string,
  ) {
    await this.getEmployee(employeeId);
    const hash = requestHash({ ticketId, ...input });
    const operation = idempotencyOperationByAction.patch;

    try {
      return await ticketRepository.withEmployeeScope(
        employeeId,
        async (transaction) => {
          await lockEmployee(transaction, employeeId);
          const replay = await transaction.ticketIdempotency.findUnique({
            where: {
              employeeId_operation_key: {
                employeeId,
                operation,
                key: idempotencyKey,
              },
            },
          });
          if (replay) {
            if (replay.requestHash !== hash)
              throw new IdempotencyConflictError();
            if (!replay.ticketId)
              throw new Error("Idempotent result has no ticket.");
            const ticket = await transaction.ticket.findUniqueOrThrow({
              where: { id_employeeId: { id: replay.ticketId, employeeId } },
              include: { history: { orderBy: { createdAt: "desc" } } },
            });
            return toTicketResponse(ticket, this.now(), true);
          }

          const current = await transaction.ticket.findUnique({
            where: { id_employeeId: { id: ticketId, employeeId } },
          });
          if (!current) throw new TicketNotFoundError();
          const { expectedVersion, ...fields } = input;
          if (current.version !== expectedVersion) {
            throw new TicketConflictError("Ticket version is stale.");
          }

          const data: Prisma.TicketUpdateInput = {
            ...(fields.title !== undefined ? { title: fields.title } : {}),
            ...(fields.description !== undefined
              ? { description: fields.description }
              : {}),
            ...(fields.type !== undefined
              ? { type: ticketDomainType[fields.type] }
              : {}),
            ...(fields.category !== undefined
              ? { category: fields.category }
              : {}),
            ...(fields.priority !== undefined
              ? {
                  priority: ticketDomainPriority[fields.priority],
                  dueAt: calculateSlaDueAt(
                    ticketDomainPriority[fields.priority],
                    this.now(),
                  ),
                }
              : {}),
            ...(fields.status !== undefined
              ? {
                  status: fields.status,
                  resolvedAt:
                    fields.status === TicketStatus.resolved
                      ? this.now()
                      : fields.status === TicketStatus.open
                        ? null
                        : undefined,
                }
              : {}),
            version: { increment: 1 },
            history: {
              create: {
                actorType: MessageActorType.employee,
                actorId: employeeId,
                action: "updated",
                changes: {
                  before: {
                    title: current.title,
                    description: current.description,
                    type: current.type,
                    category: current.category,
                    priority: current.priority,
                    status: current.status,
                    version: current.version,
                  },
                  after: fields,
                } satisfies Prisma.InputJsonObject,
                idempotencyKey: `${operation}:${idempotencyKey}`,
                requestHash: hash,
              },
            },
          };
          const ticket = await transaction.ticket.update({
            where: {
              id_employeeId_version: {
                id: ticketId,
                employeeId,
                version: expectedVersion,
              },
            },
            data,
            include: { history: { orderBy: { createdAt: "desc" } } },
          });
          const result = toTicketResponse(ticket, this.now());
          await saveIdempotencyResult(transaction, {
            employeeId,
            operation,
            key: idempotencyKey,
            requestHash: hash,
            ticketId,
            result,
          });
          return result;
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await getIdempotentReplay(
          employeeId,
          operation,
          idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }

  async reopenTicket(
    employeeId: string,
    ticketId: string,
    idempotencyKey: string,
  ) {
    await this.getEmployee(employeeId);
    const hash = requestHash({ ticketId, action: "reopen" });
    const operation = idempotencyOperationByAction.reopen;

    try {
      return await ticketRepository.withEmployeeScope(
        employeeId,
        async (transaction) => {
          await lockEmployee(transaction, employeeId);
          const replay = await transaction.ticketIdempotency.findUnique({
            where: {
              employeeId_operation_key: {
                employeeId,
                operation,
                key: idempotencyKey,
              },
            },
          });
          if (replay) {
            if (replay.requestHash !== hash)
              throw new IdempotencyConflictError();
            if (!replay.ticketId)
              throw new Error("Idempotent result has no ticket.");
            const ticket = await transaction.ticket.findUniqueOrThrow({
              where: { id_employeeId: { id: replay.ticketId, employeeId } },
              include: { history: { orderBy: { createdAt: "desc" } } },
            });
            return toTicketResponse(ticket, this.now(), true);
          }

          const current = await transaction.ticket.findUnique({
            where: { id_employeeId: { id: ticketId, employeeId } },
          });
          if (!current) throw new TicketNotFoundError();
          if (current.status !== TicketStatus.resolved || !current.resolvedAt) {
            throw new InvalidTicketStateError(
              "Only resolved tickets can be reopened.",
            );
          }
          const now = this.now();
          if (now.getTime() - current.resolvedAt.getTime() > sevenDaysMs) {
            throw new ReopenWindowExpiredError();
          }
          const ticket = await transaction.ticket.update({
            where: {
              id_employeeId_version: {
                id: ticketId,
                employeeId,
                version: current.version,
              },
            },
            data: {
              status: TicketStatus.open,
              resolvedAt: null,
              dueAt: calculateSlaDueAt(current.priority, now),
              version: { increment: 1 },
              history: {
                create: {
                  actorType: MessageActorType.employee,
                  actorId: employeeId,
                  action: "reopened",
                  changes: {
                    status: { from: current.status, to: TicketStatus.open },
                    version: { from: current.version, to: current.version + 1 },
                  } satisfies Prisma.InputJsonObject,
                  idempotencyKey: `${operation}:${idempotencyKey}`,
                  requestHash: hash,
                },
              },
            },
            include: { history: { orderBy: { createdAt: "desc" } } },
          });
          const result = toTicketResponse(ticket, now);
          await saveIdempotencyResult(transaction, {
            employeeId,
            operation,
            key: idempotencyKey,
            requestHash: hash,
            ticketId,
            result,
          });
          return result;
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await getIdempotentReplay(
          employeeId,
          operation,
          idempotencyKey,
          hash,
        );
        if (replay) return replay;
      }
      throw error;
    }
  }
}
