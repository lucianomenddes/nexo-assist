import { z } from "zod";

export const agentWorkflowInputSchema = z.object({
  employeeId: z.string().uuid(),
  conversationId: z.string().uuid(),
  traceId: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().min(8).max(128),
  recentMessages: z.array(
    z.object({
      actor: z.enum(["employee", "assistant", "analyst"]),
      content: z.string(),
    }),
  ),
});
