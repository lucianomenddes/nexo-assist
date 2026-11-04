type HealthOptions = { checkDatabase: () => Promise<void> };

const objectResponseSchema = {
  type: "object",
  additionalProperties: true,
} as const;

export const healthRoutes: import("fastify").FastifyPluginAsync<
  HealthOptions
> = async (server, { checkDatabase }) => {
  server.get(
    "/health",
    {
      config: { public: true },
      schema: {
        tags: ["Health"],
        summary: "Check service health",
        response: { 200: objectResponseSchema },
      },
    },
    async () => ({ status: "ok", service: "ticket-service" }),
  );
  server.get(
    "/health/live",
    { config: { public: true }, schema: { hide: true } },
    async () => ({ status: "ok", service: "ticket-service" }),
  );
  server.get(
    "/health/ready",
    {
      config: { public: true },
      schema: {
        tags: ["Health"],
        summary: "Check service and database readiness",
        response: { 200: objectResponseSchema, 503: objectResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await checkDatabase();
        return {
          status: "ok",
          service: "ticket-service",
          dependencies: { database: "ok" },
        };
      } catch (error) {
        request.log.error(
          { err: error },
          "Ticket service readiness check failed",
        );
        return reply.code(503).send({
          status: "error",
          service: "ticket-service",
          dependencies: { database: "unavailable" },
        });
      }
    },
  );
};
