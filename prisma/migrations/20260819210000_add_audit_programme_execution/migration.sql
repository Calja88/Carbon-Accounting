-- CreateEnum
CREATE TYPE "AuditProgrammeStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'COMPLETED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EmsAuditType" AS ENUM ('INTERNAL', 'SUPPLIER', 'COMPLIANCE', 'SYSTEM', 'PROCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "EmsAuditStatus" AS ENUM ('PLANNED', 'PREPARATION', 'IN_PROGRESS', 'REPORT_DRAFT', 'REPORT_ISSUED', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditTeamRole" AS ENUM ('LEAD_AUDITOR', 'AUDITOR', 'TECHNICAL_EXPERT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "AuditItemPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "AuditProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objectives" TEXT,
    "riskBasis" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "status" "AuditProgrammeStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesProgrammeId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditProgrammeItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT,
    "priority" "AuditItemPriority" NOT NULL DEFAULT 'MEDIUM',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditProgrammeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditProgrammeItemScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "processId" TEXT,
    "aspectId" TEXT,
    "obligationId" TEXT,
    "requirementMapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditProgrammeItemScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsAudit" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "programmeItemId" TEXT,
    "type" "EmsAuditType" NOT NULL,
    "title" TEXT NOT NULL,
    "objectives" TEXT,
    "criteriaSummary" TEXT NOT NULL,
    "criteriaReferences" JSONB,
    "leadMembershipId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "status" "EmsAuditStatus" NOT NULL DEFAULT 'PLANNED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmsAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmsAuditScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "processId" TEXT,
    "aspectId" TEXT,
    "obligationId" TEXT,
    "requirementMapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmsAuditScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTeamMember" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "AuditTeamRole" NOT NULL,
    "independenceDeclared" BOOLEAN NOT NULL DEFAULT false,
    "conflictDeclared" BOOLEAN NOT NULL DEFAULT false,
    "conflictNotes" TEXT,
    "declaredAt" TIMESTAMP(3),
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditProgramme_organisationId_status_idx" ON "AuditProgramme"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditProgramme_organisationId_id_key" ON "AuditProgramme"("organisationId", "id");

-- CreateIndex
CREATE INDEX "AuditProgrammeItem_organisationId_programmeId_idx" ON "AuditProgrammeItem"("organisationId", "programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditProgrammeItem_organisationId_id_key" ON "AuditProgrammeItem"("organisationId", "id");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_itemId_idx" ON "AuditProgrammeItemScope"("organisationId", "itemId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_entityId_idx" ON "AuditProgrammeItemScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_siteId_idx" ON "AuditProgrammeItemScope"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_processId_idx" ON "AuditProgrammeItemScope"("organisationId", "processId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_aspectId_idx" ON "AuditProgrammeItemScope"("organisationId", "aspectId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_obligationId_idx" ON "AuditProgrammeItemScope"("organisationId", "obligationId");

-- CreateIndex
CREATE INDEX "AuditProgrammeItemScope_organisationId_requirementMapId_idx" ON "AuditProgrammeItemScope"("organisationId", "requirementMapId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditProgrammeItemScope_scope_key" ON "AuditProgrammeItemScope"("organisationId", "itemId", "entityId", "siteId", "processId", "aspectId", "obligationId", "requirementMapId");

-- CreateIndex
CREATE INDEX "EmsAudit_organisationId_programmeId_status_idx" ON "EmsAudit"("organisationId", "programmeId", "status");

-- CreateIndex
CREATE INDEX "EmsAudit_organisationId_status_idx" ON "EmsAudit"("organisationId", "status");

-- CreateIndex
CREATE INDEX "EmsAudit_organisationId_programmeItemId_idx" ON "EmsAudit"("organisationId", "programmeItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsAudit_organisationId_id_key" ON "EmsAudit"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_auditId_idx" ON "EmsAuditScope"("organisationId", "auditId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_entityId_idx" ON "EmsAuditScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_siteId_idx" ON "EmsAuditScope"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_processId_idx" ON "EmsAuditScope"("organisationId", "processId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_aspectId_idx" ON "EmsAuditScope"("organisationId", "aspectId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_obligationId_idx" ON "EmsAuditScope"("organisationId", "obligationId");

-- CreateIndex
CREATE INDEX "EmsAuditScope_organisationId_requirementMapId_idx" ON "EmsAuditScope"("organisationId", "requirementMapId");

-- CreateIndex
CREATE UNIQUE INDEX "EmsAuditScope_scope_key" ON "EmsAuditScope"("organisationId", "auditId", "entityId", "siteId", "processId", "aspectId", "obligationId", "requirementMapId");

-- CreateIndex
CREATE INDEX "AuditTeamMember_organisationId_auditId_idx" ON "AuditTeamMember"("organisationId", "auditId");

-- CreateIndex
CREATE INDEX "AuditTeamMember_organisationId_membershipId_idx" ON "AuditTeamMember"("organisationId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditTeamMember_organisationId_auditId_membershipId_key" ON "AuditTeamMember"("organisationId", "auditId", "membershipId");

-- AddForeignKey
ALTER TABLE "AuditProgramme" ADD CONSTRAINT "AuditProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgramme" ADD CONSTRAINT "AuditProgramme_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgramme" ADD CONSTRAINT "AuditProgramme_organisationId_supersedesProgrammeId_fkey" FOREIGN KEY ("organisationId", "supersedesProgrammeId") REFERENCES "AuditProgramme"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItem" ADD CONSTRAINT "AuditProgrammeItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItem" ADD CONSTRAINT "AuditProgrammeItem_organisationId_programmeId_fkey" FOREIGN KEY ("organisationId", "programmeId") REFERENCES "AuditProgramme"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_itemId_fkey" FOREIGN KEY ("organisationId", "itemId") REFERENCES "AuditProgrammeItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_obligationId_fkey" FOREIGN KEY ("organisationId", "obligationId") REFERENCES "ComplianceObligation"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditProgrammeItemScope" ADD CONSTRAINT "AuditProgrammeItemScope_organisationId_requirementMapId_fkey" FOREIGN KEY ("organisationId", "requirementMapId") REFERENCES "StandardRequirementMap"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAudit" ADD CONSTRAINT "EmsAudit_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAudit" ADD CONSTRAINT "EmsAudit_organisationId_programmeId_fkey" FOREIGN KEY ("organisationId", "programmeId") REFERENCES "AuditProgramme"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAudit" ADD CONSTRAINT "EmsAudit_organisationId_programmeItemId_fkey" FOREIGN KEY ("organisationId", "programmeItemId") REFERENCES "AuditProgrammeItem"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAudit" ADD CONSTRAINT "EmsAudit_organisationId_leadMembershipId_fkey" FOREIGN KEY ("organisationId", "leadMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_obligationId_fkey" FOREIGN KEY ("organisationId", "obligationId") REFERENCES "ComplianceObligation"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmsAuditScope" ADD CONSTRAINT "EmsAuditScope_organisationId_requirementMapId_fkey" FOREIGN KEY ("organisationId", "requirementMapId") REFERENCES "StandardRequirementMap"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTeamMember" ADD CONSTRAINT "AuditTeamMember_organisationId_membershipId_fkey" FOREIGN KEY ("organisationId", "membershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

