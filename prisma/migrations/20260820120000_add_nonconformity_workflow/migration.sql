-- CreateEnum
CREATE TYPE "NonconformitySourceType" AS ENUM ('AUDIT_FINDING', 'INCIDENT', 'COMPLIANCE_EVALUATION_ITEM', 'CONTROL_CHECK', 'COMPLAINT', 'MANUAL');

-- CreateEnum
CREATE TYPE "NonconformityStatus" AS ENUM ('OPEN', 'CONTAINED', 'ROOT_CAUSE_APPROVED', 'ACTIONS_IN_PROGRESS', 'EFFECTIVENESS_REVIEW', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "NonconformityClassification" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonconformityClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonconformityClosurePolicy" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requireContainment" BOOLEAN NOT NULL DEFAULT true,
    "requireRootCauseApproval" BOOLEAN NOT NULL DEFAULT false,
    "requireCorrectiveActionsComplete" BOOLEAN NOT NULL DEFAULT false,
    "requireEffectivenessReview" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonconformityClosurePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nonconformity" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceType" "NonconformitySourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceReferenceNote" TEXT,
    "statement" TEXT NOT NULL,
    "requirementReference" TEXT NOT NULL,
    "complianceObligationId" TEXT,
    "operationalControlId" TEXT,
    "classificationId" TEXT,
    "classificationConfigSnapshot" JSONB,
    "status" "NonconformityStatus" NOT NULL DEFAULT 'OPEN',
    "ownerMembershipId" TEXT,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nonconformity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonconformitySourceLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "sourceType" "NonconformitySourceType" NOT NULL,
    "sourceId" TEXT,
    "sourceReferenceNote" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "linkedByMembershipId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonconformitySourceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainmentRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "actionTakenAt" TIMESTAMP(3) NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "adequacyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "adequate" BOOLEAN,
    "adequacyReviewNotes" TEXT,
    "adequacyReviewerMembershipId" TEXT,
    "adequacyReviewedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NonconformityClassification_organisationId_isActive_idx" ON "NonconformityClassification"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "NonconformityClassification_organisationId_id_key" ON "NonconformityClassification"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NonconformityClassification_organisationId_key_key" ON "NonconformityClassification"("organisationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NonconformityClosurePolicy_organisationId_key" ON "NonconformityClosurePolicy"("organisationId");

-- CreateIndex
CREATE INDEX "Nonconformity_organisationId_status_idx" ON "Nonconformity"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Nonconformity_organisationId_sourceType_sourceId_idx" ON "Nonconformity"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Nonconformity_organisationId_classificationId_idx" ON "Nonconformity"("organisationId", "classificationId");

-- CreateIndex
CREATE UNIQUE INDEX "Nonconformity_organisationId_id_key" ON "Nonconformity"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Nonconformity_organisationId_reference_key" ON "Nonconformity"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "NonconformitySourceLink_organisationId_nonconformityId_idx" ON "NonconformitySourceLink"("organisationId", "nonconformityId");

-- CreateIndex
CREATE INDEX "NonconformitySourceLink_organisationId_sourceType_sourceId_idx" ON "NonconformitySourceLink"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "NonconformitySourceLink_organisationId_id_key" ON "NonconformitySourceLink"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ContainmentRecord_organisationId_nonconformityId_idx" ON "ContainmentRecord"("organisationId", "nonconformityId");

-- CreateIndex
CREATE UNIQUE INDEX "ContainmentRecord_organisationId_id_key" ON "ContainmentRecord"("organisationId", "id");

-- AddForeignKey
ALTER TABLE "NonconformityClassification" ADD CONSTRAINT "NonconformityClassification_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformityClosurePolicy" ADD CONSTRAINT "NonconformityClosurePolicy_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_organisationId_complianceObligationId_fkey" FOREIGN KEY ("organisationId", "complianceObligationId") REFERENCES "ComplianceObligation"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_organisationId_operationalControlId_fkey" FOREIGN KEY ("organisationId", "operationalControlId") REFERENCES "OperationalControl"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_organisationId_classificationId_fkey" FOREIGN KEY ("organisationId", "classificationId") REFERENCES "NonconformityClassification"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Nonconformity" ADD CONSTRAINT "Nonconformity_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformitySourceLink" ADD CONSTRAINT "NonconformitySourceLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformitySourceLink" ADD CONSTRAINT "NonconformitySourceLink_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformitySourceLink" ADD CONSTRAINT "NonconformitySourceLink_organisationId_linkedByMembershipI_fkey" FOREIGN KEY ("organisationId", "linkedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainmentRecord" ADD CONSTRAINT "ContainmentRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainmentRecord" ADD CONSTRAINT "ContainmentRecord_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainmentRecord" ADD CONSTRAINT "ContainmentRecord_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainmentRecord" ADD CONSTRAINT "ContainmentRecord_organisationId_adequacyReviewerMembershi_fkey" FOREIGN KEY ("organisationId", "adequacyReviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

