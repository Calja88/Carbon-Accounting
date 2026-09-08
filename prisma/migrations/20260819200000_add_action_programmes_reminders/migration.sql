-- CreateEnum
CREATE TYPE "ActionProgrammeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'VERIFIED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActionStatusHistoryEventType" AS ENUM ('STATUS_CHANGE', 'REASSIGNED', 'REOPENED');

-- CreateTable
CREATE TABLE "ActionProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "title" TEXT NOT NULL,
    "resourcesDescription" TEXT,
    "ownerMembershipId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "status" "ActionProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "ActionPriority" NOT NULL DEFAULT 'MEDIUM',
    "ownerMembershipId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completionCriteria" TEXT,
    "status" "ActionItemStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completionEvidenceNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionDependency" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "dependsOnActionItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProgressUpdate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "progressPercent" INTEGER,
    "note" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionStatusHistory" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "eventType" "ActionStatusHistoryEventType" NOT NULL,
    "fromStatus" "ActionItemStatus",
    "toStatus" "ActionItemStatus",
    "previousOwnerMembershipId" TEXT,
    "newOwnerMembershipId" TEXT,
    "note" TEXT,
    "actorUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionProgramme_organisationId_objectiveId_idx" ON "ActionProgramme"("organisationId", "objectiveId");

-- CreateIndex
CREATE INDEX "ActionProgramme_organisationId_status_idx" ON "ActionProgramme"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ActionProgramme_organisationId_ownerMembershipId_idx" ON "ActionProgramme"("organisationId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionProgramme_organisationId_id_key" ON "ActionProgramme"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ActionItem_organisationId_programmeId_idx" ON "ActionItem"("organisationId", "programmeId");

-- CreateIndex
CREATE INDEX "ActionItem_organisationId_status_idx" ON "ActionItem"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ActionItem_organisationId_ownerMembershipId_idx" ON "ActionItem"("organisationId", "ownerMembershipId");

-- CreateIndex
CREATE INDEX "ActionItem_organisationId_dueDate_idx" ON "ActionItem"("organisationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ActionItem_organisationId_id_key" ON "ActionItem"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ActionDependency_organisationId_actionItemId_idx" ON "ActionDependency"("organisationId", "actionItemId");

-- CreateIndex
CREATE INDEX "ActionDependency_organisationId_dependsOnActionItemId_idx" ON "ActionDependency"("organisationId", "dependsOnActionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionDependency_organisationId_actionItemId_dependsOnActio_key" ON "ActionDependency"("organisationId", "actionItemId", "dependsOnActionItemId");

-- CreateIndex
CREATE INDEX "ActionProgressUpdate_organisationId_actionItemId_idx" ON "ActionProgressUpdate"("organisationId", "actionItemId");

-- CreateIndex
CREATE INDEX "ActionStatusHistory_organisationId_actionItemId_idx" ON "ActionStatusHistory"("organisationId", "actionItemId");

-- AddForeignKey
ALTER TABLE "ActionProgramme" ADD CONSTRAINT "ActionProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProgramme" ADD CONSTRAINT "ActionProgramme_organisationId_objectiveId_fkey" FOREIGN KEY ("organisationId", "objectiveId") REFERENCES "EnvironmentalObjective"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProgramme" ADD CONSTRAINT "ActionProgramme_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_organisationId_programmeId_fkey" FOREIGN KEY ("organisationId", "programmeId") REFERENCES "ActionProgramme"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDependency" ADD CONSTRAINT "ActionDependency_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDependency" ADD CONSTRAINT "ActionDependency_organisationId_actionItemId_fkey" FOREIGN KEY ("organisationId", "actionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionDependency" ADD CONSTRAINT "ActionDependency_organisationId_dependsOnActionItemId_fkey" FOREIGN KEY ("organisationId", "dependsOnActionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProgressUpdate" ADD CONSTRAINT "ActionProgressUpdate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProgressUpdate" ADD CONSTRAINT "ActionProgressUpdate_organisationId_actionItemId_fkey" FOREIGN KEY ("organisationId", "actionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionStatusHistory" ADD CONSTRAINT "ActionStatusHistory_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionStatusHistory" ADD CONSTRAINT "ActionStatusHistory_organisationId_actionItemId_fkey" FOREIGN KEY ("organisationId", "actionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutability: once an ActionItem reaches COMPLETED, VERIFIED or
-- CANCELLED it is "closed" (T52 acceptance: "closed action immutable
-- except reopen event"). Every content column becomes read-only, and the
-- only further transition allowed is into REOPENED (setting
-- reopenedAt/reopenedByUserId/reopenReason) — which is not itself closed,
-- so a reopened action can be edited normally again by a later,
-- non-trigger-blocked update. Mirrors the
-- environmental_objective_version_immutable_once_approved /
-- objective_metric_version_immutable_once_approved trigger pattern (T50).
CREATE FUNCTION action_item_immutable_once_closed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'VERIFIED', 'CANCELLED') THEN
    IF NEW."status" = 'REOPENED' THEN
      IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
        OR NEW."title" IS DISTINCT FROM OLD."title"
        OR NEW."description" IS DISTINCT FROM OLD."description"
        OR NEW."priority" IS DISTINCT FROM OLD."priority"
        OR NEW."ownerMembershipId" IS DISTINCT FROM OLD."ownerMembershipId"
        OR NEW."startDate" IS DISTINCT FROM OLD."startDate"
        OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
        OR NEW."completionCriteria" IS DISTINCT FROM OLD."completionCriteria"
        OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
        OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId"
        OR NEW."completionEvidenceNote" IS DISTINCT FROM OLD."completionEvidenceNote"
        OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
        OR NEW."verifiedByUserId" IS DISTINCT FROM OLD."verifiedByUserId"
      THEN
        RAISE EXCEPTION 'ActionItem % is % and only status/reopen fields may change on reopen', OLD."id", OLD."status"
          USING ERRCODE = '23000';
      END IF;
    ELSIF NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'ActionItem % cannot move from % to % — only REOPENED is reachable from a closed action', OLD."id", OLD."status", NEW."status"
        USING ERRCODE = '23000';
    ELSE
      IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
        OR NEW."title" IS DISTINCT FROM OLD."title"
        OR NEW."description" IS DISTINCT FROM OLD."description"
        OR NEW."priority" IS DISTINCT FROM OLD."priority"
        OR NEW."ownerMembershipId" IS DISTINCT FROM OLD."ownerMembershipId"
        OR NEW."startDate" IS DISTINCT FROM OLD."startDate"
        OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
        OR NEW."completionCriteria" IS DISTINCT FROM OLD."completionCriteria"
        OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
        OR NEW."completedByUserId" IS DISTINCT FROM OLD."completedByUserId"
        OR NEW."completionEvidenceNote" IS DISTINCT FROM OLD."completionEvidenceNote"
        OR NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt"
        OR NEW."verifiedByUserId" IS DISTINCT FROM OLD."verifiedByUserId"
        OR NEW."reopenedAt" IS DISTINCT FROM OLD."reopenedAt"
        OR NEW."reopenedByUserId" IS DISTINCT FROM OLD."reopenedByUserId"
        OR NEW."reopenReason" IS DISTINCT FROM OLD."reopenReason"
      THEN
        RAISE EXCEPTION 'ActionItem % is % and its content fields are immutable except through an explicit reopen', OLD."id", OLD."status"
          USING ERRCODE = '23000';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER action_item_immutable
  BEFORE UPDATE ON "ActionItem"
  FOR EACH ROW EXECUTE FUNCTION action_item_immutable_once_closed();
