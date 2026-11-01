CREATE TYPE "HandoffActorType" AS ENUM ('employee', 'analyst', 'assistant', 'system');
CREATE TYPE "HandoffStatus_new" AS ENUM (
    'waiting_analyst',
    'analyst_assigned',
    'agent_resumed',
    'resolved',
    'closed'
);

ALTER TABLE "Handoff" ALTER COLUMN "status" DROP DEFAULT;
DROP INDEX "Handoff_one_active_per_conversation_key";
ALTER TABLE "Handoff"
    ALTER COLUMN "status" TYPE "HandoffStatus_new"
    USING (
        CASE "status"::text
            WHEN 'pending' THEN 'waiting_analyst'
            WHEN 'assigned' THEN 'analyst_assigned'
            WHEN 'returned' THEN 'agent_resumed'
            WHEN 'cancelled' THEN 'closed'
            ELSE "status"::text
        END
    )::"HandoffStatus_new";
DROP TYPE "HandoffStatus";
ALTER TYPE "HandoffStatus_new" RENAME TO "HandoffStatus";
ALTER TABLE "Handoff"
    ALTER COLUMN "status" SET DEFAULT 'waiting_analyst',
    ADD CONSTRAINT "Handoff_id_employeeId_key" UNIQUE ("id", "employeeId");

UPDATE "Conversation" c
SET "status" = 'agent_resumed'
WHERE c."status" = 'active'
  AND EXISTS (
      SELECT 1 FROM "Handoff" h
      WHERE h."conversationId" = c."id"
        AND h."employeeId" = c."employeeId"
        AND h."status" = 'agent_resumed'
  );

CREATE UNIQUE INDEX "Handoff_one_active_per_conversation_key"
    ON "Handoff" ("employeeId", "conversationId")
    WHERE "status" IN ('waiting_analyst', 'analyst_assigned');

CREATE TABLE "HandoffEvent" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "handoffId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" "HandoffActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HandoffEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HandoffEvent_handoffId_employeeId_fkey"
        FOREIGN KEY ("handoffId", "employeeId")
        REFERENCES "Handoff" ("id", "employeeId")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HandoffEvent_employeeId_handoffId_createdAt_idx"
    ON "HandoffEvent" ("employeeId", "handoffId", "createdAt");

ALTER TABLE "HandoffEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HandoffEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HandoffEvent_employee_isolation" ON "HandoffEvent"
    USING ("employeeId" = NULLIF(current_setting('app.employee_id', true), '')::uuid)
    WITH CHECK ("employeeId" = NULLIF(current_setting('app.employee_id', true), '')::uuid);
CREATE POLICY "HandoffEvent_analyst_read" ON "HandoffEvent"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "Analyst" a
            WHERE a."id" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              AND a."active"
        )
        AND EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."id" = "HandoffEvent"."handoffId"
              AND (
                  h."status" = 'waiting_analyst'
                  OR h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              )
        )
    );
CREATE POLICY "HandoffEvent_analyst_insert" ON "HandoffEvent"
    FOR INSERT
    WITH CHECK (
        "actorType" = 'analyst'
        AND "actorId" = NULLIF(current_setting('app.analyst_id', true), '')::text
        AND EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."id" = "HandoffEvent"."handoffId"
              AND h."employeeId" = "HandoffEvent"."employeeId"
              AND h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              AND h."status" IN ('analyst_assigned', 'agent_resumed', 'resolved', 'closed')
        )
    );

CREATE POLICY "Handoff_analyst_read" ON "Handoff"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "Analyst" a
            WHERE a."id" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              AND a."active"
        )
        AND (
            "status" = 'waiting_analyst'
            OR "assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
        )
    );
CREATE POLICY "Handoff_analyst_update" ON "Handoff"
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM "Analyst" a
            WHERE a."id" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              AND a."active"
        )
        AND (
            "status" = 'waiting_analyst'
            OR "assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
        )
    )
    WITH CHECK (
        "assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
        AND "status" IN ('analyst_assigned', 'agent_resumed', 'resolved', 'closed')
    );

CREATE POLICY "Conversation_analyst_read" ON "Conversation"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."conversationId" = "Conversation"."id"
              AND h."employeeId" = "Conversation"."employeeId"
              AND (
                  h."status" = 'waiting_analyst'
                  OR h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              )
        )
    );
CREATE POLICY "Conversation_analyst_update" ON "Conversation"
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."conversationId" = "Conversation"."id"
              AND h."employeeId" = "Conversation"."employeeId"
              AND (
                  h."status" = 'waiting_analyst'
                  OR h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              )
        )
    )
    WITH CHECK (
        "status" IN ('analyst_assigned', 'agent_resumed', 'resolved', 'closed')
        AND EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."conversationId" = "Conversation"."id"
              AND h."employeeId" = "Conversation"."employeeId"
              AND h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              AND h."status" IN ('analyst_assigned', 'agent_resumed', 'resolved', 'closed')
        )
    );

CREATE POLICY "Message_analyst_read" ON "Message"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."conversationId" = "Message"."conversationId"
              AND h."employeeId" = "Message"."employeeId"
              AND (
                  h."status" = 'waiting_analyst'
                  OR h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              )
        )
    );
CREATE POLICY "Message_analyst_insert" ON "Message"
    FOR INSERT
    WITH CHECK (
        "actorType" = 'analyst'
        AND "actorId" = NULLIF(current_setting('app.analyst_id', true), '')::text
        AND EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."conversationId" = "Message"."conversationId"
              AND h."employeeId" = "Message"."employeeId"
              AND h."status" = 'analyst_assigned'
              AND h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
        )
    );

CREATE POLICY "Employee_analyst_read" ON "Employee"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "Handoff" h
            WHERE h."employeeId" = "Employee"."id"
              AND (
                  h."status" = 'waiting_analyst'
                  OR h."assignedAnalystId" = NULLIF(current_setting('app.analyst_id', true), '')::uuid
              )
        )
    );
