-- CreateEnum
CREATE TYPE "OutboxMessageStatus" AS ENUM ('PENDING', 'LEASED', 'RETRY', 'COMPLETED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "topic" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxMessageStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "correlationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "outboxMessageId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "organisationId" TEXT,
    "workerId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_topic_idempotencyKey_key" ON "OutboxMessage"("topic", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxMessage_organisationId_topic_idx" ON "OutboxMessage"("organisationId", "topic");

-- CreateIndex
CREATE INDEX "OutboxMessage_leaseUntil_idx" ON "OutboxMessage"("leaseUntil");

-- CreateIndex
CREATE INDEX "JobRun_organisationId_jobType_startedAt_idx" ON "JobRun"("organisationId", "jobType", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_outboxMessageId_idx" ON "JobRun"("outboxMessageId");

-- CreateIndex
CREATE INDEX "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- T21 tenant-context guard (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §3
-- "organisation nullable only for declared platform jobs"; task T21
-- acceptance "tenant context is explicit on tenant jobs"). The application
-- service layer (src/lib/jobs/outbox-service.ts) already enforces the
-- platform-topic allowlist before insert; this trigger is defence-in-depth
-- so a future direct-SQL write cannot silently create an organisation-less
-- row for a non-platform topic.
CREATE FUNCTION outbox_message_require_org_for_non_platform_topic() RETURNS trigger AS $$
BEGIN
  IF NEW."organisationId" IS NULL AND NEW."topic" NOT LIKE 'platform.%' THEN
    RAISE EXCEPTION 'OutboxMessage.organisationId is required for non-platform topic %', NEW."topic"
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_message_require_org
  BEFORE INSERT OR UPDATE ON "OutboxMessage"
  FOR EACH ROW EXECUTE FUNCTION outbox_message_require_org_for_non_platform_topic();
