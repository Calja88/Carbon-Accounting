
-- CreateEnum
CREATE TYPE "LciLicenseDecision" AS ENUM ('ALLOW_WITH_ATTRIBUTION', 'CONDITIONAL_DATASET_LEVEL_REVIEW', 'BLOCK', 'METADATA_ONLY');

-- AlterTable
ALTER TABLE "EmissionFactor" ADD COLUMN     "automatedAssignmentAllowed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "externalFactorId" TEXT,
ADD COLUMN     "humanReviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isCharacterisedFactor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFullUnitProcessLci" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSecondaryData" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNotes" TEXT,
ADD COLUMN     "sourceLifecycleBoundary" TEXT,
ADD COLUMN     "sourceVersion" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3),
ADD COLUMN     "validTo" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EmissionFactorSet" ADD COLUMN     "geography" TEXT,
ADD COLUMN     "lciSourceId" TEXT,
ADD COLUMN     "licenseDecision" "LciLicenseDecision",
ADD COLUMN     "licenseName" TEXT,
ADD COLUMN     "methodologyUrl" TEXT,
ADD COLUMN     "publicationDate" TIMESTAMP(3),
ADD COLUMN     "sourceUpdatedDate" TIMESTAMP(3),
ADD COLUMN     "sourceVersion" TEXT;

-- CreateTable
CREATE TABLE "LciSource" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "owner" TEXT,
    "coverage" TEXT,
    "licenseDecision" "LciLicenseDecision" NOT NULL,
    "rawLicenseDecision" TEXT NOT NULL,
    "licenseSummary" TEXT,
    "dataUrl" TEXT,
    "licenseUrl" TEXT,
    "relevance" TEXT,
    "recommendedAction" TEXT,
    "lastChecked" TIMESTAMP(3),
    "manifestVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LciSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LciSource_sourceId_key" ON "LciSource"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EmissionFactor_externalFactorId_sourceVersion_key" ON "EmissionFactor"("externalFactorId", "sourceVersion");

-- AddForeignKey
ALTER TABLE "EmissionFactorSet" ADD CONSTRAINT "EmissionFactorSet_lciSourceId_fkey" FOREIGN KEY ("lciSourceId") REFERENCES "LciSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

