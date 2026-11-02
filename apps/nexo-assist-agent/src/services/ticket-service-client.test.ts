import { afterEach, describe, expect, it, vi } from "vitest";
import { jwtVerify } from "jose";
import { loadEnvironment } from "@nexo-assist/config";
import {
  TicketServiceClient,
  TicketServiceUnavailableError,
} from "./ticket-service-client.js";

const employeeId = "00000000-0000-4000-8000-000000000001";
const ticketId = "00000000-0000-4000-8000-000000000002";
const ticket = {
  id: ticketId,
  publicKey: "INC-20311",
  title: "VPN sem acesso",
  description: "A VPN corporativa não conecta desde o início do expediente.",
  type: "INC",
  category: "Rede e VPN",
  priority: "Alta",
  priorityCode: "high",
  status: "Aberto",
  statusCode: "open",
  dueAt: "2026-11-03T12:00:00.000Z",
  overdue: false,
  version: 1,
  createdAt: "2026-11-02T12:00:00.000Z",
  updatedAt: "2026-11-02T12:00:00.000Z",
  resolvedAt: null,
};

describe("TicketServiceClient HTTP contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an internal short-lived service JWT scoped to the requested employee", async () => {
    const fetchMock = vi.fn(
      async (_url: URL, _init?: RequestInit) =>
        new Response(JSON.stringify([ticket]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TicketServiceClient().list(employeeId, "VPN 809");
    const [url, options] = fetchMock.mock.calls[0]!;
    const environment = loadEnvironment();
    const token = new Headers(options?.headers).get("authorization");
    expect(token).toMatch(/^Bearer /);
    const verified = await jwtVerify(
      token!.slice("Bearer ".length),
      new TextEncoder().encode(environment.AUTH_JWT_SECRET),
      {
        algorithms: ["HS256"],
        issuer: environment.AUTH_JWT_ISSUER,
        audience: environment.AUTH_JWT_AUDIENCE,
      },
    );

    expect(String(url)).toContain("/tickets/search?q=VPN%20809&limit=20");
    expect(verified.payload).toMatchObject({
      role: "service",
      employeeId,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.publicKey).toBe("INC-20311");
  });

  it("sends idempotency keys and caller data only on explicit write methods", async () => {
    let requestBody: unknown;
    let idempotencyKey: string | null = null;
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      idempotencyKey = new Headers(init?.headers).get("idempotency-key");
      return new Response(JSON.stringify(ticket), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new TicketServiceClient().create(
      employeeId,
      { title: ticket.title, type: "INC" },
      "write-idempotency-0001",
    );

    expect(result.publicKey).toBe(ticket.publicKey);
    expect(idempotencyKey).toBe("write-idempotency-0001");
    expect(requestBody).toEqual({ title: ticket.title, type: "INC" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves service errors instead of treating rejected writes as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "REOPEN_WINDOW_EXPIRED" }), {
            status: 409,
          }),
      ),
    );

    await expect(
      new TicketServiceClient().reopen(
        employeeId,
        ticketId,
        "reopen-idempotency-0001",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("reports network failures and invalid service responses as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("connection refused");
      }),
    );
    await expect(
      new TicketServiceClient().list(employeeId),
    ).rejects.toBeInstanceOf(TicketServiceUnavailableError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ invalid: true }))),
    );
    await expect(
      new TicketServiceClient().list(employeeId),
    ).rejects.toBeInstanceOf(TicketServiceUnavailableError);
  });
});
