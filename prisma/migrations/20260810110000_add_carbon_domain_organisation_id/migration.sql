-- Phase 1 tenancy (T16): expand-only. Adds a nullable organisationId to
-- every corporate-carbon root named in PHASE1_TENANCY_RBAC_SPEC.md §4
-- ("Organisation ownership matrix") that did not already get one from T10.
-- No backfill, no NOT NULL, no dropped constraint here — same deferred-to-T1A
-- contract as Entity/Site.organisationId.

-- AlterTable
ALTER TABLE "SiteEnergyContract" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "CommutingSurvey" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "Calculation" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "ReportSnapshot" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN     "organisationId" TEXT;

-- CreateIndex
CREATE INDEX "SiteEnergyContract_organisationId_idx" ON "SiteEnergyContract"("organisationId");

-- CreateIndex
CREATE INDEX "ActivityEntry_organisationId_idx" ON "ActivityEntry"("organisationId");

-- CreateIndex
CREATE INDEX "CommutingSurvey_organisationId_idx" ON "CommutingSurvey"("organisationId");

-- CreateIndex
CREATE INDEX "Calculation_organisationId_idx" ON "Calculation"("organisationId");

-- CreateIndex
CREATE INDEX "ReportSnapshot_organisationId_idx" ON "ReportSnapshot"("organisationId");

-- CreateIndex
CREATE INDEX "SourceDocument_organisationId_idx" ON "SourceDocument"("organisationId");

-- AddForeignKey
ALTER TABLE "SiteEnergyContract" ADD CONSTRAINT "SiteEnergyContract_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurvey" ADD CONSTRAINT "CommutingSurvey_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
