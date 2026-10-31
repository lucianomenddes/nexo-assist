import { Mastra } from "@mastra/core/mastra";
import { nexoAssistant } from "./agents/agent.js";

export const mastra = new Mastra({
  agents: { nexoAssistant },
});
