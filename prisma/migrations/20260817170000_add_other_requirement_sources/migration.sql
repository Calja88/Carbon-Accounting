-- T46: other requirements and manual legal sources only. No environmental
-- data or reference records are seeded.

-- CreateEnum
CREATE TYPE "OtherRequirementSourceType" AS ENUM ('PERMIT', 'CONSENT', 'REGULATOR_NOTICE', 'CONTRACT', 'CUSTOMER_REQUIREMENT', 'VOLUNTARY_COMMITMENT');

-- CreateEnum
CREATE TYPE "OtherRequirementSourceStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "OtherRequirementSource" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "OtherRequirementSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "issuingParty" TEXT NOT NULL,
    "reference" TEXT,
    "description" TEXT,
    "issuedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "status" "OtherRequirementSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerMembershipId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtherRequirementSource_pkey" PRIMARY KEY ("id")
);

-- AlterTable: ApplicabilityAssessment may now be sourced from a manual
-- OtherRequirementSource instead of a LegalInstrument (spec §5
-- "source/instrument/change/other requirement"). instrumentId becomes
-- optional; the new otherRequirementSourceId column is its alternative.
ALTER TABLE "ApplicabilityAssessment"
  ALTER COLUMN "instrumentId" DROP NOT NULL,
  ADD COLUMN "otherRequirementSourceId" TEXT;

-- AlterTable: ComplianceObligationVersion inherits the same either/or
-- source link from the assessment it is created from.
ALTER TABLE "ComplianceObligationVersion"
  ALTER COLUMN "instrumentId" DROP NOT NULL,
  ADD COLUMN "otherRequirementSourceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OtherRequirementSource_organisationId_id_key" ON "OtherRequirementSource"("organisationId", "id");

-- CreateIndex
CREATE INDEX "OtherRequirementSource_organisationId_status_idx" ON "OtherRequirementSource"("organisationId", "status");

-- CreateIndex
CREATE INDEX "OtherRequirementSource_organisationId_type_idx" ON "OtherRequirementSource"("organisationId", "type");

-- CreateIndex
CREATE INDEX "OtherRequirementSource_organisationId_nextReviewAt_idx" ON "OtherRequirementSource"("organisationId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessment_organisationId_otherRequirementSour_idx" ON "ApplicabilityAssessment"("organisationId", "otherRequirementSourceId", "status");

-- CreateIndex
CREATE INDEX "ComplianceObligationVersion_organisationId_otherRequirement_idx" ON "ComplianceObligationVersion"("organisationId", "otherRequirementSourceId");

-- AddForeignKey
ALTER TABLE "OtherRequirementSource" ADD CONSTRAINT "OtherRequirementSource_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtherRequirementSource" ADD CONSTRAINT "OtherRequirementSource_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_otherRequirementSou_fkey" FOREIGN KEY ("organisationId", "otherRequirementSourceId") REFERENCES "OtherRequirementSource"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_organisationId_otherRequiremen_fkey" FOREIGN KEY ("organisationId", "otherRequirementSourceId") REFERENCES "OtherRequirementSource"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defence-in-depth: exactly one of instrumentId/otherRequirementSourceId
-- must be set on each row (service-layer rule in applicability-service.ts
-- and obligation-service.ts), the same "exactly one of N" invariant already
-- enforced only by application code for ApplicabilityAssessmentScope/
-- ComplianceObligationVersionScope's entity/site/process/aspect columns —
-- here promoted to a CHECK constraint since exactly two columns are
-- involved rather than four.
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_source_xor" CHECK (
  ((("instrumentId" IS NOT NULL))::int + (("otherRequirementSourceId" IS NOT NULL))::int) = 1
);

ALTER TABLE "ComplianceObligationVersion" ADD CONSTRAINT "ComplianceObligationVersion_source_xor" CHECK (
  ((("instrumentId" IS NOT NULL))::int + (("otherRequirementSourceId" IS NOT NULL))::int) = 1
);

-- Replace the T44 immutability trigger function so an ACTIVE/SUPERSEDED/
-- RETIRED/REJECTED version's new otherRequirementSourceId column is
-- covered by the same "approved record immutable" guarantee its
-- instrumentId column already had. CREATE OR REPLACE keeps the original
-- 20260817150000 migration file untouched — only the function body (never
-- an already-applied migration) changes here.
CREATE OR REPLACE FUNCTION compliance_obligation_version_immutable_once_approved() RETURNS trigger AS $$
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
      OR NEW."otherRequirementSourceId" IS DISTINCT FROM OLD."otherRequirementSourceId"
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
