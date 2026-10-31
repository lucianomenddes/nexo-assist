import fastifyJwt from "@fastify/jwt";
import { z } from "zod";

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

declare module "fastify" {
  interface FastifyRequest {
    authenticatedEmployee: AuthenticatedEmployee | null;
  }

  interface FastifyJWT {
    payload: {
      role: "employee" | "service";
      employeeId?: string;
      sub?: string;
    };
    user: {
      sub?: string;
      role: "employee" | "service";
      employeeId?: string;
    };
  }
}

export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor() {
    super("A valid employee authentication token is required.");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor() {
    super("A trusted service token is required for ticket writes.");
    this.name = "AuthorizationError";
  }
}

export function registerAuthentication(
  server: import("fastify").FastifyInstance,
  options: {
    secret: string;
    issuer: string;
    audience: string;
  },
): void {
  server.decorateRequest("authenticatedEmployee", null);

  void server.register(fastifyJwt, {
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
