import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchKnowledgeBase } from "../../services/knowledge-retriever.js";
import { TicketServiceClient } from "../../services/ticket-service-client.js";
import { knowledgeSourceSchema, ticketFieldsSchema } from "../domain.js";

const ticketServiceClient = new TicketServiceClient();

export const searchKnowledgeBaseTool = createTool({
  id: "search_knowledge_base",
  description:
    "Recupera trechos publicados da central de ajuda institucional. Não retorna chamados ou mensagens privadas.",
  inputSchema: z.object({ query: z.string().trim().min(2).max(500) }),
  outputSchema: z.object({ sources: z.array(knowledgeSourceSchema) }),
  execute: async ({ query }) => ({
    sources: await searchKnowledgeBase(query),
  }),
});

export const searchMyTicketsTool = createTool({
  id: "search_my_tickets",
  description:
    "Consulta apenas chamados do funcionário identificado pelo contexto confiável do workflow.",
  inputSchema: z.object({
    employeeId: z.string().uuid(),
    query: z.string().trim().min(2).max(200).optional(),
  }),
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
  inputSchema: z.object({
    operation: z.enum(["create", "update", "reopen"]),
    fields: ticketFieldsSchema,
    ticketId: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
  }),
  outputSchema: z.object({
    operation: z.enum(["create", "update", "reopen"]),
    fields: ticketFieldsSchema,
    ticketId: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
    confirmationRequired: z.literal(true),
  }),
  execute: async (input) => ({ ...input, confirmationRequired: true as const }),
});

export const requestHumanHandoffTool = createTool({
  id: "request_human_handoff",
  description:
    "Prepara uma solicitação de transferência para analista; a conversa só muda de estado após confirmação.",
  inputSchema: z.object({
    reason: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(4000),
  }),
  outputSchema: z.object({
    reason: z.string(),
    summary: z.string(),
    confirmationRequired: z.literal(true),
  }),
  execute: async (input) => ({ ...input, confirmationRequired: true as const }),
});

export const agentTools = {
  searchKnowledgeBaseTool,
  searchMyTicketsTool,
  prepareTicketDraftTool,
  requestHumanHandoffTool,
};
