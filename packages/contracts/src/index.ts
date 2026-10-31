import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  service: z.string(),
  dependencies: z
    .object({
      database: z.enum(["ok", "unavailable"]),
    })
    .optional(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const ticketTypeSchema = z.enum(["INC", "REQ"]);
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
