-- AlterEnum
ALTER TYPE "CompetenceAssignmentStatus" ADD VALUE 'EVIDENCE_SUBMITTED';
ALTER TYPE "CompetenceAssignmentStatus" ADD VALUE 'COMPETENT';
ALTER TYPE "CompetenceAssignmentStatus" ADD VALUE 'EXPIRED';

-- CreateEnum
CREATE TYPE "CompetenceEvidenceType" AS ENUM ('TRAINING', 'QUALIFICATION', 'LICENCE', 'EXPERIENCE', 'ASSESSMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetenceEvidenceStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompetenceAssessmentStatus" AS ENUM ('DRAFT', 'COMPLETED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CompetenceAssessmentOutcome" AS ENUM ('COMPETENT', 'NOT_COMPETENT');

-- AlterTable
ALTER TABLE "CompetenceRequirementVersion" ADD COLUMN "trainingSatisfiesRequirement" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompetenceAssignment" ADD COLUMN "competentUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CompetenceEvidence" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "evidenceType" "CompetenceEvidenceType" NOT NULL,
    "issuedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "CompetenceEvidenceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedByMembershipId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedByMembershipId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" "CompetenceAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "method" TEXT NOT NULL,
    "criteria" TEXT,
    "assessorUserId" TEXT,
    "assessedAt" TIMESTAMP(3),
    "outcome" "CompetenceAssessmentOutcome",
    "rationale" TEXT,
    "reassessmentDueDate" TIMESTAMP(3),
    "supersedesAssessmentId" TEXT,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetenceAssignment_organisationId_status_competentUntil_idx" ON "CompetenceAssignment"("organisationId", "status", "competentUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceEvidence_organisationId_id_key" ON "CompetenceEvidence"("organisationId", "id");

-- CreateIndex
CREATE INDEX "CompetenceEvidence_organisationId_assignmentId_idx" ON "CompetenceEvidence"("organisationId", "assignmentId");

-- CreateIndex
CREATE INDEX "CompetenceEvidence_organisationId_personId_idx" ON "CompetenceEvidence"("organisationId", "personId");

-- CreateIndex
CREATE INDEX "CompetenceEvidence_organisationId_expiryDate_idx" ON "CompetenceEvidence"("organisationId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceAssessment_organisationId_id_key" ON "CompetenceAssessment"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceAssessment_organisationId_supersedesAssessmentId_key" ON "CompetenceAssessment"("organisationId", "supersedesAssessmentId");

-- CreateIndex
CREATE INDEX "CompetenceAssessment_organisationId_assignmentId_status_idx" ON "CompetenceAssessment"("organisationId", "assignmentId", "status");

-- AddForeignKey
ALTER TABLE "CompetenceEvidence" ADD CONSTRAINT "CompetenceEvidence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceEvidence" ADD CONSTRAINT "CompetenceEvidence_organisationId_assignmentId_fkey" FOREIGN KEY ("organisationId", "assignmentId") REFERENCES "CompetenceAssignment"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceEvidence" ADD CONSTRAINT "CompetenceEvidence_organisationId_personId_fkey" FOREIGN KEY ("organisationId", "personId") REFERENCES "PersonProfile"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceEvidence" ADD CONSTRAINT "CompetenceEvidence_organisationId_submittedByMembershipId_fkey" FOREIGN KEY ("organisationId", "submittedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceEvidence" ADD CONSTRAINT "CompetenceEvidence_organisationId_verifiedByMembershipId_fkey" FOREIGN KEY ("organisationId", "verifiedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssessment" ADD CONSTRAINT "CompetenceAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssessment" ADD CONSTRAINT "CompetenceAssessment_organisationId_assignmentId_fkey" FOREIGN KEY ("organisationId", "assignmentId") REFERENCES "CompetenceAssignment"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssessment" ADD CONSTRAINT "CompetenceAssessment_organisationId_supersedesAssessmentId_fkey" FOREIGN KEY ("organisationId", "supersedesAssessmentId") REFERENCES "CompetenceAssessment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssessment" ADD CONSTRAINT "CompetenceAssessment_organisationId_createdByMembershipId_fkey" FOREIGN KEY ("organisationId", "createdByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: once a CompetenceAssessment has left DRAFT (i.e. been
-- COMPLETED) it is never edited in place — a reassessment supersedes it via
-- a new row, mirroring the CompetenceRequirementVersion convention (T70)
-- exactly. status/supersedesAssessmentId/updatedAt remain writable so the
-- supersede transition itself can still update the row.
CREATE FUNCTION competence_assessment_immutable_once_completed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" != 'DRAFT' THEN
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'CompetenceAssessment % cannot move back to DRAFT once completed', OLD."id"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId"
      OR NEW."method" IS DISTINCT FROM OLD."method"
      OR NEW."criteria" IS DISTINCT FROM OLD."criteria"
      OR NEW."assessorUserId" IS DISTINCT FROM OLD."assessorUserId"
      OR NEW."assessedAt" IS DISTINCT FROM OLD."assessedAt"
      OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
      OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
      OR NEW."reassessmentDueDate" IS DISTINCT FROM OLD."reassessmentDueDate"
    THEN
      RAISE EXCEPTION 'CompetenceAssessment % is % and its content fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER competence_assessment_immutable
  BEFORE UPDATE ON "CompetenceAssessment"
  FOR EACH ROW EXECUTE FUNCTION competence_assessment_immutable_once_completed();
