ALTER TABLE "AgentExecution"
    ADD COLUMN "durationMs" INTEGER;

ALTER TABLE "AgentAudit"
    ADD COLUMN "spanId" TEXT,
    ADD COLUMN "parentSpanId" TEXT,
    ADD COLUMN "durationMs" INTEGER;

CREATE UNIQUE INDEX "AgentAudit_employeeId_executionId_spanId_key"
    ON "AgentAudit"("employeeId", "executionId", "spanId");
