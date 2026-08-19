-- CreateEnum
CREATE TYPE "EnvironmentalObjectiveVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'ACHIEVED', 'NOT_ACHIEVED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ObjectiveApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ObjectiveSourceLinkType" AS ENUM ('POLICY', 'ASPECT_ASSESSMENT', 'OBLIGATION_VERSION', 'RISK_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "ObjectiveMetricSourceType" AS ENUM ('MANUAL', 'CORPORATE_CARBON', 'PRODUCT_LCA', 'MONITORING', 'DERIVED_APPROVED_FORMULA');

-- CreateEnum
CREATE TYPE "ObjectiveMetricVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "EnvironmentalObjective" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "EnvironmentalObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentalObjectiveVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "baselineDescription" TEXT NOT NULL,
    "baselineDate" TIMESTAMP(3),
    "targetValue" DECIMAL(24,10),
    "targetQualitative" TEXT,
    "unit" TEXT,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "evaluationMethod" TEXT NOT NULL,
    "status" "EnvironmentalObjectiveVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "achievementDecidedByUserId" TEXT,
    "achievementDecidedAt" TIMESTAMP(3),
    "achievementRationale" TEXT,
    "revisionRationale" TEXT,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "EnvironmentalObjectiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveSourceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveVersionId" TEXT NOT NULL,
    "linkType" "ObjectiveSourceLinkType" NOT NULL,
    "policyRecordId" TEXT,
    "aspectAssessmentId" TEXT,
    "obligationVersionId" TEXT,
    "riskOpportunityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ObjectiveSourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveApproval" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveVersionId" TEXT NOT NULL,
    "decision" "ObjectiveApprovalDecision" NOT NULL,
    "permissionCode" TEXT NOT NULL,
    "comment" TEXT,
    "approverMembershipId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "ObjectiveApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveMetricDefinition" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ObjectiveMetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveMetricVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "metricDefinitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "ObjectiveMetricSourceType" NOT NULL,
    "aggregationConfig" JSONB,
    "unit" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "boundaryDescription" TEXT,
    "dataQualityRules" JSONB,
    "status" "ObjectiveMetricVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "ObjectiveMetricVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjective_activeVersionId_key" ON "EnvironmentalObjective"("activeVersionId");

-- CreateIndex
CREATE INDEX "EnvironmentalObjective_organisationId_idx" ON "EnvironmentalObjective"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjective_organisationId_id_key" ON "EnvironmentalObjective"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjective_organisationId_activeVersionId_key" ON "EnvironmentalObjective"("organisationId", "activeVersionId");

-- CreateIndex
CREATE INDEX "EnvironmentalObjectiveVersion_organisationId_objectiveId_st_idx" ON "EnvironmentalObjectiveVersion"("organisationId", "objectiveId", "status");

-- CreateIndex
CREATE INDEX "EnvironmentalObjectiveVersion_organisationId_status_idx" ON "EnvironmentalObjectiveVersion"("organisationId", "status");

-- CreateIndex
CREATE INDEX "EnvironmentalObjectiveVersion_organisationId_ownerMembershi_idx" ON "EnvironmentalObjectiveVersion"("organisationId", "ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjectiveVersion_organisationId_id_key" ON "EnvironmentalObjectiveVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjectiveVersion_organisationId_objectiveId_ve_key" ON "EnvironmentalObjectiveVersion"("organisationId", "objectiveId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentalObjectiveVersion_organisationId_supersedesVers_key" ON "EnvironmentalObjectiveVersion"("organisationId", "supersedesVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveSourceLink_organisationId_objectiveVersionId_idx" ON "ObjectiveSourceLink"("organisationId", "objectiveVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveSourceLink_organisationId_policyRecordId_idx" ON "ObjectiveSourceLink"("organisationId", "policyRecordId");

-- CreateIndex
CREATE INDEX "ObjectiveSourceLink_organisationId_aspectAssessmentId_idx" ON "ObjectiveSourceLink"("organisationId", "aspectAssessmentId");

-- CreateIndex
CREATE INDEX "ObjectiveSourceLink_organisationId_obligationVersionId_idx" ON "ObjectiveSourceLink"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveSourceLink_organisationId_riskOpportunityId_idx" ON "ObjectiveSourceLink"("organisationId", "riskOpportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveSourceLink_link_key" ON "ObjectiveSourceLink"("organisationId", "objectiveVersionId", "linkType", "policyRecordId", "aspectAssessmentId", "obligationVersionId", "riskOpportunityId");

-- CreateIndex
CREATE INDEX "ObjectiveApproval_organisationId_objectiveVersionId_idx" ON "ObjectiveApproval"("organisationId", "objectiveVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveApproval_organisationId_approverMembershipId_idx" ON "ObjectiveApproval"("organisationId", "approverMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricDefinition_activeVersionId_key" ON "ObjectiveMetricDefinition"("activeVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveMetricDefinition_organisationId_objectiveId_idx" ON "ObjectiveMetricDefinition"("organisationId", "objectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricDefinition_organisationId_id_key" ON "ObjectiveMetricDefinition"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricDefinition_organisationId_activeVersionId_key" ON "ObjectiveMetricDefinition"("organisationId", "activeVersionId");

-- CreateIndex
CREATE INDEX "ObjectiveMetricVersion_organisationId_metricDefinitionId_st_idx" ON "ObjectiveMetricVersion"("organisationId", "metricDefinitionId", "status");

-- CreateIndex
CREATE INDEX "ObjectiveMetricVersion_organisationId_status_idx" ON "ObjectiveMetricVersion"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricVersion_organisationId_id_key" ON "ObjectiveMetricVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricVersion_organisationId_metricDefinitionId_ve_key" ON "ObjectiveMetricVersion"("organisationId", "metricDefinitionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMetricVersion_organisationId_supersedesVersionId_key" ON "ObjectiveMetricVersion"("organisationId", "supersedesVersionId");

-- AddForeignKey
ALTER TABLE "EnvironmentalObjective" ADD CONSTRAINT "EnvironmentalObjective_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalObjective" ADD CONSTRAINT "EnvironmentalObjective_organisationId_activeVersionId_fkey" FOREIGN KEY ("organisationId", "activeVersionId") REFERENCES "EnvironmentalObjectiveVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalObjectiveVersion" ADD CONSTRAINT "EnvironmentalObjectiveVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalObjectiveVersion" ADD CONSTRAINT "EnvironmentalObjectiveVersion_organisationId_objectiveId_fkey" FOREIGN KEY ("organisationId", "objectiveId") REFERENCES "EnvironmentalObjective"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalObjectiveVersion" ADD CONSTRAINT "EnvironmentalObjectiveVersion_organisationId_ownerMembersh_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentalObjectiveVersion" ADD CONSTRAINT "EnvironmentalObjectiveVersion_organisationId_supersedesVer_fkey" FOREIGN KEY ("organisationId", "supersedesVersionId") REFERENCES "EnvironmentalObjectiveVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_objectiveVersionId_fkey" FOREIGN KEY ("organisationId", "objectiveVersionId") REFERENCES "EnvironmentalObjectiveVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_policyRecordId_fkey" FOREIGN KEY ("organisationId", "policyRecordId") REFERENCES "EnvironmentalPolicyRecord"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_aspectAssessmentId_fkey" FOREIGN KEY ("organisationId", "aspectAssessmentId") REFERENCES "AspectAssessment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_obligationVersionId_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveSourceLink" ADD CONSTRAINT "ObjectiveSourceLink_organisationId_riskOpportunityId_fkey" FOREIGN KEY ("organisationId", "riskOpportunityId") REFERENCES "EmsRiskOpportunity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveApproval" ADD CONSTRAINT "ObjectiveApproval_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveApproval" ADD CONSTRAINT "ObjectiveApproval_organisationId_objectiveVersionId_fkey" FOREIGN KEY ("organisationId", "objectiveVersionId") REFERENCES "EnvironmentalObjectiveVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveApproval" ADD CONSTRAINT "ObjectiveApproval_organisationId_approverMembershipId_fkey" FOREIGN KEY ("organisationId", "approverMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricDefinition" ADD CONSTRAINT "ObjectiveMetricDefinition_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricDefinition" ADD CONSTRAINT "ObjectiveMetricDefinition_organisationId_objectiveId_fkey" FOREIGN KEY ("organisationId", "objectiveId") REFERENCES "EnvironmentalObjective"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricDefinition" ADD CONSTRAINT "ObjectiveMetricDefinition_organisationId_activeVersionId_fkey" FOREIGN KEY ("organisationId", "activeVersionId") REFERENCES "ObjectiveMetricVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricVersion" ADD CONSTRAINT "ObjectiveMetricVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricVersion" ADD CONSTRAINT "ObjectiveMetricVersion_organisationId_metricDefinitionId_fkey" FOREIGN KEY ("organisationId", "metricDefinitionId") REFERENCES "ObjectiveMetricDefinition"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMetricVersion" ADD CONSTRAINT "ObjectiveMetricVersion_organisationId_supersedesVersionId_fkey" FOREIGN KEY ("organisationId", "supersedesVersionId") REFERENCES "ObjectiveMetricVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: once an EnvironmentalObjectiveVersion has left DRAFT/IN_REVIEW
-- it may never move back to DRAFT/IN_REVIEW, and its content columns become
-- read-only (T50 acceptance: "revisions preserve history"). Mirrors the T22
-- controlled_document_revision_immutable / T44
-- compliance_obligation_version_immutable_once_approved triggers exactly.
-- status/approvedByUserId/approvedAt/achievementDecidedByUserId/
-- achievementDecidedAt/achievementRationale/updatedAt remain writable so the
-- approve/reject/return/achieve/cancel/retire transitions can still update
-- the row.
CREATE FUNCTION environmental_objective_version_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('DRAFT', 'IN_REVIEW') THEN
    IF NEW."status" IN ('DRAFT', 'IN_REVIEW') THEN
      RAISE EXCEPTION 'EnvironmentalObjectiveVersion % cannot move back to % once it has left draft/review', OLD."id", NEW."status"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."objectiveId" IS DISTINCT FROM OLD."objectiveId"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."intent" IS DISTINCT FROM OLD."intent"
      OR NEW."ownerMembershipId" IS DISTINCT FROM OLD."ownerMembershipId"
      OR NEW."baselineDescription" IS DISTINCT FROM OLD."baselineDescription"
      OR NEW."baselineDate" IS DISTINCT FROM OLD."baselineDate"
      OR NEW."targetValue" IS DISTINCT FROM OLD."targetValue"
      OR NEW."targetQualitative" IS DISTINCT FROM OLD."targetQualitative"
      OR NEW."unit" IS DISTINCT FROM OLD."unit"
      OR NEW."targetDate" IS DISTINCT FROM OLD."targetDate"
      OR NEW."evaluationMethod" IS DISTINCT FROM OLD."evaluationMethod"
      OR NEW."revisionRationale" IS DISTINCT FROM OLD."revisionRationale"
      OR NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId"
      OR NEW."preparedByUserId" IS DISTINCT FROM OLD."preparedByUserId"
      OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
    THEN
      RAISE EXCEPTION 'EnvironmentalObjectiveVersion % is % and its content fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER environmental_objective_version_immutable
  BEFORE UPDATE ON "EnvironmentalObjectiveVersion"
  FOR EACH ROW EXECUTE FUNCTION environmental_objective_version_immutable_once_approved();

-- Immutability: once an ObjectiveMetricVersion leaves DRAFT it may never
-- move back to DRAFT, and its content columns become read-only (spec §1 "a
-- metric definition is versioned"). status/approvedByUserId/approvedAt/
-- updatedAt remain writable so the approve transition can still update the
-- row.
CREATE FUNCTION objective_metric_version_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" != 'DRAFT' THEN
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'ObjectiveMetricVersion % cannot move back to DRAFT once it has left draft', OLD."id"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."metricDefinitionId" IS DISTINCT FROM OLD."metricDefinitionId"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."name" IS DISTINCT FROM OLD."name"
      OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
      OR NEW."aggregationConfig" IS DISTINCT FROM OLD."aggregationConfig"
      OR NEW."unit" IS DISTINCT FROM OLD."unit"
      OR NEW."frequency" IS DISTINCT FROM OLD."frequency"
      OR NEW."boundaryDescription" IS DISTINCT FROM OLD."boundaryDescription"
      OR NEW."dataQualityRules" IS DISTINCT FROM OLD."dataQualityRules"
      OR NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId"
      OR NEW."preparedByUserId" IS DISTINCT FROM OLD."preparedByUserId"
      OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
    THEN
      RAISE EXCEPTION 'ObjectiveMetricVersion % is % and its content fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER objective_metric_version_immutable
  BEFORE UPDATE ON "ObjectiveMetricVersion"
  FOR EACH ROW EXECUTE FUNCTION objective_metric_version_immutable_once_approved();
