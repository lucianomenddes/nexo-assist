import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TicketPriority, TicketStatus } from "@prisma/client";
import { buildServer } from "./server.js";
import { TicketService } from "./ticket-service.js";

const employeeId = "00000000-0000-4000-8000-000000000001";
const otherEmployeeId = "00000000-0000-4000-8000-000000000002";
const ticketId = "00000000-0000-4000-8000-000000000003";
const auth = {
  secret: "unit-test-secret-that-is-long-enough",
  issuer: "https://issuer.test",
  audience: "ticket-service-test",
};
const bearer = (token: string) => ["Bearer", token].join(" ");

const ticketResponse = {
  id: ticketId,
  publicKey: "INC-20311",
  title: "VPN sem acesso",
  description: "A VPN corporativa não conecta desde o início do expediente.",
  type: "INC" as const,
  category: "Rede e VPN",
  priority: "Alta",
  priorityCode: TicketPriority.high,
  status: "Aberto",
  statusCode: TicketStatus.open,
  affectedEmployeeId: employeeId,
  dueAt: new Date("2026-11-03T12:00:00.000Z"),
  overdue: false,
  version: 1,
  createdAt: new Date("2026-11-02T12:00:00.000Z"),
  updatedAt: new Date("2026-11-02T12:00:00.000Z"),
  resolvedAt: null,
  history: [],
  duplicateUpdated: false,
};

describe("Ticket Service HTTP E2E contracts", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer(async () => {}, { auth });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await server.close();
  });

  it("uses the JWT employee subject for profile, list, search and ticket reads", async () => {
    const getEmployee = vi
      .spyOn(TicketService.prototype, "getEmployee")
      .mockResolvedValue({
        id: employeeId,
        email: "employee@nexo.example",
        name: "Funcionário de teste",
        department: "TI",
        active: true,
      });
    const listTickets = vi
      .spyOn(TicketService.prototype, "listTickets")
      .mockResolvedValue({ items: [ticketResponse], nextCursor: null });
    const searchTickets = vi
      .spyOn(TicketService.prototype, "searchTickets")
      .mockResolvedValue([ticketResponse]);
    const getTicket = vi
      .spyOn(TicketService.prototype, "getTicket")
      .mockResolvedValue(ticketResponse);
    await server.ready();
    const token = server.jwt.sign({ role: "employee", sub: employeeId });
    const headers = { authorization: bearer(token) };

    const profile = await server.inject({
      method: "GET",
      url: `/employees/me?employeeId=${otherEmployeeId}`,
      headers,
    });
    const list = await server.inject({
      method: "GET",
      url: `/tickets?employeeId=${otherEmployeeId}&limit=10`,
      headers,
    });
    const search = await server.inject({
      method: "GET",
      url: `/tickets/search?q=VPN&employeeId=${otherEmployeeId}`,
      headers,
    });
    const detail = await server.inject({
      method: "GET",
      url: `/tickets/${ticketId}?employeeId=${otherEmployeeId}`,
      headers,
    });

    expect(profile.statusCode).toBe(200);
    expect(list.json().items).toHaveLength(1);
    expect(search.json()).toHaveLength(1);
    expect(detail.json()).toMatchObject({ publicKey: "INC-20311" });
    expect(getEmployee).toHaveBeenCalledWith(employeeId);
    expect(listTickets).toHaveBeenCalledWith(
      employeeId,
      expect.objectContaining({ limit: 10 }),
    );
    expect(searchTickets).toHaveBeenCalledWith(employeeId, "VPN", 20);
    expect(getTicket).toHaveBeenCalledWith(employeeId, ticketId);
  });

  it("completes confirmed create, update and reopen HTTP commands with service identity", async () => {
    const createTicket = vi
      .spyOn(TicketService.prototype, "createTicket")
      .mockResolvedValue(ticketResponse);
    const patchTicket = vi
      .spyOn(TicketService.prototype, "patchTicket")
      .mockResolvedValue(ticketResponse);
    const reopenTicket = vi
      .spyOn(TicketService.prototype, "reopenTicket")
      .mockResolvedValue(ticketResponse);
    await server.ready();
    const token = server.jwt.sign({
      role: "service",
      employeeId,
    });
    const headers = {
      authorization: bearer(token),
      "idempotency-key": "e2e-ticket-operation-01",
    };
    const createBody = {
      title: ticketResponse.title,
      description: ticketResponse.description,
      type: "INC",
      category: "Rede e VPN",
      priority: "Alta",
      affectedEmployeeId: employeeId,
    };

    const created = await server.inject({
      method: "POST",
      url: "/tickets",
      headers,
      payload: createBody,
    });
    const updated = await server.inject({
      method: "PATCH",
      url: `/tickets/${ticketId}`,
      headers: { ...headers, "idempotency-key": "e2e-ticket-operation-02" },
      payload: { expectedVersion: 1, description: "Atualização detalhada." },
    });
    const reopened = await server.inject({
      method: "POST",
      url: `/tickets/${ticketId}/reopen`,
      headers: { ...headers, "idempotency-key": "e2e-ticket-operation-03" },
    });

    expect(created.statusCode).toBe(201);
    expect(updated.statusCode).toBe(200);
    expect(reopened.statusCode).toBe(200);
    expect(createTicket).toHaveBeenCalledWith(
      employeeId,
      expect.objectContaining({ affectedEmployeeId: employeeId }),
      "e2e-ticket-operation-01",
    );
    expect(patchTicket).toHaveBeenCalledWith(
      employeeId,
      ticketId,
      expect.objectContaining({ expectedVersion: 1 }),
      "e2e-ticket-operation-02",
    );
    expect(reopenTicket).toHaveBeenCalledWith(
      employeeId,
      ticketId,
      "e2e-ticket-operation-03",
    );
  });

  it("rejects employee write attempts, invalid request bodies, and missing idempotency keys", async () => {
    const createTicket = vi.spyOn(TicketService.prototype, "createTicket");
    await server.ready();
    const token = server.jwt.sign({ role: "employee", sub: employeeId });
    const baseHeaders = { authorization: bearer(token) };
    const validBody = {
      title: ticketResponse.title,
      description: ticketResponse.description,
      type: "INC",
      category: "Rede e VPN",
      priority: "Alta",
    };

    const employeeWrite = await server.inject({
      method: "POST",
      url: "/tickets",
      headers: {
        ...baseHeaders,
        "idempotency-key": "e2e-forbidden-write",
      },
      payload: validBody,
    });
    const invalidBody = await server.inject({
      method: "POST",
      url: "/tickets",
      headers: {
        authorization: bearer(server.jwt.sign({ role: "service", employeeId })),
        "idempotency-key": "e2e-invalid-payload",
      },
      payload: { ...validBody, category: "People Operations" },
    });
    const missingKey = await server.inject({
      method: "POST",
      url: "/tickets",
      headers: {
        authorization: bearer(token),
      },
      payload: validBody,
    });

    expect(employeeWrite.statusCode).toBe(403);
    expect(invalidBody.statusCode).toBe(400);
    expect(missingKey.statusCode).toBe(400);
    expect(createTicket).not.toHaveBeenCalled();
  });
});
