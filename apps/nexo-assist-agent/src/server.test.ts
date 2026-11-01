import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { buildServer } from "./server.js";

describe("agent health endpoints", () => {
  let server: ReturnType<typeof buildServer> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("reports liveness without checking dependencies", async () => {
    server = buildServer(async () => {
      throw new Error("database should not be checked for liveness");
    });

    const response = await server.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "nexo-assist-agent",
    });
  });

  it("reports database failures as not ready", async () => {
    server = buildServer(async () => {
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

  it("requires authentication for conversation routes", async () => {
    server = buildServer(async () => {}, {
      auth: {
        secret: "test-jwt-secret-with-at-least-32-characters",
        issuer: "nexo-assist-test",
        audience: "nexo-assist-test-api",
      },
    });

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/conversations",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });

  it("allows CORS preflight only from the configured web origin", async () => {
    server = buildServer(async () => {});

    const response = await server.inject({
      method: "OPTIONS",
      url: "/api/v1/analyst/handoffs",
      headers: { origin: "http://localhost:3000" },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["access-control-allow-headers"]).toContain(
      "authorization",
    );

    const disallowed = await server.inject({
      method: "OPTIONS",
      url: "/api/v1/analyst/handoffs",
      headers: { origin: "https://untrusted.example" },
    });
    expect(disallowed.statusCode).toBe(204);
    expect(disallowed.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects employee tokens on analyst-only routes", async () => {
    const config = {
      secret: "test-jwt-secret-with-at-least-32-characters",
      issuer: "nexo-assist-test",
      audience: "nexo-assist-test-api",
    };
    server = buildServer(async () => {}, { auth: config });
    const token = await new SignJWT({
      role: "employee",
      sub: "00000000-0000-4000-8000-000000000001",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(config.secret));

    const response = await server.inject({
      method: "GET",
      url: "/api/v1/analyst/handoffs",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "UNAUTHORIZED" });
  });
});
