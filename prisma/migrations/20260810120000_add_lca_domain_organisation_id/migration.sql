-- Phase 1 tenancy (T17): expand-only. Adds a nullable organisationId to
-- every LCA-domain root named in PHASE1_TENANCY_RBAC_SPEC.md §4
-- ("Organisation ownership matrix") that did not already get one from T10 —
-- the same treatment T16 gave the corporate-carbon roots. No backfill, no
-- NOT NULL, no dropped constraint here — same deferred-to-T1A contract as
-- Entity/Site.organisationId.

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "LcaMethodologyProfile" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "LcaAssessment" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "LcaSupplierPcf" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "LcaEvidence" ADD COLUMN     "organisationId" TEXT;

-- AlterTable
ALTER TABLE "LcaAssessmentVersion" ADD COLUMN     "organisationId" TEXT;

-- CreateIndex
CREATE INDEX "Supplier_organisationId_idx" ON "Supplier"("organisationId");

-- CreateIndex
CREATE INDEX "Product_organisationId_idx" ON "Product"("organisationId");

-- CreateIndex
CREATE INDEX "LcaMethodologyProfile_organisationId_idx" ON "LcaMethodologyProfile"("organisationId");

-- CreateIndex
CREATE INDEX "LcaAssessment_organisationId_status_idx" ON "LcaAssessment"("organisationId", "status");

-- CreateIndex
CREATE INDEX "LcaSupplierPcf_organisationId_idx" ON "LcaSupplierPcf"("organisationId");

-- CreateIndex
CREATE INDEX "LcaEvidence_organisationId_idx" ON "LcaEvidence"("organisationId");

-- CreateIndex
CREATE INDEX "LcaAssessmentVersion_organisationId_idx" ON "LcaAssessmentVersion"("organisationId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaMethodologyProfile" ADD CONSTRAINT "LcaMethodologyProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaSupplierPcf" ADD CONSTRAINT "LcaSupplierPcf_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessmentVersion" ADD CONSTRAINT "LcaAssessmentVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
