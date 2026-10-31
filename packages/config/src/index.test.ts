import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./index.js";

describe("loadEnvironment", () => {
  it("uses local development defaults", () => {
    const environment = loadEnvironment({});

    expect(environment.NODE_ENV).toBe("development");
    expect(environment.AGENT_PORT).toBe(4111);
    expect(environment.TICKET_SERVICE_PORT).toBe(4112);
  });

  it("rejects invalid port values with a useful message", () => {
    expect(() => loadEnvironment({ AGENT_PORT: "70000" })).toThrow(
      "AGENT_PORT",
    );
  });
});
