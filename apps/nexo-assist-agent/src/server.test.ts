import { afterEach, describe, expect, it } from "vitest";
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
});
