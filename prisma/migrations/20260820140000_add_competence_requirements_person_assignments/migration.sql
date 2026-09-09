-- CreateEnum
CREATE TYPE "PersonProfileType" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CompetenceRequirementVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CompetenceRequirementScopeType" AS ENUM ('ROLE', 'PROCESS', 'ASPECT', 'CONTROL', 'OBLIGATION', 'EMERGENCY_ROLE');

-- CreateEnum
CREATE TYPE "CompetenceAssignmentStatus" AS ENUM ('REQUIRED', 'IN_PROGRESS', 'GAP');

-- CreateTable
CREATE TABLE "PersonProfile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "membershipId" TEXT,
    "personType" "PersonProfileType" NOT NULL,
    "displayName" TEXT,
    "entityId" TEXT,
    "siteId" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonSensitiveProfile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "updatedByMembershipId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonSensitiveProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceRequirement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "activeVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceRequirementVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "renewalRule" TEXT,
    "acceptableEvidence" TEXT,
    "status" "CompetenceRequirementVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "revisionRationale" TEXT,
    "supersedesVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceRequirementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceRequirementScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "scopeType" "CompetenceRequirementScopeType" NOT NULL,
    "roleId" TEXT,
    "processId" TEXT,
    "aspectId" TEXT,
    "controlId" TEXT,
    "obligationVersionId" TEXT,
    "emergencyScenarioId" TEXT,
    "emergencyRoleLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetenceRequirementScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetenceAssignment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requirementVersionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "status" "CompetenceAssignmentStatus" NOT NULL DEFAULT 'REQUIRED',
    "assignedByMembershipId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "gapNote" TEXT,
    "gapSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetenceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonProfile_organisationId_entityId_idx" ON "PersonProfile"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "PersonProfile_organisationId_siteId_idx" ON "PersonProfile"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "PersonProfile_organisationId_isActive_idx" ON "PersonProfile"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PersonProfile_organisationId_id_key" ON "PersonProfile"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PersonProfile_organisationId_membershipId_key" ON "PersonProfile"("organisationId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSensitiveProfile_personId_key" ON "PersonSensitiveProfile"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSensitiveProfile_organisationId_id_key" ON "PersonSensitiveProfile"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PersonSensitiveProfile_organisationId_personId_key" ON "PersonSensitiveProfile"("organisationId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirement_activeVersionId_key" ON "CompetenceRequirement"("activeVersionId");

-- CreateIndex
CREATE INDEX "CompetenceRequirement_organisationId_idx" ON "CompetenceRequirement"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirement_organisationId_id_key" ON "CompetenceRequirement"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirement_organisationId_requirementKey_key" ON "CompetenceRequirement"("organisationId", "requirementKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirement_organisationId_activeVersionId_key" ON "CompetenceRequirement"("organisationId", "activeVersionId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementVersion_organisationId_requirementId_s_idx" ON "CompetenceRequirementVersion"("organisationId", "requirementId", "status");

-- CreateIndex
CREATE INDEX "CompetenceRequirementVersion_organisationId_status_idx" ON "CompetenceRequirementVersion"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirementVersion_organisationId_id_key" ON "CompetenceRequirementVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirementVersion_organisationId_requirementId_v_key" ON "CompetenceRequirementVersion"("organisationId", "requirementId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirementVersion_organisationId_supersedesVersi_key" ON "CompetenceRequirementVersion"("organisationId", "supersedesVersionId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_requirementVersio_idx" ON "CompetenceRequirementScope"("organisationId", "requirementVersionId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_roleId_idx" ON "CompetenceRequirementScope"("organisationId", "roleId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_processId_idx" ON "CompetenceRequirementScope"("organisationId", "processId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_aspectId_idx" ON "CompetenceRequirementScope"("organisationId", "aspectId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_controlId_idx" ON "CompetenceRequirementScope"("organisationId", "controlId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_obligationVersion_idx" ON "CompetenceRequirementScope"("organisationId", "obligationVersionId");

-- CreateIndex
CREATE INDEX "CompetenceRequirementScope_organisationId_emergencyScenario_idx" ON "CompetenceRequirementScope"("organisationId", "emergencyScenarioId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceRequirementScope_scope_key" ON "CompetenceRequirementScope"("organisationId", "requirementVersionId", "scopeType", "roleId", "processId", "aspectId", "controlId", "obligationVersionId", "emergencyScenarioId", "emergencyRoleLabel");

-- CreateIndex
CREATE INDEX "CompetenceAssignment_organisationId_personId_idx" ON "CompetenceAssignment"("organisationId", "personId");

-- CreateIndex
CREATE INDEX "CompetenceAssignment_organisationId_requirementVersionId_idx" ON "CompetenceAssignment"("organisationId", "requirementVersionId");

-- CreateIndex
CREATE INDEX "CompetenceAssignment_organisationId_status_idx" ON "CompetenceAssignment"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceAssignment_organisationId_id_key" ON "CompetenceAssignment"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompetenceAssignment_organisationId_requirementVersionId_pe_key" ON "CompetenceAssignment"("organisationId", "requirementVersionId", "personId");

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_organisationId_membershipId_fkey" FOREIGN KEY ("organisationId", "membershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_organisationId_createdByMembershipId_fkey" FOREIGN KEY ("organisationId", "createdByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSensitiveProfile" ADD CONSTRAINT "PersonSensitiveProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSensitiveProfile" ADD CONSTRAINT "PersonSensitiveProfile_organisationId_personId_fkey" FOREIGN KEY ("organisationId", "personId") REFERENCES "PersonProfile"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonSensitiveProfile" ADD CONSTRAINT "PersonSensitiveProfile_organisationId_updatedByMembershipI_fkey" FOREIGN KEY ("organisationId", "updatedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirement" ADD CONSTRAINT "CompetenceRequirement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirement" ADD CONSTRAINT "CompetenceRequirement_organisationId_activeVersionId_fkey" FOREIGN KEY ("organisationId", "activeVersionId") REFERENCES "CompetenceRequirementVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementVersion" ADD CONSTRAINT "CompetenceRequirementVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementVersion" ADD CONSTRAINT "CompetenceRequirementVersion_organisationId_requirementId_fkey" FOREIGN KEY ("organisationId", "requirementId") REFERENCES "CompetenceRequirement"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementVersion" ADD CONSTRAINT "CompetenceRequirementVersion_organisationId_supersedesVers_fkey" FOREIGN KEY ("organisationId", "supersedesVersionId") REFERENCES "CompetenceRequirementVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_requirementVersi_fkey" FOREIGN KEY ("organisationId", "requirementVersionId") REFERENCES "CompetenceRequirementVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_roleId_fkey" FOREIGN KEY ("organisationId", "roleId") REFERENCES "RoleDefinition"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_controlId_fkey" FOREIGN KEY ("organisationId", "controlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_obligationVersio_fkey" FOREIGN KEY ("organisationId", "obligationVersionId") REFERENCES "ComplianceObligationVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceRequirementScope" ADD CONSTRAINT "CompetenceRequirementScope_organisationId_emergencyScenari_fkey" FOREIGN KEY ("organisationId", "emergencyScenarioId") REFERENCES "EmergencyScenario"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssignment" ADD CONSTRAINT "CompetenceAssignment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssignment" ADD CONSTRAINT "CompetenceAssignment_organisationId_requirementVersionId_fkey" FOREIGN KEY ("organisationId", "requirementVersionId") REFERENCES "CompetenceRequirementVersion"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssignment" ADD CONSTRAINT "CompetenceAssignment_organisationId_personId_fkey" FOREIGN KEY ("organisationId", "personId") REFERENCES "PersonProfile"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetenceAssignment" ADD CONSTRAINT "CompetenceAssignment_organisationId_assignedByMembershipId_fkey" FOREIGN KEY ("organisationId", "assignedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutability: once a CompetenceRequirementVersion has left DRAFT it may
-- never move back to DRAFT, and its content columns become read-only (T70
-- follows the same immutable-once-approved convention as
-- ComplianceObligationVersion/EnvironmentalObjectiveVersion). status/
-- approvedByUserId/approvedAt/updatedAt remain writable so the
-- approve/activate transitions themselves can still update the row.
CREATE FUNCTION competence_requirement_version_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" != 'DRAFT' THEN
    IF NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'CompetenceRequirementVersion % cannot move back to DRAFT once it has left draft', OLD."id"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."requirementId" IS DISTINCT FROM OLD."requirementId"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."title" IS DISTINCT FROM OLD."title"
      OR NEW."description" IS DISTINCT FROM OLD."description"
      OR NEW."renewalRule" IS DISTINCT FROM OLD."renewalRule"
      OR NEW."acceptableEvidence" IS DISTINCT FROM OLD."acceptableEvidence"
      OR NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId"
      OR NEW."preparedByUserId" IS DISTINCT FROM OLD."preparedByUserId"
      OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
    THEN
      RAISE EXCEPTION 'CompetenceRequirementVersion % is % and its content fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER competence_requirement_version_immutable
  BEFORE UPDATE ON "CompetenceRequirementVersion"
  FOR EACH ROW EXECUTE FUNCTION competence_requirement_version_immutable_once_approved();
