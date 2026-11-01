import { z } from "zod";

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .default(
      "postgresql://nexo_app:nexo_app_dev@localhost:55432/nexo_assist?schema=public",
    ),
  DIRECT_URL: z.string().url().optional(),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().min(1).default("groq/openai/gpt-oss-20b"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  TICKET_SERVICE_URL: z.string().url().default("http://localhost:4112"),
  WEB_ORIGIN: z
    .string()
    .url()
    .transform((value) => new URL(value).origin)
    .default("http://localhost:3000"),
  AUTH_JWT_SECRET: z
    .string()
    .min(32)
    .default("nexo-assist-local-jwt-secret-change-before-deployment"),
  AUTH_JWT_ISSUER: z.string().min(1).default("nexo-assist"),
  AUTH_JWT_AUDIENCE: z.string().min(1).default("nexo-assist-api"),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(4111),
  TICKET_SERVICE_PORT: z.coerce.number().int().min(1).max(65535).default(4112),
});

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
