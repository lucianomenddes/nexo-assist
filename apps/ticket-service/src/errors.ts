export class TicketNotFoundError extends Error {
  constructor() {
    super("Ticket not found.");
    this.name = "TicketNotFoundError";
  }
}

export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Authenticated employee not found or inactive.");
    this.name = "EmployeeNotFoundError";
  }
}

export class TicketConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketConflictError";
  }
}

export class ReopenWindowExpiredError extends Error {
  constructor() {
    super("Tickets can only be reopened within seven days of resolution.");
    this.name = "ReopenWindowExpiredError";
  }
}

export class InvalidTicketStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTicketStateError";
  }
}
