import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./index.js";

describe("loadEnvironment", () => {
  it("uses local development defaults", () => {
    const environment = loadEnvironment({});

    expect(environment.NODE_ENV).toBe("development");
    expect(environment.AGENT_PORT).toBe(4111);
    expect(environment.TICKET_SERVICE_PORT).toBe(4112);
    expect(environment.GROQ_MODEL).toBe("groq/openai/gpt-oss-20b");
    expect(environment.WEB_ORIGIN).toBe("http://localhost:3000");
  });

  it("allows overriding the Groq model and API key", () => {
    const environment = loadEnvironment({
      GROQ_API_KEY: "groq-test-key",
      GROQ_MODEL: "groq/openai/gpt-oss-120b",
    });

    expect(environment.GROQ_API_KEY).toBe("groq-test-key");
    expect(environment.GROQ_MODEL).toBe("groq/openai/gpt-oss-120b");
  });

  it("treats empty optional provider keys as unset", () => {
    const environment = loadEnvironment({
      GROQ_API_KEY: "",
      OPENAI_API_KEY: "",
    });

    expect(environment.GROQ_API_KEY).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
  });

  it("rejects invalid port values with a useful message", () => {
    expect(() => loadEnvironment({ AGENT_PORT: "70000" })).toThrow(
      "AGENT_PORT",
    );
  });
});
