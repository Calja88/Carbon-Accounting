-- CreateEnum
CREATE TYPE "ComplianceEvaluationProgrammeStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ComplianceEvaluationStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ISSUED');

-- CreateEnum
CREATE TYPE "ComplianceEvaluationItemStatus" AS ENUM ('NOT_EVALUATED', 'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NONCOMPLIANT', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ComplianceEvaluationFindingLinkType" AS ENUM ('NONCONFORMITY', 'CORRECTIVE_ACTION');

-- CreateTable
CREATE TABLE "ComplianceEvaluationProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'ONCE',
    "leadMembershipId" TEXT NOT NULL,
    "status" "ComplianceEvaluationProgrammeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceEvaluationProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvaluation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "leadMembershipId" TEXT NOT NULL,
    "status" "ComplianceEvaluationStatus" NOT NULL DEFAULT 'PLANNED',
    "reportPayload" JSONB,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvaluationScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceEvaluationScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvaluationItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "obligationVersionId" TEXT NOT NULL,
    "status" "ComplianceEvaluationItemStatus" NOT NULL DEFAULT 'NOT_EVALUATED',
    "rationale" TEXT,
    "evaluatorMembershipId" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceEvaluationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceEvaluationFindingLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "evaluationItemId" TEXT NOT NULL,
    "linkType" "ComplianceEvaluationFindingLinkType" NOT NULL,
    "referenceNote" TEXT NOT NULL,
    "requestedByMembershipId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceEvaluationFindingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComplianceEvaluationProgramme_organisationId_status_idx" ON "ComplianceEvaluationProgramme"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluationProgramme_organisationId_id_key" ON "ComplianceEvaluationProgramme"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ComplianceEvaluation_organisationId_programmeId_status_idx" ON "ComplianceEvaluation"("organisationId", "programmeId", "status");

-- CreateIndex
CREATE INDEX "ComplianceEvaluation_organisationId_status_idx" ON "ComplianceEvaluation"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluation_organisationId_id_key" ON "ComplianceEvaluation"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationScope_organisationId_evaluationId_idx" ON "ComplianceEvaluationScope"("organisationId", "evaluationId");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationScope_organisationId_entityId_idx" ON "ComplianceEvaluationScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationScope_organisationId_siteId_idx" ON "ComplianceEvaluationScope"("organisationId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluationScope_scope_key" ON "ComplianceEvaluationScope"("organisationId", "evaluationId", "entityId", "siteId");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationItem_organisationId_evaluationId_status_idx" ON "ComplianceEvaluationItem"("organisationId", "evaluationId", "status");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationItem_organisationId_obligationVersionId_idx" ON "ComplianceEvaluationItem"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluationItem_organisationId_id_key" ON "ComplianceEvaluationItem"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceEvaluationItem_unique_per_evaluation" ON "ComplianceEvaluationItem"("organisationId", "evaluationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ComplianceEvaluationFindingLink_organisationId_evaluationIt_idx" ON "ComplianceEvaluationFindingLink"("organisationId", "evaluationItemId");

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationProgramme" ADD CONSTRAINT "ComplianceEvaluationProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationProgramme" ADD CONSTRAINT "ComplianceEvaluationProgramme_organisationId_leadMembershi_fkey" FOREIGN KEY ("organisationId", "leadMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluation" ADD CONSTRAINT "ComplianceEvaluation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluation" ADD CONSTRAINT "ComplianceEvaluation_organisationId_programmeId_fkey" FOREIGN KEY ("organisationId", "programmeId") REFERENCES "ComplianceEvaluationProgramme"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluation" ADD CONSTRAINT "ComplianceEvaluation_organisationId_leadMembershipId_fkey" FOREIGN KEY ("organisationId", "leadMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationScope" ADD CONSTRAINT "ComplianceEvaluationScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationScope" ADD CONSTRAINT "ComplianceEvaluationScope_organisationId_evaluationId_fkey" FOREIGN KEY ("organisationId", "evaluationId") REFERENCES "ComplianceEvaluation"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationScope" ADD CONSTRAINT "ComplianceEvaluationScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationScope" ADD CONSTRAINT "ComplianceEvaluationScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationItem" ADD CONSTRAINT "ComplianceEvaluationItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationItem" ADD CONSTRAINT "ComplianceEvaluationItem_organisationId_evaluationId_fkey" FOREIGN KEY ("organisationId", "evaluationId") REFERENCES "ComplianceEvaluation"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationItem" ADD CONSTRAINT "ComplianceEvaluationItem_organisationId_obligationVersionI_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationItem" ADD CONSTRAINT "ComplianceEvaluationItem_organisationId_evaluatorMembershi_fkey" FOREIGN KEY ("organisationId", "evaluatorMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationFindingLink" ADD CONSTRAINT "ComplianceEvaluationFindingLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationFindingLink" ADD CONSTRAINT "ComplianceEvaluationFindingLink_organisationId_evaluationI_fkey" FOREIGN KEY ("organisationId", "evaluationItemId") REFERENCES "ComplianceEvaluationItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceEvaluationFindingLink" ADD CONSTRAINT "ComplianceEvaluationFindingLink_organisationId_requestedBy_fkey" FOREIGN KEY ("organisationId", "requestedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: once a ComplianceEvaluation is ISSUED it is fully frozen —
-- no further updates of any kind (T45 acceptance: "issued evaluation pins
-- exact obligation versions and is immutable"). It may also never move
-- backward (COMPLETED -> IN_PROGRESS/PLANNED, IN_PROGRESS -> PLANNED),
-- mirroring the forward-only shape of T44's
-- compliance_obligation_version_immutable trigger, just with a stricter
-- terminal state (ISSUED has no writable columns at all, since
-- reportPayload/issuedAt/issuedByUserId are set in the same UPDATE that
-- performs the COMPLETED -> ISSUED transition, while OLD.status is still
-- COMPLETED).
CREATE FUNCTION compliance_evaluation_immutable_once_issued() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'ISSUED' THEN
    RAISE EXCEPTION 'ComplianceEvaluation % is ISSUED and immutable', OLD."id"
      USING ERRCODE = '23000';
  END IF;
  IF (OLD."status" = 'COMPLETED' AND NEW."status" NOT IN ('COMPLETED', 'ISSUED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'PLANNED')
  THEN
    RAISE EXCEPTION 'ComplianceEvaluation % cannot move backward from % to %', OLD."id", OLD."status", NEW."status"
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_evaluation_immutable
  BEFORE UPDATE ON "ComplianceEvaluation"
  FOR EACH ROW EXECUTE FUNCTION compliance_evaluation_immutable_once_issued();

-- Immutability: once a ComplianceEvaluationItem's parent evaluation has left
-- IN_PROGRESS (i.e. is COMPLETED or ISSUED), the item is frozen — no result
-- can be silently revised after the evaluation that decided it has closed
-- (T45 acceptance: "results never auto-decided", spec §9 "issued evaluation
-- ... is immutable"). Mirrors the T44/T22 immutable-trigger shape, but reads
-- its freeze condition from the parent row rather than its own `status`
-- column, since the item's own status enum (NOT_EVALUATED/COMPLIANT/...) has
-- no terminal value of its own to key off.
CREATE FUNCTION compliance_evaluation_item_immutable_once_locked() RETURNS trigger AS $$
DECLARE
  eval_status "ComplianceEvaluationStatus";
BEGIN
  SELECT "status" INTO eval_status FROM "ComplianceEvaluation" WHERE "id" = OLD."evaluationId";
  IF eval_status IN ('COMPLETED', 'ISSUED') THEN
    RAISE EXCEPTION 'ComplianceEvaluationItem % cannot be modified once its evaluation is %', OLD."id", eval_status
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_evaluation_item_immutable
  BEFORE UPDATE ON "ComplianceEvaluationItem"
  FOR EACH ROW EXECUTE FUNCTION compliance_evaluation_item_immutable_once_locked();
