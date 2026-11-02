import { randomUUID } from "node:crypto";
import { AuditStatus, Prisma } from "@prisma/client";
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability";
import { withEmployeeScope } from "@nexo-assist/database";

const sensitiveKeyPattern =
  /^(?:password|passphrase|secret|(?:access|refresh|auth|bearer)?[_-]?token|authorization|api[_-]?key|credential|private[_-]?key|email(?:address)?|phone(?:number)?|mobile|cpf|ssn|employeeid|conversationid|idempotencykey|jwt)$/i;
const privateReasoningKeyPattern =
  /^(?:analysis|reasoning|chain[_-]?of[_-]?thought|thought|internal[_-]?thought|private[_-]?reasoning)$/i;

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export function redactObservabilityText(value: string): string {
  return value
    .replace(
      /\b(password|passphrase|secret|token|api[_-]?key|authorization)\s*[:=]\s*(['"]?)[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /([?&](?:token|key|secret|password|api_key)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL REDIGIDO]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF REDIGIDO]")
    .replace(
      /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}\b/g,
      "[TELEFONE REDIGIDO]",
    );
}

function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactObservabilityText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).flatMap(([key, entry]) => {
      if (privateReasoningKeyPattern.test(key)) return [];
      return [
        [
          key,
          sensitiveKeyPattern.test(key) ? "[REDACTED]" : redactValue(entry),
        ],
      ];
    });
    return Object.fromEntries(entries) as T;
  }
  return value;
}

export function observabilitySummary(
  value: unknown,
  maximumLength = 4000,
): string {
  let normalized: string | undefined;
  if (typeof value === "string") {
    const text = redactObservabilityText(value);
    try {
      normalized = JSON.stringify(redactValue(JSON.parse(text)));
    } catch {
      normalized = text;
    }
  } else {
    normalized = JSON.stringify(redactValue(value));
  }
  return (normalized ?? "null").slice(0, maximumLength);
}

export function observabilityJson(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(redactValue(value)),
  ) as Prisma.InputJsonValue;
}

function tokenCount(
  usage: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }
  }
  return null;
}

export function readTokenUsage(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = tokenCount(usage, "inputTokens", "promptTokens");
  const outputTokens = tokenCount(usage, "outputTokens", "completionTokens");
  const totalTokens =
    tokenCount(usage, "totalTokens") ??
    (inputTokens === null || outputTokens === null
      ? null
      : inputTokens + outputTokens);
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

export function combineTokenUsage(
  ...values: Array<TokenUsage | null>
): TokenUsage | null {
  const usage = values.filter((value): value is TokenUsage => value !== null);
  if (usage.length === 0) return null;
  const sum = (key: keyof TokenUsage): number | null => {
    const counts = usage
      .map((entry) => entry[key])
      .filter((count): count is number => count !== null);
    return counts.length
      ? counts.reduce((total, count) => total + count, 0)
      : null;
  };
  return {
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    totalTokens: sum("totalTokens"),
  };
}

export async function recordExecutionAudit(input: {
  employeeId: string;
  traceId: string;
  eventType: string;
  toolName?: string | null;
  inputSummary?: unknown;
  outputSummary?: unknown;
  status: AuditStatus;
  sourceRefs?: unknown;
  spanId?: string;
  parentSpanId?: string;
  durationMs?: number;
}): Promise<void> {
  await withEmployeeScope(input.employeeId, async (transaction) => {
    const execution = await transaction.agentExecution.findUnique({
      where: {
        employeeId_traceId: {
          employeeId: input.employeeId,
          traceId: input.traceId,
        },
      },
      select: { id: true },
    });
    if (!execution) {
      throw new Error("Cannot record an audit event without its execution.");
    }
    await transaction.agentAudit.create({
      data: {
        employeeId: input.employeeId,
        executionId: execution.id,
        eventType: input.eventType,
        toolName: input.toolName ?? null,
        inputSummary:
          input.inputSummary === undefined
            ? null
            : observabilitySummary(input.inputSummary),
        outputSummary:
          input.outputSummary === undefined
            ? null
            : observabilitySummary(input.outputSummary),
        status: input.status,
        sourceRefs: observabilityJson(input.sourceRefs),
        spanId: input.spanId ?? randomUUID(),
        parentSpanId: input.parentSpanId ?? input.traceId,
        durationMs: input.durationMs,
      },
    });
  });
}

export function observabilityError(error: unknown): string {
  if (!(error instanceof Error)) return "Falha operacional não identificada.";
  return redactObservabilityText(
    `${error.name}: ${error.message}`.slice(0, 1000),
  );
}

export class NexoSpanPrivacyFilter implements SpanOutputProcessor {
  readonly name = "nexo-observability-privacy-filter";

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return undefined;
    span.input = redactValue(span.input);
    span.output = redactValue(span.output);
    span.attributes = redactValue(span.attributes);
    span.metadata = redactValue(span.metadata);
    span.requestContext = redactValue(span.requestContext);
    if (span.inputPreview) {
      span.inputPreview = redactObservabilityText(span.inputPreview);
    }
    if (span.outputPreview) {
      span.outputPreview = redactObservabilityText(span.outputPreview);
    }
    if (span.errorPreview) {
      span.errorPreview = redactObservabilityText(span.errorPreview);
    }
    if (span.errorInfo) span.errorInfo = redactValue(span.errorInfo);
    return span;
  }

  async shutdown(): Promise<void> {}
}
