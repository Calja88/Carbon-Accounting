-- CreateEnum
CREATE TYPE "EmsProgrammeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EmsCertificationIntent" AS ENUM ('NONE', 'PLANNED', 'CERTIFIED_EXTERNALLY');

-- CreateEnum
CREATE TYPE "EmsScopeVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EmsRequirementImplementationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ContextIssueType" AS ENUM ('INTERNAL', 'EXTERNAL', 'ENVIRONMENTAL_CONDITION');

-- CreateEnum
CREATE TYPE "ContextIssueDirection" AS ENUM ('AFFECTS_ORGANISATION', 'AFFECTED_BY_ORGANISATION', 'BOTH');

-- CreateEnum
CREATE TYPE "InterestedPartyInfluence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EmsRiskOpportunityKind" AS ENUM ('RISK', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "EmsRiskOpportunityStatus" AS ENUM ('OPEN', 'MONITORING', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeAssessmentStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'IMPLEMENTED', 'EFFECTIVENESS_REVIEWED');

-- CreateTable
CREATE TABLE "EmsProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EmsProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
    "standardsProfile" TEXT NOT NULL,
    "standardsProfileVersion" TEXT NOT NULL,
    "certificationIntent" "EmsCertificationIntent" NOT NULL DEFAULT 'NONE',
    "ownerMembershipId" TEXT,
    "currentScopeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmsProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsScopeVersion" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "EmsScopeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "exclusions" TEXT,
    "exclusionsRationale" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "reviewDueDate" TIMESTAMP(3),
    "preparedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmsScopeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsScopeEntity" (
    "id" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmsScopeEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsScopeSite" (
    "id" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmsScopeSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsScopeActivity" (
    "id" TEXT NOT NULL,
    "scopeVersionId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "siteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmsScopeActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardRequirementMap" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "standardProfile" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "implementationStatus" "EmsRequirementImplementationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "ownerMembershipId" TEXT,
    "reviewDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardRequirementMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextIssue" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "ContextIssueType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "direction" "ContextIssueDirection" NOT NULL,
    "significance" TEXT,
    "ownerMembershipId" TEXT,
    "reviewDate" TIMESTAMP(3),
    "activeFrom" TIMESTAMP(3),
    "activeUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestedParty" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "influence" "InterestedPartyInfluence",
    "relationshipOwnerMembershipId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterestedParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestedPartyRequirement" (
    "id" TEXT NOT NULL,
    "interestedPartyId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceReference" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "evaluationDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterestedPartyRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsRiskOpportunity" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "EmsRiskOpportunityKind" NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "consequence" TEXT,
    "likelihood" TEXT,
    "ratingScaleVersion" TEXT NOT NULL,
    "initialRating" JSONB NOT NULL,
    "residualRating" JSONB,
    "status" "EmsRiskOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "ownerMembershipId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmsRiskOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeAssessment" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "proposedChange" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerDate" TIMESTAMP(3),
    "affectedRefs" JSONB,
    "assessment" TEXT,
    "decision" TEXT,
    "status" "ChangeAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "implementedAt" TIMESTAMP(3),
    "effectivenessReview" TEXT,
    "effectivenessReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalPolicyRecord" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "controlledDocumentRevisionId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentalPolicyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmsProgramme_currentScopeVersionId_key" ON "EmsProgramme"("currentScopeVersionId");

-- CreateIndex
CREATE INDEX "EmsProgramme_organisationId_status_idx" ON "EmsProgramme"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmsProgramme_organisationId_name_key" ON "EmsProgramme"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EmsProgramme_organisationId_id_key" ON "EmsProgramme"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeVersion_supersedesVersionId_key" ON "EmsScopeVersion"("supersedesVersionId");

-- CreateIndex
CREATE INDEX "EmsScopeVersion_organisationId_status_idx" ON "EmsScopeVersion"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeVersion_programmeId_versionNumber_key" ON "EmsScopeVersion"("programmeId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeVersion_organisationId_id_key" ON "EmsScopeVersion"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmsScopeEntity_organisationId_entityId_idx" ON "EmsScopeEntity"("organisationId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeEntity_scopeVersionId_entityId_key" ON "EmsScopeEntity"("scopeVersionId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeEntity_organisationId_id_key" ON "EmsScopeEntity"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmsScopeSite_organisationId_siteId_idx" ON "EmsScopeSite"("organisationId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeSite_scopeVersionId_siteId_key" ON "EmsScopeSite"("scopeVersionId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeSite_organisationId_id_key" ON "EmsScopeSite"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmsScopeActivity_organisationId_scopeVersionId_idx" ON "EmsScopeActivity"("organisationId", "scopeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsScopeActivity_organisationId_id_key" ON "EmsScopeActivity"("organisationId", "id");

-- CreateIndex
CREATE INDEX "StandardRequirementMap_organisationId_programmeId_idx" ON "StandardRequirementMap"("organisationId", "programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "StandardRequirementMap_programmeId_standardProfile_requirem_key" ON "StandardRequirementMap"("programmeId", "standardProfile", "requirementKey");

-- CreateIndex
CREATE UNIQUE INDEX "StandardRequirementMap_organisationId_id_key" ON "StandardRequirementMap"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ContextIssue_organisationId_programmeId_type_idx" ON "ContextIssue"("organisationId", "programmeId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ContextIssue_organisationId_id_key" ON "ContextIssue"("organisationId", "id");

-- CreateIndex
CREATE INDEX "InterestedParty_organisationId_programmeId_idx" ON "InterestedParty"("organisationId", "programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestedParty_organisationId_id_key" ON "InterestedParty"("organisationId", "id");

-- CreateIndex
CREATE INDEX "InterestedPartyRequirement_organisationId_interestedPartyId_idx" ON "InterestedPartyRequirement"("organisationId", "interestedPartyId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestedPartyRequirement_organisationId_id_key" ON "InterestedPartyRequirement"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmsRiskOpportunity_organisationId_programmeId_status_idx" ON "EmsRiskOpportunity"("organisationId", "programmeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EmsRiskOpportunity_organisationId_id_key" ON "EmsRiskOpportunity"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ChangeAssessment_organisationId_programmeId_status_idx" ON "ChangeAssessment"("organisationId", "programmeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeAssessment_organisationId_id_key" ON "ChangeAssessment"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalPolicyRecord_controlledDocumentRevisionId_key" ON "EnvironmentalPolicyRecord"("controlledDocumentRevisionId");

-- CreateIndex
CREATE INDEX "EnvironmentalPolicyRecord_organisationId_programmeId_idx" ON "EnvironmentalPolicyRecord"("organisationId", "programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalPolicyRecord_organisationId_id_key" ON "EnvironmentalPolicyRecord"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "EmsProgramme" ADD CONSTRAINT "EmsProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsProgramme" ADD CONSTRAINT "EmsProgramme_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsProgramme" ADD CONSTRAINT "EmsProgramme_currentScopeVersionId_fkey" FOREIGN KEY ("currentScopeVersionId") REFERENCES "EmsScopeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeVersion" ADD CONSTRAINT "EmsScopeVersion_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeVersion" ADD CONSTRAINT "EmsScopeVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeVersion" ADD CONSTRAINT "EmsScopeVersion_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeVersion" ADD CONSTRAINT "EmsScopeVersion_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeVersion" ADD CONSTRAINT "EmsScopeVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "EmsScopeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeEntity" ADD CONSTRAINT "EmsScopeEntity_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "EmsScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeEntity" ADD CONSTRAINT "EmsScopeEntity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeEntity" ADD CONSTRAINT "EmsScopeEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeSite" ADD CONSTRAINT "EmsScopeSite_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "EmsScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeSite" ADD CONSTRAINT "EmsScopeSite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeSite" ADD CONSTRAINT "EmsScopeSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeActivity" ADD CONSTRAINT "EmsScopeActivity_scopeVersionId_fkey" FOREIGN KEY ("scopeVersionId") REFERENCES "EmsScopeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeActivity" ADD CONSTRAINT "EmsScopeActivity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsScopeActivity" ADD CONSTRAINT "EmsScopeActivity_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardRequirementMap" ADD CONSTRAINT "StandardRequirementMap_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardRequirementMap" ADD CONSTRAINT "StandardRequirementMap_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardRequirementMap" ADD CONSTRAINT "StandardRequirementMap_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextIssue" ADD CONSTRAINT "ContextIssue_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextIssue" ADD CONSTRAINT "ContextIssue_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextIssue" ADD CONSTRAINT "ContextIssue_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestedParty" ADD CONSTRAINT "InterestedParty_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestedParty" ADD CONSTRAINT "InterestedParty_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestedParty" ADD CONSTRAINT "InterestedParty_relationshipOwnerMembershipId_fkey" FOREIGN KEY ("relationshipOwnerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestedPartyRequirement" ADD CONSTRAINT "InterestedPartyRequirement_interestedPartyId_fkey" FOREIGN KEY ("interestedPartyId") REFERENCES "InterestedParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestedPartyRequirement" ADD CONSTRAINT "InterestedPartyRequirement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsRiskOpportunity" ADD CONSTRAINT "EmsRiskOpportunity_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsRiskOpportunity" ADD CONSTRAINT "EmsRiskOpportunity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsRiskOpportunity" ADD CONSTRAINT "EmsRiskOpportunity_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAssessment" ADD CONSTRAINT "ChangeAssessment_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAssessment" ADD CONSTRAINT "ChangeAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAssessment" ADD CONSTRAINT "ChangeAssessment_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeAssessment" ADD CONSTRAINT "ChangeAssessment_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalPolicyRecord" ADD CONSTRAINT "EnvironmentalPolicyRecord_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "EmsProgramme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalPolicyRecord" ADD CONSTRAINT "EnvironmentalPolicyRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalPolicyRecord" ADD CONSTRAINT "EnvironmentalPolicyRecord_controlledDocumentRevisionId_fkey" FOREIGN KEY ("controlledDocumentRevisionId") REFERENCES "ControlledDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalPolicyRecord" ADD CONSTRAINT "EnvironmentalPolicyRecord_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T23 "one active EMS programme per organisation" (Docs/PHASE2_EMS_FOUNDATION_SPEC.md
-- §1: "One active EMS programme may contain many versioned scopes; historical
-- programmes/scopes remain readable"). A partial unique index, not a schema
-- singleton, so a DRAFT/SUSPENDED/CLOSED programme's history is never
-- deleted or blocked to make room for a new one — only two rows with
-- status = 'ACTIVE' in the same organisation collide.
CREATE UNIQUE INDEX "EmsProgramme_organisationId_active_key" ON "EmsProgramme"("organisationId") WHERE "status" = 'ACTIVE';

-- T23 scope-version immutability guard, mirroring the T22
-- controlled_document_revision_immutable_once_approved trigger exactly
-- (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §§1-2: EmsScopeVersion state machine
-- "DRAFT -> IN_REVIEW -> APPROVED -> SUPERSEDED"; T23 acceptance "changes
-- are audited/versioned"). programme-service.ts already refuses to touch a
-- non-DRAFT/IN_REVIEW version's content; this trigger is defence-in-depth
-- against a future direct-SQL write. Once a version has left
-- DRAFT/IN_REVIEW, its boundary-defining fields may never change, and its
-- status may never move back to DRAFT/IN_REVIEW.
CREATE FUNCTION ems_scope_version_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('DRAFT', 'IN_REVIEW') THEN
    IF NEW."status" IN ('DRAFT', 'IN_REVIEW') THEN
      RAISE EXCEPTION 'EmsScopeVersion % cannot move back to % once it has left draft/review', OLD."id", NEW."status"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."programmeId" IS DISTINCT FROM OLD."programmeId"
      OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
      OR NEW."statement" IS DISTINCT FROM OLD."statement"
      OR NEW."exclusions" IS DISTINCT FROM OLD."exclusions"
      OR NEW."exclusionsRationale" IS DISTINCT FROM OLD."exclusionsRationale"
    THEN
      RAISE EXCEPTION 'EmsScopeVersion % is % and its boundary-defining fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ems_scope_version_immutable
  BEFORE UPDATE ON "EmsScopeVersion"
  FOR EACH ROW EXECUTE FUNCTION ems_scope_version_immutable_once_approved();
