export {
  ticketCategorySchema,
  ticketPrioritySchema,
  ticketTypeSchema,
} from "@nexo-assist/contracts";

export type TicketStatus = "open" | "waiting_analyst" | "resolved" | "closed";

export interface TicketSummary {
  id: string;
  title: string;
  status: TicketStatus;
}
