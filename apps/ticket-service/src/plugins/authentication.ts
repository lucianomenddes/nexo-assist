import fastifyJwt from "@fastify/jwt";
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
} from "../shared/errors/authentication-errors.js";

export { AuthenticationError, AuthorizationError };

const claimsSchema = z
  .object({
    sub: z.string().uuid().optional(),
    role: z.enum(["employee", "service"]),
    employeeId: z.string().uuid().optional(),
  })
  .superRefine((claims, context) => {
    if (claims.role === "employee" && !claims.sub) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sub"],
        message: "Employee subject is required.",
      });
    }

    if (claims.role === "service" && !claims.employeeId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeId"],
        message: "Acting employee is required for service tokens.",
      });
    }
  });

export type AuthenticatedEmployee = {
  employeeId: string;
  actorRole: "employee" | "service";
};

export async function registerAuthentication(
  server: import("fastify").FastifyInstance,
  options: {
    secret: string;
    issuer: string;
    audience: string;
  },
): Promise<void> {
  server.decorateRequest("authenticatedEmployee", null);

  await server.register(fastifyJwt, {
    secret: options.secret,
    sign: {
      algorithm: "HS256",
      iss: options.issuer,
      aud: options.audience,
      expiresIn: "15m",
    },
    verify: {
      algorithms: ["HS256"],
      allowedIss: options.issuer,
      allowedAud: options.audience,
    },
  });

  server.addHook("preHandler", async (request) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (
      request.routeOptions.config.public === true ||
      pathname === "/docs" ||
      pathname.startsWith("/docs/")
    ) {
      return;
    }

    let claims: z.infer<typeof claimsSchema>;
    try {
      await request.jwtVerify();
      claims = claimsSchema.parse(request.user);
    } catch {
      throw new AuthenticationError();
    }

    const employeeId =
      claims.role === "employee" ? claims.sub : claims.employeeId;
    if (!employeeId) throw new AuthenticationError();

    request.authenticatedEmployee = {
      employeeId,
      actorRole: claims.role,
    };
  });
}

export function getAuthenticatedEmployee(
  request: import("fastify").FastifyRequest,
): string {
  if (!request.authenticatedEmployee) throw new AuthenticationError();
  return request.authenticatedEmployee.employeeId;
}

export function getAuthenticatedServiceEmployee(
  request: import("fastify").FastifyRequest,
): string {
  const identity = request.authenticatedEmployee;
  if (!identity) throw new AuthenticationError();
  if (identity.actorRole !== "service") throw new AuthorizationError();
  return identity.employeeId;
}
