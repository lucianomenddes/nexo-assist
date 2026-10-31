import { createStep, createWorkflow } from "@mastra/core/workflows";
import { agentTurnResultSchema } from "../domain.js";
import { executeAgentWorkflow } from "../../services/agent-runtime.js";
import { agentWorkflowInputSchema } from "./workflow-schemas.js";

const routeAndExecuteTurn = createStep({
  id: "route-and-execute-conversation-turn",
  inputSchema: agentWorkflowInputSchema,
  outputSchema: agentTurnResultSchema,
  execute: async ({ inputData }) => executeAgentWorkflow(inputData),
});

export const conversationWorkflow = createWorkflow({
  id: "nexo-conversation-turn",
  inputSchema: agentWorkflowInputSchema,
  outputSchema: agentTurnResultSchema,
})
  .then(routeAndExecuteTurn)
  .commit();
