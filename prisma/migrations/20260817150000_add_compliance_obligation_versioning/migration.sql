-- T44: compliance obligation versioning and approval only. No environmental
-- data or reference records are seeded.

-- CreateEnum
CREATE TYPE "ComplianceObligationVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'RETIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplianceObligationApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ObligationChangeReviewDecision" AS ENUM ('NO_CHANGE', 'REVISE', 'RETIRE', 'SEEK_ADVICE');

-- CreateTable
CREATE TABLE "ComplianceObligation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceObligationVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "requirementSummary" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "provisionReferenceId" TEXT,
    "applicabilityAssessmentId" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "frequency" TEXT,
    "triggerDescription" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "reviewDueDate" TIMESTAMP(3),
    "status" "ComplianceObligationVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceObligationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceObligationVersionScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "obligationVersionId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "aspectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceObligationVersionScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceObligationVersionControl" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "obligationVersionId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceObligationVersionControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceObligationApproval" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "obligationVersionId" TEXT NOT NULL,
    "decision" "ComplianceObligationApprovalDecision" NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "comment" TEXT,
    "approverMembershipId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceObligationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObligationChangeReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "changeEventId" TEXT NOT NULL,
    "obligationVersionId" TEXT NOT NULL,
    "impactAssessment" TEXT NOT NULL,
    "decision" "ObligationChangeReviewDecision",
    "reviewerMembershipId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObligationChangeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligation_activeVersionId_key" ON "ComplianceObligation"("activeVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligation_organisationId_idx" ON "ComplianceObligation"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligation_organisationId_id_key" ON "ComplianceObligation"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligation_organisationId_activeVersionId_key" ON "ComplianceObligation"("organisationId", "activeVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersion_organisationId_obligationId_sta_idx" ON "ComplianceObligationVersion"("organisationId", "obligationId", "status");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersion_organisationId_status_idx" ON "ComplianceObligationVersion"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersion_organisationId_instrumentId_idx" ON "ComplianceObligationVersion"("organisationId", "instrumentId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersion_organisationId_ownerMembershipI_idx" ON "ComplianceObligationVersion"("organisationId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationVersion_organisationId_id_key" ON "ComplianceObligationVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationVersion_organisationId_obligationId_ver_key" ON "ComplianceObligationVersion"("organisationId", "obligationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationVersion_organisationId_supersedesVersio_key" ON "ComplianceObligationVersion"("organisationId", "supersedesVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionScope_organisationId_obligationV_idx" ON "ComplianceObligationVersionScope"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionScope_organisationId_entityId_idx" ON "ComplianceObligationVersionScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionScope_organisationId_siteId_idx" ON "ComplianceObligationVersionScope"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionScope_organisationId_aspectId_idx" ON "ComplianceObligationVersionScope"("organisationId", "aspectId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationVersionScope_scope_key" ON "ComplianceObligationVersionScope"("organisationId", "obligationVersionId", "entityId", "siteId", "aspectId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionControl_organisationId_obligatio_idx" ON "ComplianceObligationVersionControl"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersionControl_organisationId_controlId_idx" ON "ComplianceObligationVersionControl"("organisationId", "controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceObligationVersionControl_link_key" ON "ComplianceObligationVersionControl"("organisationId", "obligationVersionId", "controlId");

-- CreateIndex
CREATE INDEX "ComplianceObligationApproval_organisationId_obligationVersi_idx" ON "ComplianceObligationApproval"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ComplianceObligationApproval_organisationId_approverMembers_idx" ON "ComplianceObligationApproval"("organisationId", "approverMembershipId");

-- CreateIndex
CREATE INDEX "ObligationChangeReview_organisationId_obligationVersionId_idx" ON "ObligationChangeReview"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ObligationChangeReview_organisationId_changeEventId_idx" ON "ObligationChangeReview"("organisationId", "changeEventId");

-- AddForeignKey
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligation" ADD CONSTRAINT "ComplianceObligation_organisationId_activeVersionId_fkey" FOREIGN KEY ("organisationId", "activeVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_obligationId_fkey" FOREIGN KEY ("organisationId", "obligationId") REFERENCES "ComplianceObligation"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_provisionReferenceId_fkey" FOREIGN KEY ("provisionReferenceId") REFERENCES "LegalProvisionReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_applicabilityAs_fkey" FOREIGN KEY ("organisationId", "applicabilityAssessmentId") REFERENCES "ApplicabilityAssessment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_ownerMembership_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_supersedesVersi_fkey" FOREIGN KEY ("organisationId", "supersedesVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionScope" ADD CONSTRAINT "ComplianceObligationVersionScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionScope" ADD CONSTRAINT "ComplianceObligationVersionScope_organisationId_obligation_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionScope" ADD CONSTRAINT "ComplianceObligationVersionScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionScope" ADD CONSTRAINT "ComplianceObligationVersionScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionScope" ADD CONSTRAINT "ComplianceObligationVersionScope_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionControl" ADD CONSTRAINT "ComplianceObligationVersionControl_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionControl" ADD CONSTRAINT "ComplianceObligationVersionControl_organisationId_obligati_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersionControl" ADD CONSTRAINT "ComplianceObligationVersionControl_organisationId_controlI_fkey" FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationApproval" ADD CONSTRAINT "ComplianceObligationApproval_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationApproval" ADD CONSTRAINT "ComplianceObligationApproval_organisationId_obligationVers_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationApproval" ADD CONSTRAINT "ComplianceObligationApproval_organisationId_approverMember_fkey" FOREIGN KEY ("organisationId", "approverMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationChangeReview" ADD CONSTRAINT "ObligationChangeReview_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationChangeReview" ADD CONSTRAINT "ObligationChangeReview_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "LegalChangeEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationChangeReview" ADD CONSTRAINT "ObligationChangeReview_organisationId_obligationVersionId_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObligationChangeReview" ADD CONSTRAINT "ObligationChangeReview_organisationId_reviewerMembershipId_fkey" FOREIGN KEY ("organisationId", "reviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: once a ComplianceObligationVersion has left DRAFT/IN_REVIEW
-- it may never move back to DRAFT/IN_REVIEW, and its content columns become
-- read-only (T44 acceptance: "approved record immutable; edits create
-- successor"). Mirrors the T22 controlled_document_revision_immutable
-- trigger exactly. status/approvedByUserId/approvedAt/updatedAt remain
-- writable so the approve/reject/return/retire transitions themselves can
-- still update the row.
CREATE FUNCTION compliance_obligation_version_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('DRAFT', 'IN_REVIEW') THEN
    IF NEW."status" IN ('DRAFT', 'IN_REVIEW') THEN
      RAISE EXCEPTION 'ComplianceObligationVersion % cannot move back to % once it has left draft/review', OLD."id", NEW."status"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."obligationId" IS DISTINCT FROM OLD."obligationId"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."requirementSummary" IS DISTINCT FROM OLD."requirementSummary"
      OR NEW."instrumentId" IS DISTINCT FROM OLD."instrumentId"
      OR NEW."provisionReferenceId" IS DISTINCT FROM OLD."provisionReferenceId"
      OR NEW."applicabilityAssessmentId" IS DISTINCT FROM OLD."applicabilityAssessmentId"
      OR NEW."ownerMembershipId" IS DISTINCT FROM OLD."ownerMembershipId"
      OR NEW."frequency" IS DISTINCT FROM OLD."frequency"
      OR NEW."triggerDescription" IS DISTINCT FROM OLD."triggerDescription"
      OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
      OR NEW."reviewDueDate" IS DISTINCT FROM OLD."reviewDueDate"
      OR NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId"
      OR NEW."preparedByUserId" IS DISTINCT FROM OLD."preparedByUserId"
      OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
    THEN
      RAISE EXCEPTION 'ComplianceObligationVersion % is % and its content fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_obligation_version_immutable
  BEFORE UPDATE ON "ComplianceObligationVersion"
  FOR EACH ROW EXECUTE FUNCTION compliance_obligation_version_immutable_once_approved();
