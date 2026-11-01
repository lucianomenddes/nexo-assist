import { jwtVerify } from "jose";
import { z } from "zod";
import { loadEnvironment } from "@nexo-assist/config";
import { withAnalystScope, withEmployeeScope } from "@nexo-assist/database";

const employeeClaimsSchema = z.object({
  role: z.literal("employee"),
  sub: z.string().uuid(),
});
const analystClaimsSchema = z.object({
  role: z.literal("analyst"),
  sub: z.string().uuid(),
});

export class AuthenticationError extends Error {
  constructor() {
    super("A valid employee or analyst authentication token is required.");
    this.name = "AuthenticationError";
  }
}

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
    analystOnly?: boolean;
  }

  interface FastifyRequest {
    employeeId: string | null;
    analystId: string | null;
  }
}

export function registerEmployeeAuthentication(
  server: import("fastify").FastifyInstance,
  config: { secret: string; issuer: string; audience: string },
): void {
  const secret = new TextEncoder().encode(config.secret);
  server.decorateRequest("employeeId", null);
  server.decorateRequest("analystId", null);
  server.addHook("onRequest", async (request) => {
    if (request.routeOptions.config.public === true) return;
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError();

    let payload: Record<string, unknown>;
    try {
      const verified = await jwtVerify(
        authorization.slice("Bearer ".length),
        secret,
        {
          algorithms: ["HS256"],
          issuer: config.issuer,
          audience: config.audience,
        },
      );
      payload = verified.payload;
    } catch {
      throw new AuthenticationError();
    }
    if (request.routeOptions.config.analystOnly === true) {
      const claims = analystClaimsSchema.safeParse(payload);
      if (!claims.success) throw new AuthenticationError();
      const analyst = await withAnalystScope(claims.data.sub, (transaction) =>
        transaction.analyst.findUnique({
          where: { id: claims.data.sub },
          select: { active: true },
        }),
      );
      if (!analyst?.active) throw new AuthenticationError();
      request.analystId = claims.data.sub;
      return;
    }

    const claims = employeeClaimsSchema.safeParse(payload);
    if (!claims.success) throw new AuthenticationError();
    const employeeId = claims.data.sub;
    const employee = await withEmployeeScope(employeeId, (transaction) =>
      transaction.employee.findUnique({
        where: { id: employeeId },
        select: { active: true },
      }),
    );
    if (!employee?.active) throw new AuthenticationError();
    request.employeeId = employeeId;
  });
}

export function getEmployeeId(
  request: import("fastify").FastifyRequest,
): string {
  if (!request.employeeId) throw new AuthenticationError();
  return request.employeeId;
}

export function getAnalystId(
  request: import("fastify").FastifyRequest,
): string {
  if (!request.analystId) throw new AuthenticationError();
  return request.analystId;
}

export function agentAuthConfig() {
  const environment = loadEnvironment();
  return {
    secret: environment.AUTH_JWT_SECRET,
    issuer: environment.AUTH_JWT_ISSUER,
    audience: environment.AUTH_JWT_AUDIENCE,
  };
}
