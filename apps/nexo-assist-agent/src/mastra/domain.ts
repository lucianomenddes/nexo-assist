import { z } from "zod";

export const intentSchema = z.enum([
  "KNOWLEDGE_QUERY",
  "TICKET_CREATE",
  "TICKET_UPDATE",
  "TICKET_STATUS",
  "TICKET_REOPEN",
  "HUMAN_HANDOFF",
  "OUT_OF_SCOPE",
]);

export const ticketCategorySchema = z.enum([
  "Acesso",
  "Rede e VPN",
  "Hardware",
  "Software",
  "E-mail",
  "Outros",
]);

export const ticketPrioritySchema = z.enum([
  "Crítica",
  "Alta",
  "Média",
  "Baixa",
]);

export const ticketTypeSchema = z.enum(["INC", "REQ"]);

export const ticketFieldsSchema = z.object({
  title: z.string().trim().min(5).max(160).optional(),
  description: z.string().trim().min(10).max(10_000).optional(),
  type: ticketTypeSchema.optional(),
  category: ticketCategorySchema.optional(),
  priority: ticketPrioritySchema.optional(),
});

export const intentDecisionSchema = z.object({
  intent: intentSchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(500),
  ticketFields: ticketFieldsSchema.optional(),
  ticketReference: z.string().trim().min(2).max(100).optional(),
  searchQuery: z.string().trim().min(2).max(200).optional(),
  handoffReason: z.string().trim().min(1).max(500).optional(),
});

export const knowledgeSourceSchema = z.object({
  documentId: z.string().uuid(),
  chunkId: z.string().uuid(),
  title: z.string(),
  source: z.string(),
  content: z.string(),
  score: z.number(),
});

export const ticketDraftSchema = z.object({
  id: z.string().uuid(),
  operation: z.enum(["create", "update", "reopen", "handoff"]),
  summary: z.string(),
  expiresAt: z.string().datetime(),
});

export const agentTurnResultSchema = z.object({
  intent: intentSchema,
  selectedTool: z.string().nullable(),
  executionStatus: z.enum([
    "succeeded",
    "awaiting_confirmation",
    "needs_information",
    "paused",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  traceId: z.string().uuid(),
  answer: z.string(),
  sources: z.array(knowledgeSourceSchema).default([]),
  draft: ticketDraftSchema.optional(),
  data: z.unknown().optional(),
  replayed: z.boolean().optional(),
});

export type IntentDecision = z.infer<typeof intentDecisionSchema>;
export type AgentTurnResult = z.infer<typeof agentTurnResultSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
