import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentEvaluationDatasetSchema,
  scoreAgentEvaluationCase,
  type AgentEvaluationObservation,
} from "./agent-evaluation.js";

const dataset = agentEvaluationDatasetSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../evals/agent-behavior.json", import.meta.url),
      "utf8",
    ),
  ) as unknown,
);

describe("PRD-based agent behavior evaluation dataset", () => {
  it("covers every supported intent and has unique, non-empty cases", () => {
    const intents = new Set(
      dataset.cases.map(({ expectedIntent }) => expectedIntent),
    );
    expect(intents).toEqual(
      new Set([
        "KNOWLEDGE_QUERY",
        "TICKET_CREATE",
        "TICKET_UPDATE",
        "TICKET_STATUS",
        "TICKET_REOPEN",
        "HUMAN_HANDOFF",
        "OUT_OF_SCOPE",
      ]),
    );
    expect(new Set(dataset.cases.map(({ id }) => id)).size).toBe(
      dataset.cases.length,
    );
    expect(dataset.cases.length).toBeGreaterThanOrEqual(20);
  });

  it("scores each golden observation deterministically without calling an LLM", () => {
    const scores = dataset.cases.map((testCase) => {
      const awaitingConfirmation =
        testCase.expectedExecutionStatus === "awaiting_confirmation";
      const observed: AgentEvaluationObservation = {
        intent: testCase.expectedIntent,
        executionStatus: testCase.expectedExecutionStatus ?? "succeeded",
        selectedTool:
          testCase.expectedTool === undefined ? null : testCase.expectedTool,
        writePerformed: testCase.requiresConfirmation && !awaitingConfirmation,
        confirmationReceived:
          testCase.requiresConfirmation && !awaitingConfirmation,
        handoffRequested: testCase.requiresHandoff,
        employeeId: testCase.ownerScoped ? "employee-a" : undefined,
        ticketEmployeeId: testCase.ownerScoped ? "employee-a" : undefined,
        sourceCount: testCase.requiresKnowledgeEvidence ? 1 : 0,
        answerAbstained: testCase.expectedAbstention,
      };
      return scoreAgentEvaluationCase(testCase, observed);
    });

    expect(scores.every(({ passed }) => passed)).toBe(true);
    expect(
      scores.reduce((passed, score) => passed + Number(score.passed), 0),
    ).toBe(dataset.cases.length);
  });

  it("fails safely on unconfirmed writes and cross-employee ticket observations", () => {
    const protectedCase = dataset.cases.find(
      ({ id }) => id === "ticket-update-owned",
    );
    expect(protectedCase).toBeDefined();
    if (!protectedCase) return;

    const unsafeObservation: AgentEvaluationObservation = {
      intent: protectedCase.expectedIntent,
      executionStatus: "succeeded",
      selectedTool: "prepare_ticket_draft",
      writePerformed: true,
      confirmationReceived: false,
      handoffRequested: false,
      employeeId: "employee-a",
      ticketEmployeeId: "employee-b",
      sourceCount: 0,
      answerAbstained: false,
    };
    const score = scoreAgentEvaluationCase(protectedCase, unsafeObservation);

    expect(score.passed).toBe(false);
    expect(score.checks.confirmationSafety).toBe(false);
    expect(score.checks.ownership).toBe(false);
  });
});
