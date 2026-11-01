import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma,
  withAnalystScope,
  withEmployeeScope,
} from "@nexo-assist/database";
import { HandoffService } from "./handoff-service.js";

const employeeId = randomUUID();
const firstAnalystId = randomUUID();
const secondAnalystId = randomUUID();
const conversationId = randomUUID();
const handoffIdempotencyKey = randomUUID();
const handoffService = new HandoffService();
let handoffId: string;

describe.sequential("analyst handoff concurrency", () => {
  beforeAll(async () => {
    await prisma.analyst.createMany({
      data: [
        {
          id: firstAnalystId,
          email: `${firstAnalystId}@example.test`,
          name: "First concurrent analyst",
        },
        {
          id: secondAnalystId,
          email: `${secondAnalystId}@example.test`,
          name: "Second concurrent analyst",
        },
      ],
    });
    await withEmployeeScope(employeeId, async (transaction) => {
      await transaction.employee.create({
        data: {
          id: employeeId,
          email: `${employeeId}@example.test`,
          name: "Handoff integration employee",
        },
      });
      await transaction.conversation.create({
        data: { id: conversationId, employeeId },
      });
      await transaction.message.create({
        data: {
          employeeId,
          conversationId,
          sequence: 1,
          actorType: "employee",
          content: "A VPN request needs analyst support.",
        },
      });
      await transaction.conversation.update({
        where: { id_employeeId: { id: conversationId, employeeId } },
        data: { messageCount: 1 },
      });
    });
    const handoff = await handoffService.requestEmployeeHandoff({
      employeeId,
      conversationId,
      idempotencyKey: handoffIdempotencyKey,
      reason: "Integration concurrency test.",
    });
    handoffId = handoff.id;
    expect(handoff.status).toBe("waiting_analyst");
  });

  afterAll(async () => {
    await withEmployeeScope(employeeId, async (transaction) => {
      await transaction.conversation.deleteMany({
        where: { id: conversationId },
      });
      await transaction.employee.deleteMany({ where: { id: employeeId } });
    });
    await prisma.analyst.deleteMany({
      where: { id: { in: [firstAnalystId, secondAnalystId] } },
    });
  });

  it("allows only one analyst to claim the same waiting handoff", async () => {
    const outcomes = await Promise.allSettled([
      handoffService.assign(
        firstAnalystId,
        handoffId,
        "Claimed by first analyst.",
      ),
      handoffService.assign(
        secondAnalystId,
        handoffId,
        "Claimed by second analyst.",
      ),
    ]);

    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const winnerId =
      outcomes[0]?.status === "fulfilled" ? firstAnalystId : secondAnalystId;
    const persisted = await withAnalystScope(winnerId, async (transaction) =>
      transaction.handoff.findUniqueOrThrow({
        where: {
          employeeId_idempotencyKey: {
            employeeId,
            idempotencyKey: handoffIdempotencyKey,
          },
        },
        select: { status: true, assignedAnalystId: true },
      }),
    );
    expect(persisted.status).toBe("analyst_assigned");
    expect(persisted.assignedAnalystId).toBe(winnerId);
  });
});
