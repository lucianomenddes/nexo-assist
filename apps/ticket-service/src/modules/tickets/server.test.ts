import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../app.js";
import { TicketService } from "./tickets.service.js";

describe("ticket service health endpoints", () => {
  let server: Awaited<ReturnType<typeof buildServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("reports liveness without checking dependencies", async () => {
    server = await buildServer(async () => {
      throw new Error("database should not be checked for liveness");
    });

    const response = await server.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "ticket-service",
    });
  });

  it("reports database failures as not ready", async () => {
    server = await buildServer(async () => {
      throw new Error("database unavailable");
    });

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "error",
      dependencies: { database: "unavailable" },
    });
  });

  it("exposes the requested public health route", async () => {
    server = await buildServer(async () => {});

    const response = await server.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "ticket-service",
    });
  });

  it("requires a verified token and ignores frontend employee identity", async () => {
    server = await buildServer(async () => {});

    const response = await server.inject({
      method: "GET",
      url: "/tickets?employeeId=00000000-0000-4000-8000-000000000001",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("uses the verified JWT subject as the employee identity", async () => {
    const employeeId = "00000000-0000-4000-8000-000000000001";
    const auth = {
      secret: "unit-test-secret-that-is-long-enough",
      issuer: "https://issuer.test",
      audience: "ticket-service-test",
    };
    class IdentityTicketService extends TicketService {
      override async getEmployee(id: string) {
        return {
          id,
          email: "employee@example.test",
          name: "Test Employee",
          department: null,
          active: true,
        };
      }
    }

    server = await buildServer(async () => {}, {
      ticketService: new IdentityTicketService(),
      auth,
    });
    await server.ready();
    const token = server.jwt.sign({ role: "employee", sub: employeeId });

    const response = await server.inject({
      method: "GET",
      url: "/employees/me?employeeId=00000000-0000-4000-8000-000000000002",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: employeeId });
  });

  it("prevents employee tokens from bypassing the confirmed-write workflow", async () => {
    const auth = {
      secret: "unit-test-secret-that-is-long-enough",
      issuer: "https://issuer.test",
      audience: "ticket-service-test",
    };
    server = await buildServer(async () => {}, { auth });
    await server.ready();
    const token = server.jwt.sign({
      role: "employee",
      sub: "00000000-0000-4000-8000-000000000001",
    });

    const response = await server.inject({
      method: "POST",
      url: "/tickets",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "user-write-attempt-01",
      },
      payload: {
        title: "VPN sem acesso",
        description: "Não consigo conectar à VPN corporativa.",
        type: "INC",
        category: "Rede e VPN",
        priority: "Alta",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "FORBIDDEN" });
  });

  it("serves OpenAPI documentation without requiring an employee token", async () => {
    server = await buildServer(async () => {});

    const response = await server.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      info: { title: "Nexo Assist Ticket Service" },
    });
    expect(response.json().paths).toMatchObject({
      "/tickets/search": { get: expect.any(Object) },
      "/tickets": { get: expect.any(Object), post: expect.any(Object) },
      "/tickets/{id}": {
        get: expect.any(Object),
        patch: expect.any(Object),
      },
      "/tickets/{id}/reopen": { post: expect.any(Object) },
    });
  });
});
