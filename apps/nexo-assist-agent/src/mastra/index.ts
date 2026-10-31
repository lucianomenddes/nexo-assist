import { Mastra } from "@mastra/core/mastra";
import { agentTools } from "./tools/agent-tools.js";
import { nexoAssistant } from "./agents/agent.js";
import { mastraStorage } from "./storage.js";
import { conversationWorkflow } from "./workflows/conversation-workflow.js";

export const mastra = new Mastra({
  agents: { nexoAssistant },
  storage: mastraStorage,
  tools: agentTools,
  workflows: { conversationWorkflow },
});

export { mastraStorage };
