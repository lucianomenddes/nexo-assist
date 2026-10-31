import { jwtVerify } from "jose";
import { z } from "zod";
import { loadEnvironment } from "@nexo-assist/config";
import { withEmployeeScope } from "@nexo-assist/database";

const employeeClaimsSchema = z.object({
  role: z.literal("employee"),
  sub: z.string().uuid(),
});

export class AuthenticationError extends Error {
  constructor() {
    super("A valid employee authentication token is required.");
    this.name = "AuthenticationError";
  }
}

declare module "fastify" {
  interface FastifyContextConfig {
    public?: boolean;
  }

  interface FastifyRequest {
    employeeId: string | null;
  }
}

export function registerEmployeeAuthentication(
  server: import("fastify").FastifyInstance,
  config: { secret: string; issuer: string; audience: string },
): void {
  const secret = new TextEncoder().encode(config.secret);
  server.decorateRequest("employeeId", null);
  server.addHook("onRequest", async (request) => {
    if (request.routeOptions.config.public === true) return;
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError();

    let employeeId: string;
    try {
      const { payload } = await jwtVerify(
        authorization.slice("Bearer ".length),
        secret,
        {
          algorithms: ["HS256"],
          issuer: config.issuer,
          audience: config.audience,
        },
      );
      employeeId = employeeClaimsSchema.parse(payload).sub;
    } catch {
      throw new AuthenticationError();
    }
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

export function agentAuthConfig() {
  const environment = loadEnvironment();
  return {
    secret: environment.AUTH_JWT_SECRET,
    issuer: environment.AUTH_JWT_ISSUER,
    audience: environment.AUTH_JWT_AUDIENCE,
  };
}
