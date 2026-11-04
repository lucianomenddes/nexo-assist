import type { AuthenticatedEmployee } from "../plugins/authentication.js";

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

  interface FastifyContextConfig {
    public?: boolean;
  }
}
