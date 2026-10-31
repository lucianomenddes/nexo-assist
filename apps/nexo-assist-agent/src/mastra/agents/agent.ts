import { Agent } from "@mastra/core/agent";
import { loadEnvironment } from "@nexo-assist/config";

const environment = loadEnvironment();

export const nexoAssistant = new Agent({
  id: "nexo-assistant",
  name: "Nexo Assist",
  description: "Assistente de Service Desk de TI da Nexo.",
  instructions:
    "Você é o Nexo Assist. Responda em português brasileiro. As ferramentas e regras de negócio serão adicionadas em etapas posteriores.",
  model: environment.OPENAI_MODEL,
});
