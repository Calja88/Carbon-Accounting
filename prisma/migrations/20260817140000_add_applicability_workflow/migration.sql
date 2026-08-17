-- T43: applicability workflow only. No environmental data or reference
-- records are seeded.

-- CreateEnum
CREATE TYPE "ApplicabilityAssessmentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPLICABLE', 'NOT_APPLICABLE', 'UNCERTAIN', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "ApplicabilityAssessment" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "changeEventId" TEXT,
    "status" "ApplicabilityAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "rationale" TEXT,
    "proposedDecision" "ApplicabilityAssessmentStatus",
    "assessedByMembershipId" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByMembershipId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "followUpOwnerMembershipId" TEXT,
    "supersedesAssessmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicabilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicabilityAssessmentScope" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "entityId" TEXT,
    "siteId" TEXT,
    "processId" TEXT,
    "aspectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicabilityAssessmentScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicabilityAssessment_organisationId_instrumentId_status_idx" ON "ApplicabilityAssessment"("organisationId", "instrumentId", "status");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessment_organisationId_changeEventId_idx" ON "ApplicabilityAssessment"("organisationId", "changeEventId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessment_organisationId_status_idx" ON "ApplicabilityAssessment"("organisationId", "status");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessment_organisationId_assessedByMembership_idx" ON "ApplicabilityAssessment"("organisationId", "assessedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicabilityAssessment_organisationId_id_key" ON "ApplicabilityAssessment"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicabilityAssessment_organisationId_supersedesAssessment_key" ON "ApplicabilityAssessment"("organisationId", "supersedesAssessmentId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessmentScope_organisationId_assessmentId_idx" ON "ApplicabilityAssessmentScope"("organisationId", "assessmentId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessmentScope_organisationId_entityId_idx" ON "ApplicabilityAssessmentScope"("organisationId", "entityId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessmentScope_organisationId_siteId_idx" ON "ApplicabilityAssessmentScope"("organisationId", "siteId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessmentScope_organisationId_processId_idx" ON "ApplicabilityAssessmentScope"("organisationId", "processId");

-- CreateIndex
CREATE INDEX "ApplicabilityAssessmentScope_organisationId_aspectId_idx" ON "ApplicabilityAssessmentScope"("organisationId", "aspectId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicabilityAssessmentScope_scope_key" ON "ApplicabilityAssessmentScope"("organisationId", "assessmentId", "entityId", "siteId", "processId", "aspectId");

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "LegalChangeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_assessedByMembershi_fkey" FOREIGN KEY ("organisationId", "assessedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_reviewedByMembershi_fkey" FOREIGN KEY ("organisationId", "reviewedByMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_followUpOwnerMember_fkey" FOREIGN KEY ("organisationId", "followUpOwnerMembershipId") REFERENCES "OrganisationMembership"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessment" ADD CONSTRAINT "ApplicabilityAssessment_organisationId_supersedesAssessmen_fkey" FOREIGN KEY ("organisationId", "supersedesAssessmentId") REFERENCES "ApplicabilityAssessment"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_assessmentId_fkey" FOREIGN KEY ("organisationId", "assessmentId") REFERENCES "ApplicabilityAssessment"("organisationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_entityId_fkey" FOREIGN KEY ("organisationId", "entityId") REFERENCES "Entity"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_siteId_fkey" FOREIGN KEY ("organisationId", "siteId") REFERENCES "Site"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_processId_fkey" FOREIGN KEY ("organisationId", "processId") REFERENCES "ActivityProcess"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicabilityAssessmentScope" ADD CONSTRAINT "ApplicabilityAssessmentScope_organisationId_aspectId_fkey" FOREIGN KEY ("organisationId", "aspectId") REFERENCES "EnvironmentalAspect"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
