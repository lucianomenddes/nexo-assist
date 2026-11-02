import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchKnowledgeBase } from "../../services/knowledge-rag.js";
import { TicketServiceClient } from "../../services/ticket-service-client.js";
import { knowledgeSourceSchema, ticketFieldsSchema } from "../domain.js";

const ticketServiceClient = new TicketServiceClient();

export const searchKnowledgeBaseInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
  filters: z
    .object({
      category: z.string().trim().min(1).max(100).optional(),
      tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      platform: z.string().trim().min(1).max(80).optional(),
      version: z.number().int().positive().optional(),
    })
    .optional(),
});

export const searchMyTicketsInputSchema = z.object({
  employeeId: z.string().uuid(),
  query: z.string().trim().min(2).max(200).optional(),
});

export const prepareTicketDraftInputSchema = z.object({
  operation: z.enum(["create", "update", "reopen"]),
  fields: ticketFieldsSchema,
  ticketId: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const prepareTicketDraftOutputSchema =
  prepareTicketDraftInputSchema.extend({
    confirmationRequired: z.literal(true),
  });

export const requestHumanHandoffInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(4000),
});

export const requestHumanHandoffOutputSchema =
  requestHumanHandoffInputSchema.extend({
    confirmationRequired: z.literal(true),
  });

export const searchKnowledgeBaseTool = createTool({
  id: "search_knowledge_base",
  description:
    "Recupera trechos publicados da central de ajuda institucional. Não retorna chamados ou mensagens privadas.",
  inputSchema: searchKnowledgeBaseInputSchema,
  outputSchema: z.object({ sources: z.array(knowledgeSourceSchema) }),
  execute: async ({ query, filters }) => ({
    sources: await searchKnowledgeBase(query, filters),
  }),
});

export const searchMyTicketsTool = createTool({
  id: "search_my_tickets",
  description:
    "Consulta apenas chamados do funcionário identificado pelo contexto confiável do workflow.",
  inputSchema: searchMyTicketsInputSchema,
  outputSchema: z.object({
    tickets: z.array(
      z.object({
        id: z.string().uuid(),
        publicKey: z.string(),
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        dueAt: z.union([z.string().datetime(), z.date()]).nullable(),
        overdue: z.boolean(),
        version: z.number().int(),
      }),
    ),
  }),
  execute: async ({ employeeId, query }) => ({
    tickets: (await ticketServiceClient.list(employeeId, query)).map(
      ({
        id,
        publicKey,
        title,
        status,
        priority,
        dueAt,
        overdue,
        version,
      }) => ({
        id,
        publicKey,
        title,
        status,
        priority,
        dueAt,
        overdue,
        version,
      }),
    ),
  }),
});

export const prepareTicketDraftTool = createTool({
  id: "prepare_ticket_draft",
  description:
    "Valida e prepara dados de um rascunho de chamado. Nunca cria nem atualiza um chamado.",
  inputSchema: prepareTicketDraftInputSchema,
  outputSchema: prepareTicketDraftOutputSchema,
  execute: async (input) => ({ ...input, confirmationRequired: true as const }),
});

export const requestHumanHandoffTool = createTool({
  id: "request_human_handoff",
  description:
    "Prepara uma solicitação de transferência para analista; a conversa só muda de estado após confirmação.",
  inputSchema: requestHumanHandoffInputSchema,
  outputSchema: requestHumanHandoffOutputSchema,
  execute: async (input) => ({ ...input, confirmationRequired: true as const }),
});

export const agentTools = {
  searchKnowledgeBaseTool,
  searchMyTicketsTool,
  prepareTicketDraftTool,
  requestHumanHandoffTool,
};
