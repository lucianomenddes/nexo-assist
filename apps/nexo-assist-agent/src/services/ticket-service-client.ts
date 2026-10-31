import { SignJWT } from "jose";
import { z } from "zod";
import { loadEnvironment } from "@nexo-assist/config";

const environment = loadEnvironment();
const secret = new TextEncoder().encode(environment.AUTH_JWT_SECRET);

const ticketSchema = z.object({
  id: z.string().uuid(),
  publicKey: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(["INC", "REQ"]),
  category: z.string(),
  priority: z.string(),
  priorityCode: z.string(),
  status: z.string(),
  statusCode: z.string(),
  dueAt: z.string().datetime().nullable().or(z.date().nullable()),
  overdue: z.boolean(),
  version: z.number().int(),
  createdAt: z.string().datetime().or(z.date()),
  updatedAt: z.string().datetime().or(z.date()),
  resolvedAt: z.string().datetime().nullable().or(z.date().nullable()),
});

export type OwnedTicket = z.infer<typeof ticketSchema>;

export class TicketServiceUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Ticket Service is unavailable.", options);
    this.name = "TicketServiceUnavailableError";
  }
}

export class TicketServiceClient {
  async list(employeeId: string, query?: string): Promise<OwnedTicket[]> {
    const search = query
      ? `/tickets/search?q=${encodeURIComponent(query)}&limit=20`
      : "/tickets?limit=20";
    const response = await this.request(employeeId, search);
    const body: unknown = await response.json();
    const parsed = query
      ? z.array(ticketSchema).safeParse(body)
      : z
          .object({ items: z.array(ticketSchema) })
          .transform(({ items }) => items)
          .safeParse(body);

    if (!parsed.success) throw new TicketServiceUnavailableError();
    return parsed.data;
  }

  async create(
    employeeId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<OwnedTicket> {
    return this.write(employeeId, "/tickets", "POST", input, idempotencyKey);
  }

  async patch(
    employeeId: string,
    ticketId: string,
    input: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<OwnedTicket> {
    return this.write(
      employeeId,
      `/tickets/${encodeURIComponent(ticketId)}`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  async reopen(
    employeeId: string,
    ticketId: string,
    idempotencyKey: string,
  ): Promise<OwnedTicket> {
    return this.write(
      employeeId,
      `/tickets/${encodeURIComponent(ticketId)}/reopen`,
      "POST",
      {},
      idempotencyKey,
    );
  }

  private async write(
    employeeId: string,
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<OwnedTicket> {
    const response = await this.request(employeeId, path, {
      method,
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    const parsed = ticketSchema.safeParse(result);
    if (!parsed.success) throw new TicketServiceUnavailableError();
    return parsed.data;
  }

  private async request(
    employeeId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    let token: string;
    try {
      token = await new SignJWT({ role: "service", employeeId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(environment.AUTH_JWT_ISSUER)
        .setAudience(environment.AUTH_JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("2m")
        .sign(secret);
    } catch (error) {
      throw new Error("Could not sign an internal Ticket Service token.", {
        cause: error,
      });
    }

    let response: Response;
    try {
      response = await fetch(new URL(path, environment.TICKET_SERVICE_URL), {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new TicketServiceUnavailableError({ cause: error });
    }

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new TicketServiceRequestError(response.status, body);
    }
    return response;
  }
}

export class TicketServiceRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly responseBody: unknown,
  ) {
    super("Ticket Service rejected the request.");
    this.name = "TicketServiceRequestError";
  }
}
