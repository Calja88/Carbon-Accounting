-- CreateEnum
CREATE TYPE "FactorSourceType" AS ENUM ('OFFICIAL_DEFRA_DESNZ', 'EEIO_SPEND_BASED', 'SUPPLIER_SPECIFIC');

-- AlterEnum
ALTER TYPE "Scope" ADD VALUE 'SCOPE_3';

-- AlterEnum
ALTER TYPE "FormType" ADD VALUE 'SURVEY';

-- AlterEnum
ALTER TYPE "EntryStatus" ADD VALUE 'AWAITING_FACTOR';

-- AlterTable
ALTER TABLE "ActivityDataPoint" ADD COLUMN     "scope3Category" TEXT;

-- AlterTable
ALTER TABLE "FactorOption" ADD COLUMN     "unit" TEXT;

-- AlterTable
ALTER TABLE "EmissionFactorSet" ADD COLUMN     "importedByUserId" TEXT,
ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "sourceType" "FactorSourceType" NOT NULL DEFAULT 'OFFICIAL_DEFRA_DESNZ',
ADD COLUMN     "supplierName" TEXT;

-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "supplierName" TEXT;

-- AlterTable
ALTER TABLE "Calculation" ADD COLUMN     "derivedFromCalculationId" TEXT,
ADD COLUMN     "scope3Category" TEXT;

-- CreateTable
CREATE TABLE "CommutingSurvey" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "headcount" INTEGER NOT NULL,
    "commutingDaysInPeriod" INTEGER NOT NULL,
    "enteredByUserId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommutingSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommutingSurveyResponse" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "factorOptionId" TEXT NOT NULL,
    "percentOfHeadcount" DECIMAL(5,2) NOT NULL,
    "avgOneWayDistanceMiles" DECIMAL(10,3) NOT NULL,
    "activityEntryId" TEXT,

    CONSTRAINT "CommutingSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommutingSurvey_siteId_periodStart_idx" ON "CommutingSurvey"("siteId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CommutingSurveyResponse_activityEntryId_key" ON "CommutingSurveyResponse"("activityEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "CommutingSurveyResponse_surveyId_factorOptionId_key" ON "CommutingSurveyResponse"("surveyId", "factorOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Calculation_derivedFromCalculationId_key" ON "Calculation"("derivedFromCalculationId");

-- AddForeignKey
ALTER TABLE "EmissionFactorSet" ADD CONSTRAINT "EmissionFactorSet_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurvey" ADD CONSTRAINT "CommutingSurvey_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurvey" ADD CONSTRAINT "CommutingSurvey_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurveyResponse" ADD CONSTRAINT "CommutingSurveyResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "CommutingSurvey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurveyResponse" ADD CONSTRAINT "CommutingSurveyResponse_factorOptionId_fkey" FOREIGN KEY ("factorOptionId") REFERENCES "FactorOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommutingSurveyResponse" ADD CONSTRAINT "CommutingSurveyResponse_activityEntryId_fkey" FOREIGN KEY ("activityEntryId") REFERENCES "ActivityEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_derivedFromCalculationId_fkey" FOREIGN KEY ("derivedFromCalculationId") REFERENCES "Calculation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

