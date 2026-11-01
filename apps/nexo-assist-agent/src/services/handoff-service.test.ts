import { HandoffStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  assertHandoffTransition,
  buildHandoffSummary,
  InvalidHandoffTransitionError,
} from "./handoff-service.js";

describe("handoff transitions", () => {
  it.each([
    [HandoffStatus.waiting_analyst, HandoffStatus.analyst_assigned],
    [HandoffStatus.analyst_assigned, HandoffStatus.agent_resumed],
    [HandoffStatus.analyst_assigned, HandoffStatus.resolved],
    [HandoffStatus.analyst_assigned, HandoffStatus.closed],
    [HandoffStatus.agent_resumed, HandoffStatus.resolved],
    [HandoffStatus.agent_resumed, HandoffStatus.closed],
    [HandoffStatus.resolved, HandoffStatus.closed],
  ])("allows %s -> %s", (from, to) => {
    expect(() => assertHandoffTransition(from, to)).not.toThrow();
  });

  it.each([
    [HandoffStatus.waiting_analyst, HandoffStatus.agent_resumed],
    [HandoffStatus.waiting_analyst, HandoffStatus.resolved],
    [HandoffStatus.analyst_assigned, HandoffStatus.waiting_analyst],
    [HandoffStatus.agent_resumed, HandoffStatus.analyst_assigned],
    [HandoffStatus.resolved, HandoffStatus.agent_resumed],
    [HandoffStatus.closed, HandoffStatus.resolved],
  ])("rejects %s -> %s", (from, to) => {
    expect(() => assertHandoffTransition(from, to)).toThrow(
      InvalidHandoffTransitionError,
    );
  });

  it("builds a factual handoff summary from attributed conversation messages", () => {
    const summary = buildHandoffSummary("Chamado vencido", [
      { actorType: "employee", content: "A VPN não conecta desde ontem." },
      { actorType: "assistant", content: "O procedimento não resolveu." },
    ]);

    expect(summary).toContain("Motivo da transferência: Chamado vencido");
    expect(summary).toContain("Funcionário: A VPN não conecta desde ontem.");
    expect(summary).toContain("Assistente: O procedimento não resolveu.");
  });
});
