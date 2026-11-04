import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withEmployeeScope } from "@nexo-assist/database";
import {
  ReopenWindowExpiredError,
  TicketNotFoundError,
} from "../../shared/errors/ticket-errors.js";
import { TicketService } from "./tickets.service.js";

const employeeId = randomUUID();
const otherEmployeeId = randomUUID();
let now = new Date("2026-10-30T15:00:00.000Z");
let publicKeyCount = 0;
const service = new TicketService(
  () => new Date(now),
  (type) => `${type}-IT-${++publicKeyCount}`,
);

describe.sequential("Ticket Service PostgreSQL integration", () => {
  beforeAll(async () => {
    for (const id of [employeeId, otherEmployeeId]) {
      await withEmployeeScope(id, (transaction) =>
        transaction.employee.create({
          data: {
            id,
            email: `${id}@integration.test`,
            name: "Ticket Integration Employee",
          },
        }),
      );
    }
  });

  afterAll(async () => {
    for (const id of [employeeId, otherEmployeeId]) {
      await withEmployeeScope(id, async (transaction) => {
        await transaction.ticketHistory.deleteMany({
          where: { employeeId: id },
        });
        await transaction.ticketIdempotency.deleteMany({
          where: { employeeId: id },
        });
        await transaction.ticket.deleteMany({ where: { employeeId: id } });
        await transaction.employee.delete({ where: { id } });
      });
    }
    await prisma.$disconnect();
  });

  it("creates an owned ticket with an SLA and records history", async () => {
    const ticket = await service.createTicket(
      employeeId,
      {
        title: "VPN autenticação indisponível",
        description: "Não consigo autenticar na VPN da empresa.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
      },
      randomUUID(),
    );

    expect(ticket.id).toBeDefined();
    expect(ticket.priority).toBe("Alta");
    expect(ticket.dueAt).toEqual(new Date("2026-11-02T11:00:00.000Z"));
    expect(ticket.history).toHaveLength(1);
    expect(ticket.history[0]?.action).toBe("created");
  });

  it("replays idempotent creates and updates duplicate open tickets", async () => {
    const idempotencyKey = randomUUID();
    const input = {
      title: "Acesso ao sistema ERP falhando",
      description: "O ERP não aceita minha senha corporativa.",
      type: "INC" as const,
      category: "Acesso" as const,
      priority: "Média" as const,
    };
    const created = await service.createTicket(
      employeeId,
      input,
      idempotencyKey,
    );
    const replay = await service.createTicket(
      employeeId,
      input,
      idempotencyKey,
    );
    const duplicate = await service.createTicket(
      employeeId,
      { ...input, title: "acesso ao sistema ERP falhando!" },
      randomUUID(),
    );
    const tickets = await withEmployeeScope(employeeId, (transaction) =>
      transaction.ticket.findMany({
        where: { employeeId, title: { contains: "ERP" } },
      }),
    );

    expect(replay.id).toBe(created.id);
    expect(replay.replayed).toBe(true);
    expect(duplicate.id).toBe(created.id);
    expect(duplicate.duplicateUpdated).toBe(true);
    expect(tickets).toHaveLength(1);
    expect(duplicate.history).toHaveLength(2);
    expect(duplicate.history[0]?.action).toBe("duplicate_updated");
  });

  it("updates only owned tickets and detects stale versions", async () => {
    const created = await service.createTicket(
      employeeId,
      {
        title: "Instalar ferramenta de design",
        description: "Solicito instalação do editor de design aprovado.",
        type: "REQ",
        category: "Software",
        priority: "Baixa",
      },
      randomUUID(),
    );
    const updated = await service.patchTicket(
      employeeId,
      created.id,
      { expectedVersion: 1, title: "Instalar editor de design aprovado" },
      randomUUID(),
    );

    expect(updated.version).toBe(2);
    expect(updated.history[0]?.action).toBe("updated");
    await expect(
      service.getTicket(otherEmployeeId, created.id),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
    await expect(
      service.patchTicket(
        employeeId,
        created.id,
        { expectedVersion: 1, title: "Versão antiga deve falhar" },
        randomUUID(),
      ),
    ).rejects.toThrow("version is stale");
  });

  it("reopens resolved tickets only within the seven-day window", async () => {
    const created = await service.createTicket(
      employeeId,
      {
        title: "Acesso bloqueado no sistema financeiro",
        description: "Minha conta de acesso foi bloqueada no sistema.",
        type: "INC",
        category: "Acesso",
        priority: "Alta",
      },
      randomUUID(),
    );
    await service.patchTicket(
      employeeId,
      created.id,
      { expectedVersion: 1, status: "resolved" },
      randomUUID(),
    );
    const reopened = await service.reopenTicket(
      employeeId,
      created.id,
      randomUUID(),
    );

    expect(reopened.statusCode).toBe("open");
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.history[0]?.action).toBe("reopened");
  });

  it("allows reopening exactly seven days after resolution", async () => {
    const created = await service.createTicket(
      employeeId,
      {
        title: "Acesso ao calendário corporativo",
        description: "O acesso ao calendário foi encerrado por engano.",
        type: "INC",
        category: "Acesso",
        priority: "Média",
      },
      randomUUID(),
    );
    await service.patchTicket(
      employeeId,
      created.id,
      { expectedVersion: 1, status: "resolved" },
      randomUUID(),
    );
    now = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const reopened = await service.reopenTicket(
      employeeId,
      created.id,
      randomUUID(),
    );

    expect(reopened.statusCode).toBe("open");
    expect(reopened.history[0]?.action).toBe("reopened");
  });

  it("rejects reopening outside seven days and keeps history immutable", async () => {
    const created = await service.createTicket(
      employeeId,
      {
        title: "Atualização do cliente de e-mail",
        description: "Preciso atualizar o cliente de e-mail corporativo.",
        type: "REQ",
        category: "E-mail",
        priority: "Baixa",
      },
      randomUUID(),
    );
    await service.patchTicket(
      employeeId,
      created.id,
      { expectedVersion: 1, status: "resolved" },
      randomUUID(),
    );
    now = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);

    await expect(
      service.reopenTicket(employeeId, created.id, randomUUID()),
    ).rejects.toBeInstanceOf(ReopenWindowExpiredError);

    const historyCount = await withEmployeeScope(employeeId, (transaction) =>
      transaction.ticketHistory.count({ where: { ticketId: created.id } }),
    );
    expect(historyCount).toBe(2);
  });
});
