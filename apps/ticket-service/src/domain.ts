import { TicketPriority, TicketType } from "@prisma/client";
import { z } from "zod";

export const ticketCategories = [
  "Acesso",
  "Rede e VPN",
  "Hardware",
  "Software",
  "E-mail",
  "Outros",
] as const;

export const ticketPrioritySchema = z.enum([
  "Crítica",
  "Alta",
  "Média",
  "Baixa",
]);

export const ticketTypeSchema = z.enum(["INC", "REQ"]);

export const ticketCategorySchema = z.enum(ticketCategories);

export const createTicketSchema = z
  .object({
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(10).max(10_000),
    type: ticketTypeSchema,
    category: ticketCategorySchema,
    priority: ticketPrioritySchema,
    affectedEmployeeId: z.string().uuid().optional(),
  })
  .strict();

export const patchTicketSchema = z
  .object({
    title: z.string().trim().min(5).max(160).optional(),
    description: z.string().trim().min(10).max(10_000).optional(),
    type: ticketTypeSchema.optional(),
    category: ticketCategorySchema.optional(),
    priority: ticketPrioritySchema.optional(),
    status: z
      .enum(["open", "awaiting_analyst", "resolved", "closed"])
      .optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedVersion"),
    { message: "At least one field to update is required." },
  );

export const listTicketsQuerySchema = z.object({
  status: z.enum(["open", "awaiting_analyst", "resolved", "closed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const searchTicketsQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ticketParamsSchema = z.object({ id: z.string().uuid() });

export const ticketDomainType: Record<
  z.infer<typeof ticketTypeSchema>,
  TicketType
> = {
  INC: TicketType.INC,
  REQ: TicketType.REQ,
};

export const ticketDomainPriority: Record<
  z.infer<typeof ticketPrioritySchema>,
  TicketPriority
> = {
  Crítica: TicketPriority.critical,
  Alta: TicketPriority.high,
  Média: TicketPriority.medium,
  Baixa: TicketPriority.low,
};

export const ticketDisplayPriority: Record<TicketPriority, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export const ticketDisplayStatus: Record<
  import("@prisma/client").TicketStatus,
  string
> = {
  open: "Aberto",
  awaiting_analyst: "Aguardando analista",
  resolved: "Resolvido",
  closed: "Encerrado",
};

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type PatchTicketInput = z.infer<typeof patchTicketSchema>;
export type TicketListQuery = z.infer<typeof listTicketsQuerySchema>;
