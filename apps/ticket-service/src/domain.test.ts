import { describe, expect, it } from "vitest";
import {
  createTicketSchema,
  patchTicketSchema,
  ticketCategories,
} from "./domain.js";
import { isDuplicateTicket } from "./ticket-service.js";
import { calculateSlaDueAt, isSlaOverdue } from "./sla.js";
import { TicketPriority } from "@prisma/client";

describe("ticket domain validation", () => {
  it("supports only the PRD ticket categories and required fields", () => {
    expect(ticketCategories).toEqual([
      "Acesso",
      "Rede e VPN",
      "Hardware",
      "Software",
      "E-mail",
      "Outros",
    ]);

    expect(
      createTicketSchema.safeParse({
        title: "VPN sem acesso",
        description: "Não consigo conectar à VPN corporativa.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
      }).success,
    ).toBe(true);

    expect(
      createTicketSchema.safeParse({
        title: "VPN",
        description: "Curto",
        type: "BAD",
        category: "RH",
        priority: "Urgente",
      }).success,
    ).toBe(false);
  });

  it("rejects employeeId sent in the request body", () => {
    expect(
      createTicketSchema.safeParse({
        title: "VPN sem acesso",
        description: "Não consigo conectar à VPN corporativa.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
        employeeId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
  });

  it("requires optimistic versioning and at least one patch field", () => {
    expect(patchTicketSchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      patchTicketSchema.safeParse({
        expectedVersion: 1,
        priority: "Crítica",
      }).success,
    ).toBe(true);
  });
});

describe("ticket duplication", () => {
  it("detects title duplicates after case, accent, and punctuation normalization", () => {
    expect(
      isDuplicateTicket(
        { title: "Erro de VPN!", description: "Falha de autenticação." },
        { title: "erro de vpn", description: "A VPN está indisponível." },
      ),
    ).toBe(true);
  });

  it("does not treat unrelated short descriptions as duplicates", () => {
    expect(
      isDuplicateTicket(
        { title: "Acesso ao SAP", description: "Erro no login." },
        { title: "Acesso ao e-mail", description: "Erro no login." },
      ),
    ).toBe(false);
  });
});

describe("ticket SLA", () => {
  it("uses a one-hour elapsed-time deadline for critical tickets", () => {
    const start = new Date("2026-10-31T23:30:00.000Z");
    expect(calculateSlaDueAt(TicketPriority.critical, start)).toEqual(
      new Date("2026-11-01T00:30:00.000Z"),
    );
  });

  it("adds high-priority time only during configured weekday business hours", () => {
    const friday = new Date("2026-10-30T15:00:00.000Z");
    expect(calculateSlaDueAt(TicketPriority.high, friday)).toEqual(
      new Date("2026-11-02T11:00:00.000Z"),
    );
  });

  it("compares SLA deadline to the current time", () => {
    const dueAt = new Date("2026-10-30T12:00:00.000Z");
    expect(isSlaOverdue(dueAt, new Date("2026-10-30T12:00:01.000Z"))).toBe(
      true,
    );
    expect(isSlaOverdue(dueAt, new Date("2026-10-30T12:00:00.000Z"))).toBe(
      false,
    );
    expect(isSlaOverdue(null, new Date())).toBe(false);
  });
});
