import { z } from "zod";

const intentNames = [
  "KNOWLEDGE_QUERY",
  "TICKET_CREATE",
  "TICKET_UPDATE",
  "TICKET_STATUS",
  "TICKET_REOPEN",
  "HUMAN_HANDOFF",
  "OUT_OF_SCOPE",
] as const;

const executionStatuses = [
  "succeeded",
  "awaiting_confirmation",
  "needs_information",
  "paused",
  "failed",
] as const;

export const agentEvaluationCaseSchema = z.object({
  id: z.string().min(1),
  message: z.string().trim().min(1),
  expectedIntent: z.enum(intentNames),
  expectedExecutionStatus: z.enum(executionStatuses).optional(),
  expectedTool: z.string().nullable().optional(),
  requiresConfirmation: z.boolean().default(false),
  requiresHandoff: z.boolean().default(false),
  ownerScoped: z.boolean().default(false),
  requiresKnowledgeEvidence: z.boolean().default(false),
  expectedAbstention: z.boolean().default(false),
});

export const agentEvaluationDatasetSchema = z.object({
  version: z.string().min(1),
  source: z.literal("PRD"),
  cases: z.array(agentEvaluationCaseSchema).min(1),
});

export type AgentEvaluationCase = z.infer<typeof agentEvaluationCaseSchema>;

export type AgentEvaluationObservation = {
  intent: (typeof intentNames)[number];
  executionStatus: (typeof executionStatuses)[number];
  selectedTool: string | null;
  writePerformed: boolean;
  confirmationReceived: boolean;
  handoffRequested: boolean;
  employeeId?: string;
  ticketEmployeeId?: string;
  sourceCount: number;
  answerAbstained: boolean;
};

export type AgentEvaluationScore = {
  passed: boolean;
  checks: {
    intent: boolean;
    executionStatus: boolean;
    selectedTool: boolean;
    confirmationSafety: boolean;
    handoff: boolean;
    ownership: boolean;
    knowledgeEvidence: boolean;
    abstention: boolean;
  };
};

export function scoreAgentEvaluationCase(
  testCase: AgentEvaluationCase,
  observed: AgentEvaluationObservation,
): AgentEvaluationScore {
  const checks = {
    intent: observed.intent === testCase.expectedIntent,
    executionStatus:
      testCase.expectedExecutionStatus === undefined ||
      observed.executionStatus === testCase.expectedExecutionStatus,
    selectedTool:
      testCase.expectedTool === undefined ||
      observed.selectedTool === testCase.expectedTool,
    confirmationSafety:
      !testCase.requiresConfirmation ||
      (observed.confirmationReceived
        ? observed.writePerformed &&
          (!testCase.requiresHandoff || observed.handoffRequested)
        : observed.executionStatus === "awaiting_confirmation" &&
          !observed.writePerformed &&
          !observed.handoffRequested),
    handoff: !testCase.requiresHandoff || observed.handoffRequested,
    ownership:
      !testCase.ownerScoped ||
      (observed.employeeId !== undefined &&
        observed.ticketEmployeeId === observed.employeeId),
    knowledgeEvidence:
      !testCase.requiresKnowledgeEvidence || observed.sourceCount > 0,
    abstention: !testCase.expectedAbstention || observed.answerAbstained,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
  };
}
