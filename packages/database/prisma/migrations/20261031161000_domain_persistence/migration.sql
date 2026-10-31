-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'waiting_analyst', 'analyst_assigned', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('active', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "MessageActorType" AS ENUM ('employee', 'assistant', 'analyst', 'system');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('INC', 'REQ');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'awaiting_analyst', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('started', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('pending', 'assigned', 'returned', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('draft', 'published', 'archived');

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "TicketHistory" DROP CONSTRAINT "TicketHistory_ticketId_fkey";

-- DropIndex
DROP INDEX "Conversation_employeeId_updatedAt_idx";

-- DropIndex
DROP INDEX "Ticket_employeeId_status_idx";

-- DropIndex
DROP INDEX "TicketHistory_ticketId_createdAt_idx";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "agentStatus" "AgentStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "closedAt" TIMESTAMPTZ(3),
ADD COLUMN     "messageCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "ConversationStatus" USING (
    CASE lower("status")
        WHEN 'active' THEN 'active'
        WHEN 'waiting_analyst' THEN 'waiting_analyst'
        WHEN 'analyst_assigned' THEN 'analyst_assigned'
        WHEN 'resolved' THEN 'resolved'
        WHEN 'closed' THEN 'closed'
        ELSE NULL
    END
)::"ConversationStatus",
ALTER COLUMN "status" SET DEFAULT 'active';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "department" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeChunk" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "tokenCount" INTEGER;

-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "category" TEXT,
ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
DROP COLUMN "status",
ADD COLUMN     "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "employeeId" UUID,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "metadata" JSONB;

UPDATE "Message" AS message
SET "employeeId" = conversation."employeeId"
FROM "Conversation" AS conversation
WHERE message."conversationId" = conversation."id";

ALTER TABLE "Message"
    ALTER COLUMN "employeeId" SET NOT NULL,
    ALTER COLUMN "actorType" TYPE "MessageActorType" USING (
        CASE lower("actorType")
            WHEN 'employee' THEN 'employee'
            WHEN 'assistant' THEN 'assistant'
            WHEN 'analyst' THEN 'analyst'
            WHEN 'system' THEN 'system'
            ELSE NULL
        END
    )::"MessageActorType";

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolvedAt" TIMESTAMPTZ(3),
ALTER COLUMN "type" TYPE "TicketType" USING (
    CASE upper(btrim("type"))
        WHEN 'INC' THEN 'INC'
        WHEN 'INCIDENT' THEN 'INC'
        WHEN 'REQ' THEN 'REQ'
        WHEN 'REQUEST' THEN 'REQ'
        ELSE NULL
    END
)::"TicketType",
ALTER COLUMN "priority" TYPE "TicketPriority" USING (
    CASE lower(btrim("priority"))
        WHEN 'critical' THEN 'critical'
        WHEN 'crítica' THEN 'critical'
        WHEN 'critica' THEN 'critical'
        WHEN 'high' THEN 'high'
        WHEN 'alta' THEN 'high'
        WHEN 'medium' THEN 'medium'
        WHEN 'média' THEN 'medium'
        WHEN 'media' THEN 'medium'
        WHEN 'low' THEN 'low'
        WHEN 'baixa' THEN 'low'
        ELSE NULL
    END
)::"TicketPriority",
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "TicketStatus" USING (
    CASE lower(btrim("status"))
        WHEN 'open' THEN 'open'
        WHEN 'aberto' THEN 'open'
        WHEN 'awaiting_analyst' THEN 'awaiting_analyst'
        WHEN 'resolved' THEN 'resolved'
        WHEN 'resolvido' THEN 'resolved'
        WHEN 'closed' THEN 'closed'
        WHEN 'encerrado' THEN 'closed'
        ELSE NULL
    END
)::"TicketStatus",
ALTER COLUMN "status" SET DEFAULT 'open';

-- AlterTable
ALTER TABLE "TicketHistory" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "actorType" "MessageActorType" NOT NULL DEFAULT 'system',
ADD COLUMN     "employeeId" UUID,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

UPDATE "TicketHistory" AS history
SET "employeeId" = ticket."employeeId"
FROM "Ticket" AS ticket
WHERE history."ticketId" = ticket."id";

ALTER TABLE "TicketHistory"
    ALTER COLUMN "employeeId" SET NOT NULL,
    ALTER COLUMN "actorType" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Analyst" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Analyst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketIdempotency" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "ticketId" UUID,
    "response" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TicketIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentExecution" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "traceId" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'running',
    "confidence" DOUBLE PRECISION,
    "reason" TEXT,
    "model" TEXT,
    "usage" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAudit" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "toolName" TEXT,
    "inputSummary" TEXT,
    "outputSummary" TEXT,
    "status" "AuditStatus" NOT NULL,
    "sourceRefs" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handoff" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assignedAnalystId" UUID,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Analyst_email_key" ON "Analyst"("email");

-- CreateIndex
CREATE INDEX "TicketIdempotency_employeeId_createdAt_idx" ON "TicketIdempotency"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketIdempotency_employeeId_operation_key_key" ON "TicketIdempotency"("employeeId", "operation", "key");

-- CreateIndex
CREATE INDEX "AgentExecution_employeeId_conversationId_startedAt_idx" ON "AgentExecution"("employeeId", "conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentExecution_status_startedAt_idx" ON "AgentExecution"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_employeeId_traceId_key" ON "AgentExecution"("employeeId", "traceId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentExecution_id_employeeId_key" ON "AgentExecution"("id", "employeeId");

-- CreateIndex
CREATE INDEX "AgentAudit_employeeId_executionId_createdAt_idx" ON "AgentAudit"("employeeId", "executionId", "createdAt");

-- CreateIndex
CREATE INDEX "Handoff_employeeId_conversationId_status_idx" ON "Handoff"("employeeId", "conversationId", "status");

-- CreateIndex
CREATE INDEX "Handoff_status_requestedAt_idx" ON "Handoff"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "Handoff_assignedAnalystId_status_idx" ON "Handoff"("assignedAnalystId", "status");

-- CreateIndex
CREATE INDEX "Conversation_employeeId_status_updatedAt_idx" ON "Conversation"("employeeId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_employeeId_key" ON "Conversation"("id", "employeeId");

-- CreateIndex
CREATE INDEX "Employee_active_name_idx" ON "Employee"("active", "name");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_documentId_idx" ON "KnowledgeChunk"("documentId");

-- CreateIndex
CREATE INDEX "KnowledgeDocument_status_category_idx" ON "KnowledgeDocument"("status", "category");

-- CreateIndex
CREATE INDEX "Message_employeeId_conversationId_createdAt_idx" ON "Message"("employeeId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_employeeId_idempotencyKey_key" ON "Message"("employeeId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Ticket_employeeId_status_updatedAt_idx" ON "Ticket"("employeeId", "status", "updatedAt");

-- CreateIndex
-- CreateIndex
CREATE UNIQUE INDEX "Ticket_id_employeeId_key" ON "Ticket"("id", "employeeId");

-- CreateIndex
CREATE INDEX "TicketHistory_employeeId_ticketId_createdAt_idx" ON "TicketHistory"("employeeId", "ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketHistory_employeeId_idempotencyKey_key" ON "TicketHistory"("employeeId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_employeeId_fkey" FOREIGN KEY ("conversationId", "employeeId") REFERENCES "Conversation"("id", "employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketHistory" ADD CONSTRAINT "TicketHistory_ticketId_employeeId_fkey" FOREIGN KEY ("ticketId", "employeeId") REFERENCES "Ticket"("id", "employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketIdempotency" ADD CONSTRAINT "TicketIdempotency_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketIdempotency" ADD CONSTRAINT "TicketIdempotency_ticketId_employeeId_fkey" FOREIGN KEY ("ticketId", "employeeId") REFERENCES "Ticket"("id", "employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentExecution" ADD CONSTRAINT "AgentExecution_conversationId_employeeId_fkey" FOREIGN KEY ("conversationId", "employeeId") REFERENCES "Conversation"("id", "employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAudit" ADD CONSTRAINT "AgentAudit_executionId_employeeId_fkey" FOREIGN KEY ("executionId", "employeeId") REFERENCES "AgentExecution"("id", "employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_conversationId_employeeId_fkey" FOREIGN KEY ("conversationId", "employeeId") REFERENCES "Conversation"("id", "employeeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_assignedAnalystId_fkey" FOREIGN KEY ("assignedAnalystId") REFERENCES "Analyst"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE SCHEMA IF NOT EXISTS "mastra_storage";

CREATE UNIQUE INDEX "Employee_email_lower_key" ON "Employee" (lower("email"));

CREATE UNIQUE INDEX "Handoff_one_active_per_conversation_key"
    ON "Handoff" ("employeeId", "conversationId")
    WHERE "status" IN ('pending', 'assigned');

ALTER TABLE "Conversation"
    ADD CONSTRAINT "Conversation_messageCount_nonnegative_check"
        CHECK ("messageCount" >= 0),
    ADD CONSTRAINT "Conversation_waiting_pauses_agent_check"
        CHECK (
            "status" NOT IN ('waiting_analyst', 'analyst_assigned')
            OR "agentStatus" = 'paused'
        ),
    ADD CONSTRAINT "Conversation_terminal_completes_agent_check"
        CHECK (
            "status" NOT IN ('resolved', 'closed')
            OR "agentStatus" = 'completed'
        );

ALTER TABLE "Ticket"
    ADD CONSTRAINT "Ticket_version_positive_check" CHECK ("version" > 0),
    ADD CONSTRAINT "Ticket_title_nonempty_check" CHECK (length(btrim("title")) > 0);

ALTER TABLE "AgentExecution"
    ADD CONSTRAINT "AgentExecution_confidence_range_check"
        CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));

ALTER TABLE "Employee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Employee" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Employee_isolation" ON "Employee"
    USING ("id" = NULLIF(current_setting('app.employee_id', true), '')::uuid)
    WITH CHECK ("id" = NULLIF(current_setting('app.employee_id', true), '')::uuid);

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'Conversation',
        'Message',
        'Ticket',
        'TicketHistory',
        'TicketIdempotency',
        'AgentExecution',
        'AgentAudit',
        'Handoff'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format(
            'CREATE POLICY employee_isolation ON %I USING ("employeeId" = NULLIF(current_setting(''app.employee_id'', true), '''')::uuid) WITH CHECK ("employeeId" = NULLIF(current_setting(''app.employee_id'', true), '''')::uuid)',
            table_name
        );
    END LOOP;
END
$$;
