import { Mastra } from "@mastra/core/mastra";
import { MastraStorageExporter, Observability } from "@mastra/observability";
import { agentTools } from "./tools/agent-tools.js";
import { nexoAssistant } from "./agents/agent.js";
import { mastraStorage } from "./storage.js";
import { conversationWorkflow } from "./workflows/conversation-workflow.js";
import { NexoSpanPrivacyFilter } from "../services/agent-observability.js";

export const mastra = new Mastra({
  agents: { nexoAssistant },
  storage: mastraStorage,
  tools: agentTools,
  workflows: { conversationWorkflow },
  observability: new Observability({
    configs: {
      default: {
        serviceName: "nexo-assist-agent",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new NexoSpanPrivacyFilter()],
      },
    },
  }),
});

export { mastraStorage };
