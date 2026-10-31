import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

const employeeIdSchema = z.string().uuid();
type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function withEmployeeScope<T>(
  employeeId: string,
  operation: (transaction: TransactionClient) => Promise<T>,
): Promise<T> {
  const scopedEmployeeId = employeeIdSchema.parse(employeeId);

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT set_config('app.employee_id', ${scopedEmployeeId}, true)
    `;

    return operation(transaction);
  });
}
