import { withEmployeeScope } from "@nexo-assist/database";

export class TicketRepository {
  withEmployeeScope = withEmployeeScope;
}

export const ticketRepository = new TicketRepository();
