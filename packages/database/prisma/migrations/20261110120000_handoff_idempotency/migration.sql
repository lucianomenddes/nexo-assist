ALTER TABLE "Handoff" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Handoff_employeeId_idempotencyKey_key"
ON "Handoff"("employeeId", "idempotencyKey");
