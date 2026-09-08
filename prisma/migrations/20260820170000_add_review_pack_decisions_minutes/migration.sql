-- CreateEnum
CREATE TYPE "ManagementReviewPackStatus" AS ENUM ('DRAFT', 'ISSUED');

-- CreateEnum
CREATE TYPE "ManagementReviewAiNarrativeStatus" AS ENUM ('PENDING_REVIEW', 'REVIEWED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ManagementReviewDecisionType" AS ENUM ('RESOURCE_ALLOCATION', 'OBJECTIVE_OR_POLICY_CHANGE', 'PROCESS_OR_CONTROL_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ManagementReviewMinuteRevisionStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "ManagementReviewPack" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "agendaTemplateVersionId" TEXT NOT NULL,
    "cutoffDate" TIMESTAMP(3) NOT NULL,
    "generatorVersion" TEXT NOT NULL DEFAULT 't73-pack-v1',
    "status" "ManagementReviewPackStatus" NOT NULL DEFAULT 'DRAFT',
    "payload" JSONB,
    "checksumSha256" TEXT,
    "generatedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewInputSnapshot" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "inputDefinitionKey" TEXT NOT NULL,
    "sourceType" "ManagementReviewInputSourceType" NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "sourceVersionLabel" TEXT,
    "summary" JSONB,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReviewInputSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewAiNarrative" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ManagementReviewAiNarrativeStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "ManagementReviewAiNarrative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewDecision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "inputDefinitionKey" TEXT,
    "decisionType" "ManagementReviewDecisionType" NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT,
    "ownerMembershipId" TEXT,
    "targetDate" TIMESTAMP(3),
    "recordedByMembershipId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewMinuteRevision" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "ManagementReviewMinuteRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "checksumSha256" TEXT,
    "narrativeId" TEXT,
    "preparedByMembershipId" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedByMembershipId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersedesRevisionId" TEXT,
    "addendumReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementReviewMinuteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagementReviewActionLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "actionItemId" TEXT NOT NULL,
    "linkedByMembershipId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagementReviewActionLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewPack_organisationId_id_key" ON "ManagementReviewPack"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewPack_organisationId_reviewId_key" ON "ManagementReviewPack"("organisationId", "reviewId");

-- CreateIndex
CREATE INDEX "ManagementReviewPack_organisationId_status_idx" ON "ManagementReviewPack"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewInputSnapshot_organisationId_id_key" ON "ManagementReviewInputSnapshot"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewInputSnapshot_unique_source" ON "ManagementReviewInputSnapshot"("organisationId", "packId", "inputDefinitionKey", "sourceRecordId");

-- CreateIndex
CREATE INDEX "ManagementReviewInputSnapshot_organisationId_packId_idx" ON "ManagementReviewInputSnapshot"("organisationId", "packId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewAiNarrative_organisationId_id_key" ON "ManagementReviewAiNarrative"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ManagementReviewAiNarrative_organisationId_packId_status_idx" ON "ManagementReviewAiNarrative"("organisationId", "packId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewDecision_organisationId_id_key" ON "ManagementReviewDecision"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ManagementReviewDecision_organisationId_reviewId_idx" ON "ManagementReviewDecision"("organisationId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewMinuteRevision_organisationId_id_key" ON "ManagementReviewMinuteRevision"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewMinuteRevision_organisationId_reviewId_revisionNumber_key" ON "ManagementReviewMinuteRevision"("organisationId", "reviewId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewMinuteRevision_organisationId_supersedesRevisionId_key" ON "ManagementReviewMinuteRevision"("organisationId", "supersedesRevisionId");

-- CreateIndex
CREATE INDEX "ManagementReviewMinuteRevision_organisationId_reviewId_status_idx" ON "ManagementReviewMinuteRevision"("organisationId", "reviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewActionLink_organisationId_id_key" ON "ManagementReviewActionLink"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ManagementReviewActionLink_organisationId_decisionId_actionItemId_key" ON "ManagementReviewActionLink"("organisationId", "decisionId", "actionItemId");

-- CreateIndex
CREATE INDEX "ManagementReviewActionLink_organisationId_decisionId_idx" ON "ManagementReviewActionLink"("organisationId", "decisionId");

-- CreateIndex
CREATE INDEX "ManagementReviewActionLink_organisationId_actionItemId_idx" ON "ManagementReviewActionLink"("organisationId", "actionItemId");

-- AddForeignKey
ALTER TABLE "ManagementReviewPack" ADD CONSTRAINT "ManagementReviewPack_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewPack" ADD CONSTRAINT "ManagementReviewPack_organisationId_reviewId_fkey" FOREIGN KEY ("organisationId", "reviewId") REFERENCES "ManagementReview"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputSnapshot" ADD CONSTRAINT "ManagementReviewInputSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewInputSnapshot" ADD CONSTRAINT "ManagementReviewInputSnapshot_organisationId_packId_fkey" FOREIGN KEY ("organisationId", "packId") REFERENCES "ManagementReviewPack"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAiNarrative" ADD CONSTRAINT "ManagementReviewAiNarrative_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewAiNarrative" ADD CONSTRAINT "ManagementReviewAiNarrative_organisationId_packId_fkey" FOREIGN KEY ("organisationId", "packId") REFERENCES "ManagementReviewPack"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewDecision" ADD CONSTRAINT "ManagementReviewDecision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewDecision" ADD CONSTRAINT "ManagementReviewDecision_organisationId_reviewId_fkey" FOREIGN KEY ("organisationId", "reviewId") REFERENCES "ManagementReview"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewDecision" ADD CONSTRAINT "ManagementReviewDecision_organisationId_ownerMembershipId_fkey" FOREIGN KEY ("organisationId", "ownerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewDecision" ADD CONSTRAINT "ManagementReviewDecision_organisationId_recordedByMembershipId_fkey" FOREIGN KEY ("organisationId", "recordedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_reviewId_fkey" FOREIGN KEY ("organisationId", "reviewId") REFERENCES "ManagementReview"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_narrativeId_fkey" FOREIGN KEY ("organisationId", "narrativeId") REFERENCES "ManagementReviewAiNarrative"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_preparedByMembershipId_fkey" FOREIGN KEY ("organisationId", "preparedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_approvedByMembershipId_fkey" FOREIGN KEY ("organisationId", "approvedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewMinuteRevision" ADD CONSTRAINT "ManagementReviewMinuteRevision_organisationId_supersedesRevisionId_fkey" FOREIGN KEY ("organisationId", "supersedesRevisionId") REFERENCES "ManagementReviewMinuteRevision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewActionLink" ADD CONSTRAINT "ManagementReviewActionLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewActionLink" ADD CONSTRAINT "ManagementReviewActionLink_organisationId_decisionId_fkey" FOREIGN KEY ("organisationId", "decisionId") REFERENCES "ManagementReviewDecision"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewActionLink" ADD CONSTRAINT "ManagementReviewActionLink_organisationId_actionItemId_fkey" FOREIGN KEY ("organisationId", "actionItemId") REFERENCES "ActionItem"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagementReviewActionLink" ADD CONSTRAINT "ManagementReviewActionLink_organisationId_linkedByMembershipId_fkey" FOREIGN KEY ("organisationId", "linkedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
