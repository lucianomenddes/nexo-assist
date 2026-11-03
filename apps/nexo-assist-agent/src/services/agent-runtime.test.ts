import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  intentDecisionSchema,
  type KnowledgeSource,
} from "../mastra/domain.js";
import { routeIntent, type AgentWorkflowInput } from "./agent-runtime.js";
import type { OwnedTicket } from "./ticket-service-client.js";

vi.mock("./agent-observability.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./agent-observability.js")>();
  return {
    ...actual,
    recordExecutionAudit: vi.fn(async () => {}),
  };
});

const employeeId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const traceId = "00000000-0000-4000-8000-000000000003";
const ticketId = "00000000-0000-4000-8000-000000000004";

const input: AgentWorkflowInput = {
  employeeId,
  conversationId,
  traceId,
  content: "Preciso de ajuda com a VPN.",
  idempotencyKey: "agent-runtime-test-01",
  recentMessages: [],
};

const ownedTicket: OwnedTicket = {
  id: ticketId,
  publicKey: "INC-20311",
  title: "VPN sem acesso",
  description: "A VPN corporativa não conecta desde o início do expediente.",
  type: "INC",
  category: "Rede e VPN",
  priority: "Alta",
  priorityCode: "high",
  status: "Aberto",
  statusCode: "open",
  dueAt: new Date("2026-11-03T12:00:00.000Z"),
  overdue: false,
  version: 3,
  createdAt: new Date("2026-11-02T12:00:00.000Z"),
  updatedAt: new Date("2026-11-02T12:00:00.000Z"),
  resolvedAt: null,
};

function decision(
  value: Record<string, unknown>,
): ReturnType<typeof intentDecisionSchema.parse> {
  return intentDecisionSchema.parse({
    confidence: 0.95,
    ...value,
  });
}

describe("deterministic agent intent routing", () => {
  it("requires analyst confirmation for low-confidence decisions without writing", async () => {
    const result = await routeIntent(
      input,
      decision({ intent: "TICKET_CREATE", confidence: 0.4 }),
    );

    expect(result).toMatchObject({
      intent: "HUMAN_HANDOFF",
      selectedTool: "request_human_handoff",
      executionStatus: "awaiting_confirmation",
      pendingOperation: { operation: "handoff" },
    });
  });

  it("asks for all required ticket fields before preparing a draft", async () => {
    const result = await routeIntent(
      input,
      decision({ intent: "TICKET_CREATE" }),
    );

    expect(result.executionStatus).toBe("needs_information");
    expect(result.selectedTool).toBeNull();
    expect(result.pendingOperation).toBeUndefined();
  });

  it("prepares a complete valid ticket as a draft without creating it", async () => {
    const result = await routeIntent(
      input,
      decision({
        intent: "TICKET_CREATE",
        ticketFields: {
          title: "VPN indisponível",
          description:
            "A VPN corporativa parou de conectar após a atualização do cliente.",
          type: "INC",
          category: "Rede e VPN",
          priority: "Alta",
        },
      }),
    );

    expect(result).toMatchObject({
      intent: "TICKET_CREATE",
      selectedTool: "prepare_ticket_draft",
      executionStatus: "awaiting_confirmation",
      pendingOperation: { operation: "create" },
    });
  });

  it("rejects malformed ticket fields instead of guessing a category", async () => {
    expect(
      intentDecisionSchema.safeParse({
        intent: "TICKET_CREATE",
        confidence: 0.95,
        ticketFields: {
          title: "VPN indisponível",
          description:
            "A VPN corporativa parou de conectar após a atualização do cliente.",
          type: "INC",
          category: "RH",
          priority: "Alta",
        },
      }).success,
    ).toBe(false);
  });

  it("searches only the authenticated employee's tickets", async () => {
    const listTickets = vi.fn(async (requestedEmployeeId: string) => {
      expect(requestedEmployeeId).toBe(employeeId);
      return [ownedTicket];
    });

    const result = await routeIntent(
      input,
      decision({
        intent: "TICKET_STATUS",
        ticketReference: "INC-20311",
      }),
      { listTickets, searchKnowledge: vi.fn() },
    );

    expect(result).toMatchObject({
      intent: "TICKET_STATUS",
      selectedTool: "search_my_tickets",
      executionStatus: "succeeded",
      data: ownedTicket,
    });
    expect(listTickets).toHaveBeenCalledOnce();
  });

  it("does not reveal a ticket reference that is absent from owned results", async () => {
    const result = await routeIntent(
      input,
      decision({
        intent: "TICKET_STATUS",
        ticketReference: "INC-OTHER-EMPLOYEE",
      }),
      {
        listTickets: vi.fn(async () => []),
        searchKnowledge: vi.fn(),
      },
    );

    expect(result.executionStatus).toBe("needs_information");
    expect(JSON.stringify(result)).not.toContain("other employee ticket");
  });

  it("requires confirmation before changing an owned ticket", async () => {
    const result = await routeIntent(
      input,
      decision({
        intent: "TICKET_UPDATE",
        ticketReference: "INC-20311",
        ticketFields: {
          description: "A VPN agora falha após reiniciar o computador.",
        },
      }),
      {
        listTickets: vi.fn(async () => [ownedTicket]),
        searchKnowledge: vi.fn(),
      },
    );

    expect(result).toMatchObject({
      selectedTool: "prepare_ticket_draft",
      executionStatus: "awaiting_confirmation",
      pendingOperation: {
        operation: "update",
        payload: { ticketId, expectedVersion: ownedTicket.version },
      },
    });
  });

  it("prepares eligible reopenings for confirmation and delegates the seven-day check", async () => {
    const result = await routeIntent(
      input,
      decision({
        intent: "TICKET_REOPEN",
        ticketReference: "INC-20311",
      }),
      {
        listTickets: vi.fn(async () => [
          { ...ownedTicket, statusCode: "resolved" },
        ]),
        searchKnowledge: vi.fn(),
      },
    );

    expect(result.executionStatus).toBe("awaiting_confirmation");
    expect(result.pendingOperation?.operation).toBe("reopen");
    expect(result.reason).toContain("revalidada pelo Ticket Service");
  });

  it("requests explicit confirmation before a user-requested handoff", async () => {
    const result = await routeIntent(
      input,
      decision({ intent: "HUMAN_HANDOFF" }),
    );

    expect(result).toMatchObject({
      selectedTool: "request_human_handoff",
      executionStatus: "awaiting_confirmation",
      pendingOperation: { operation: "handoff" },
    });
  });

  it("routes non-IT requests out of scope without invoking tools", async () => {
    const listTickets = vi.fn();
    const searchKnowledge = vi.fn();
    const result = await routeIntent(
      input,
      decision({ intent: "OUT_OF_SCOPE" }),
      { listTickets, searchKnowledge: searchKnowledge },
    );

    expect(result.selectedTool).toBeNull();
    expect(result.executionStatus).toBe("succeeded");
    expect(listTickets).not.toHaveBeenCalled();
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("uses filtered published knowledge evidence and abstains when retrieval is empty", async () => {
    const searchKnowledge = vi.fn(async () => [] as KnowledgeSource[]);
    const result = await routeIntent(
      input,
      decision({
        intent: "KNOWLEDGE_QUERY",
        platform: "Windows 11",
        knowledgeVersion: 2,
      }),
      { searchKnowledge, listTickets: vi.fn() },
    );

    expect(result).toMatchObject({
      selectedTool: "search_knowledge_base",
      executionStatus: "needs_information",
      sources: [],
    });
    expect(searchKnowledge).toHaveBeenCalledWith(
      input.content,
      expect.objectContaining({ platform: "Windows 11", version: 2 }),
    );
  });

  it("uses the extracted search query and bounds the fallback message", async () => {
    const searchKnowledge = vi.fn(
      async (_query: string) => [] as KnowledgeSource[],
    );
    await routeIntent(
      input,
      decision({
        intent: "KNOWLEDGE_QUERY",
        searchQuery: "VPN error 809",
      }),
      { searchKnowledge, listTickets: vi.fn() },
    );
    expect(searchKnowledge.mock.calls.at(-1)?.[0]).toBe("VPN error 809");

    const longMessage = { ...input, content: "x".repeat(10_000) };
    await routeIntent(longMessage, decision({ intent: "KNOWLEDGE_QUERY" }), {
      searchKnowledge,
      listTickets: vi.fn(),
    });
    expect(searchKnowledge.mock.calls.at(-1)?.[0]).toHaveLength(2000);
  });

  it("asks for clarification instead of searching with a one-character query", async () => {
    const searchKnowledge = vi.fn(
      async (_query: string) => [] as KnowledgeSource[],
    );
    const result = await routeIntent(
      { ...input, content: "x" },
      decision({ intent: "KNOWLEDGE_QUERY" }),
      { searchKnowledge, listTickets: vi.fn() },
    );

    expect(result.executionStatus).toBe("needs_information");
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it("returns grounded knowledge sources when platform-compatible evidence exists", async () => {
    const source: KnowledgeSource = {
      documentId: randomUUID(),
      chunkId: randomUUID(),
      title: "VPN erro 809",
      source: "nexo://knowledge/vpn-809",
      content: "No Windows 10, reinstale o cliente pelo portal.",
      category: "Rede e VPN",
      tags: ["vpn"],
      platform: "Windows 10",
      version: 1,
      status: "published",
      updatedAt: new Date("2026-10-30T12:00:00.000Z").toISOString(),
      score: 0.9,
    };
    const searchKnowledge = vi.fn(async () => [source]);
    const result = await routeIntent(
      input,
      decision({ intent: "KNOWLEDGE_QUERY", platform: "Windows 10" }),
      { searchKnowledge, listTickets: vi.fn() },
    );

    expect(result.executionStatus).toBe("succeeded");
    expect(result.sources).toEqual([source]);
    expect(searchKnowledge).toHaveBeenCalledWith(
      input.content,
      expect.objectContaining({ platform: "Windows 10" }),
    );
  });

  it("lists only owned tickets for status and requires a reference for writes", async () => {
    const listTickets = vi.fn(async () => [ownedTicket]);
    const statusResult = await routeIntent(
      input,
      decision({ intent: "TICKET_STATUS" }),
      { listTickets, searchKnowledge: vi.fn() },
    );

    expect(statusResult.executionStatus).toBe("succeeded");
    expect(statusResult.data).toEqual([ownedTicket]);
    expect(listTickets).toHaveBeenCalledWith(employeeId, undefined);

    for (const intent of ["TICKET_UPDATE", "TICKET_REOPEN"] as const) {
      const writeListTickets = vi.fn(async () => [ownedTicket]);
      const result = await routeIntent(input, decision({ intent }), {
        listTickets: writeListTickets,
        searchKnowledge: vi.fn(),
      });

      expect(result.executionStatus).toBe("needs_information");
      expect(writeListTickets).not.toHaveBeenCalled();
    }
  });

  it("requests a handoff confirmation when an owned ticket is overdue or critical", async () => {
    for (const ticket of [
      { ...ownedTicket, overdue: true },
      { ...ownedTicket, priorityCode: "critical", priority: "Crítica" },
    ]) {
      const result = await routeIntent(
        input,
        decision({
          intent: "TICKET_STATUS",
          ticketReference: ticket.publicKey,
        }),
        {
          listTickets: vi.fn(async () => [ticket]),
          searchKnowledge: vi.fn(),
        },
      );

      expect(result).toMatchObject({
        intent: "HUMAN_HANDOFF",
        executionStatus: "awaiting_confirmation",
        selectedTool: "request_human_handoff",
        pendingOperation: { operation: "handoff" },
      });
    }
  });
});
