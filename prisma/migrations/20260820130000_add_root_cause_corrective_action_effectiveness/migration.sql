-- CreateEnum
CREATE TYPE "RootCauseMethod" AS ENUM ('FIVE_WHYS', 'FISHBONE', 'FAULT_TREE', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EffectivenessResult" AS ENUM ('EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE');

-- CreateEnum
CREATE TYPE "IneffectiveOutcomePolicy" AS ENUM ('REOPEN_NONCONFORMITY', 'CREATE_FOLLOW_UP');

-- AlterTable
ALTER TABLE "NonconformityClosurePolicy" ADD COLUMN "ineffectiveOutcomePolicy" "IneffectiveOutcomePolicy" NOT NULL DEFAULT 'REOPEN_NONCONFORMITY';

-- CreateTable
CREATE TABLE "RootCauseAnalysis" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "method" "RootCauseMethod" NOT NULL,
    "analysisPayload" JSONB NOT NULL,
    "contributors" JSONB,
    "conclusion" TEXT NOT NULL,
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RootCauseAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectiveAction" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "sharedActionItemId" TEXT,
    "description" TEXT NOT NULL,
    "completionCriteria" TEXT,
    "ownerMembershipId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completionEvidenceNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByMembershipId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EffectivenessReview" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "reviewDate" TIMESTAMP(3) NOT NULL,
    "reviewerMembershipId" TEXT NOT NULL,
    "result" "EffectivenessResult" NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EffectivenessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NonconformityClosure" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nonconformityId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "rationale" TEXT,
    "closedByUserId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonconformityClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RootCauseAnalysis_organisationId_id_key" ON "RootCauseAnalysis"("organisationId", "id");

-- CreateIndex
CREATE INDEX "RootCauseAnalysis_organisationId_nonconformityId_idx" ON "RootCauseAnalysis"("organisationId", "nonconformityId");

-- CreateIndex
CREATE UNIQUE INDEX "CorrectiveAction_organisationId_id_key" ON "CorrectiveAction"("organisationId", "id");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organisationId_nonconformityId_idx" ON "CorrectiveAction"("organisationId", "nonconformityId");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organisationId_status_idx" ON "CorrectiveAction"("organisationId", "status");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organisationId_ownerMembershipId_idx" ON "CorrectiveAction"("organisationId", "ownerMembershipId");

-- CreateIndex
CREATE INDEX "CorrectiveAction_organisationId_dueDate_idx" ON "CorrectiveAction"("organisationId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "EffectivenessReview_organisationId_id_key" ON "EffectivenessReview"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EffectivenessReview_organisationId_nonconformityId_idx" ON "EffectivenessReview"("organisationId", "nonconformityId");

-- CreateIndex
CREATE UNIQUE INDEX "NonconformityClosure_organisationId_id_key" ON "NonconformityClosure"("organisationId", "id");

-- CreateIndex
CREATE INDEX "NonconformityClosure_organisationId_nonconformityId_idx" ON "NonconformityClosure"("organisationId", "nonconformityId");

-- AddForeignKey
ALTER TABLE "RootCauseAnalysis" ADD CONSTRAINT "RootCauseAnalysis_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RootCauseAnalysis" ADD CONSTRAINT "RootCauseAnalysis_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RootCauseAnalysis" ADD CONSTRAINT "RootCauseAnalysis_organisationId_approvedByMembershipId_fkey" FOREIGN KEY ("organisationId", "approvedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organisationId_sharedActionItemId_fkey" FOREIGN KEY ("organisationId", "sharedActionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectiveAction" ADD CONSTRAINT "CorrectiveAction_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectivenessReview" ADD CONSTRAINT "EffectivenessReview_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectivenessReview" ADD CONSTRAINT "EffectivenessReview_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EffectivenessReview" ADD CONSTRAINT "EffectivenessReview_organisationId_reviewerMembershipId_fkey" FOREIGN KEY ("organisationId", "reviewerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformityClosure" ADD CONSTRAINT "NonconformityClosure_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NonconformityClosure" ADD CONSTRAINT "NonconformityClosure_organisationId_nonconformityId_fkey" FOREIGN KEY ("organisationId", "nonconformityId") REFERENCES "Nonconformity"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
