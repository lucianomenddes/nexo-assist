import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { loadEnvironment } from "@nexo-assist/config";
import { mastraStorage } from "../storage.js";
import { systemInstructions } from "../system-instructions.js";

const environment = loadEnvironment();

export const nexoAssistant = new Agent({
  id: "nexo-assistant",
  name: "Nexo Assistant Agent",
  description: "Assistente de Service Desk de TI da Nexo.",
  instructions: systemInstructions,
  model: environment.OPENAI_MODEL,
  memory: new Memory({
    storage: mastraStorage,
    options: {
      lastMessages: 12,
      generateTitle: false,
      semanticRecall: false,
    },
  }),
});
