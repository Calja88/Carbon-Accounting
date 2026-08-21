-- T84: licensed standard and competent review checklist
-- (Docs/PHASE8_HARDENING_READINESS_SPEC.md §8 "T84 licensed and competent
-- review"). Adds gap tracking, an owner decision, and a competent-review
-- record to the existing identifier-only StandardRequirementMap row. No
-- column here stores standard text.

-- CreateEnum
CREATE TYPE "StandardRequirementGapStatus" AS ENUM ('NOT_ASSESSED', 'NO_GAP', 'GAP_IDENTIFIED', 'REMEDIATION_PLANNED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "StandardRequirementReviewOutcome" AS ENUM ('NOT_REVIEWED', 'REVIEWED_NO_ISSUES', 'REVIEWED_ISSUES_FOUND');

-- AlterTable
ALTER TABLE "StandardRequirementMap"
  ADD COLUMN "gapStatus" "StandardRequirementGapStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
  ADD COLUMN "gapDescription" TEXT,
  ADD COLUMN "ownerDecision" TEXT,
  ADD COLUMN "ownerDecisionAt" TIMESTAMP(3),
  ADD COLUMN "competentReviewerUserId" TEXT,
  ADD COLUMN "competentReviewedAt" TIMESTAMP(3),
  ADD COLUMN "competentReviewOutcome" "StandardRequirementReviewOutcome" DEFAULT 'NOT_REVIEWED',
  ADD COLUMN "competentReviewNotes" TEXT;

-- AddForeignKey
ALTER TABLE "StandardRequirementMap" ADD CONSTRAINT "StandardRequirementMap_competentReviewerUserId_fkey" FOREIGN KEY ("competentReviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "StandardRequirementMap_organisationId_gapStatus_idx" ON "StandardRequirementMap"("organisationId", "gapStatus");
