-- CreateEnum
CREATE TYPE "AuditChecklistStatus" AS ENUM ('DRAFT', 'FROZEN');

-- CreateEnum
CREATE TYPE "AuditQuestionResult" AS ENUM ('NOT_ASSESSED', 'CONFORMS', 'NONCONFORMANCE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AuditFindingClassification" AS ENUM ('OBSERVATION', 'OPPORTUNITY_FOR_IMPROVEMENT', 'MINOR_NONCONFORMITY', 'MAJOR_NONCONFORMITY');

-- CreateEnum
CREATE TYPE "AuditFindingStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ACTION_REQUIRED', 'ACCEPTED_OBSERVATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "AuditReportStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateTable
CREATE TABLE "AuditChecklistVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AuditChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "frozenAt" TIMESTAMP(3),
    "frozenByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChecklistVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditChecklistItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "checklistVersionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "criteriaReference" TEXT,
    "expectedEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditQuestionResponse" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "result" "AuditQuestionResult" NOT NULL DEFAULT 'NOT_ASSESSED',
    "notes" TEXT,
    "auditorMembershipId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditQuestionResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "questionResponseId" TEXT,
    "classification" "AuditFindingClassification" NOT NULL,
    "status" "AuditFindingStatus" NOT NULL DEFAULT 'DRAFT',
    "statement" TEXT NOT NULL,
    "objectiveEvidence" TEXT,
    "criterionReference" TEXT,
    "scopeRef" JSONB,
    "ownerMembershipId" TEXT,
    "dueDate" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReportRevision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "AuditReportStatus" NOT NULL DEFAULT 'DRAFT',
    "preparerUserId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "issuerUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "frozenPayload" JSONB,
    "checksumSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCoverageSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "reportRevisionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditCoverageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditChecklistVersion_organisationId_auditId_idx" ON "AuditChecklistVersion"("organisationId", "auditId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditChecklistVersion_organisationId_id_key" ON "AuditChecklistVersion"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditChecklistVersion_organisationId_auditId_version_key" ON "AuditChecklistVersion"("organisationId", "auditId", "version");

-- CreateIndex
CREATE INDEX "AuditChecklistItem_organisationId_checklistVersionId_idx" ON "AuditChecklistItem"("organisationId", "checklistVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditChecklistItem_organisationId_id_key" ON "AuditChecklistItem"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditChecklistItem_organisationId_checklistVersionId_sortOr_key" ON "AuditChecklistItem"("organisationId", "checklistVersionId", "sortOrder");

-- CreateIndex
CREATE INDEX "AuditQuestionResponse_organisationId_auditId_idx" ON "AuditQuestionResponse"("organisationId", "auditId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditQuestionResponse_organisationId_checklistItemId_key" ON "AuditQuestionResponse"("organisationId", "checklistItemId");

-- CreateIndex
CREATE INDEX "AuditFinding_organisationId_auditId_status_idx" ON "AuditFinding"("organisationId", "auditId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditFinding_organisationId_id_key" ON "AuditFinding"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReportRevision_organisationId_id_key" ON "AuditReportRevision"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReportRevision_organisationId_auditId_key" ON "AuditReportRevision"("organisationId", "auditId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCoverageSnapshot_organisationId_id_key" ON "AuditCoverageSnapshot"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCoverageSnapshot_organisationId_auditId_key" ON "AuditCoverageSnapshot"("organisationId", "auditId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCoverageSnapshot_organisationId_reportRevisionId_key" ON "AuditCoverageSnapshot"("organisationId", "reportRevisionId");

-- AddForeignKey
ALTER TABLE "AuditChecklistVersion" ADD CONSTRAINT "AuditChecklistVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChecklistVersion" ADD CONSTRAINT "AuditChecklistVersion_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChecklistItem" ADD CONSTRAINT "AuditChecklistItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditChecklistItem" ADD CONSTRAINT "AuditChecklistItem_organisationId_checklistVersionId_fkey" FOREIGN KEY ("organisationId", "checklistVersionId") REFERENCES "AuditChecklistVersion"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionResponse" ADD CONSTRAINT "AuditQuestionResponse_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionResponse" ADD CONSTRAINT "AuditQuestionResponse_organisationId_checklistItemId_fkey" FOREIGN KEY ("organisationId", "checklistItemId") REFERENCES "AuditChecklistItem"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionResponse" ADD CONSTRAINT "AuditQuestionResponse_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditQuestionResponse" ADD CONSTRAINT "AuditQuestionResponse_organisationId_auditorMembershipId_fkey" FOREIGN KEY ("organisationId", "auditorMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReportRevision" ADD CONSTRAINT "AuditReportRevision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReportRevision" ADD CONSTRAINT "AuditReportRevision_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCoverageSnapshot" ADD CONSTRAINT "AuditCoverageSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCoverageSnapshot" ADD CONSTRAINT "AuditCoverageSnapshot_organisationId_auditId_fkey" FOREIGN KEY ("organisationId", "auditId") REFERENCES "EmsAudit"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditCoverageSnapshot" ADD CONSTRAINT "AuditCoverageSnapshot_organisationId_reportRevisionId_fkey" FOREIGN KEY ("organisationId", "reportRevisionId") REFERENCES "AuditReportRevision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

