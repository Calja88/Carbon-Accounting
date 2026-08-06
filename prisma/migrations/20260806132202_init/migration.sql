-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DATA_OWNER', 'SUSTAINABILITY_LEAD', 'FINANCE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ConsolidationApproach" AS ENUM ('OPERATIONAL_CONTROL');

-- CreateEnum
CREATE TYPE "Scope" AS ENUM ('SCOPE_1', 'SCOPE_2');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('QUANTITY', 'CONTRACT_INFO');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('SUBMITTED', 'FLAGGED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FactorBasis" AS ENUM ('STANDARD', 'LOCATION_BASED', 'MARKET_BASED', 'RESIDUAL_MIX');

-- CreateEnum
CREATE TYPE "DataQualityTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "TariffType" AS ENUM ('STANDARD', 'GREEN');

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "consolidationApproach" "ConsolidationApproach" NOT NULL DEFAULT 'OPERATIONAL_CONTROL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityDataPoint" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "category" TEXT NOT NULL,
    "dataPointName" TEXT NOT NULL,
    "promptTemplate" TEXT NOT NULL,
    "helpText" TEXT,
    "sourceSystemHint" TEXT,
    "unitOptions" TEXT[],
    "frequency" TEXT NOT NULL,
    "defaultTier" "DataQualityTier" NOT NULL,
    "formType" "FormType" NOT NULL,
    "buildPriority" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "factorCategory" TEXT NOT NULL,

    CONSTRAINT "ActivityDataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactorOption" (
    "id" TEXT NOT NULL,
    "activityDataPointId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "subtypeKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FactorOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissionFactorSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "vintageYear" INTEGER NOT NULL,
    "publishedDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmissionFactorSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmissionFactor" (
    "id" TEXT NOT NULL,
    "factorSetId" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "category" TEXT NOT NULL,
    "subtypeKey" TEXT,
    "basis" "FactorBasis" NOT NULL DEFAULT 'STANDARD',
    "region" TEXT NOT NULL DEFAULT 'UK',
    "unit" TEXT NOT NULL,
    "co2eFactor" DECIMAL(18,8) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "EmissionFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteEnergyContract" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "supplierName" TEXT NOT NULL,
    "tariffType" "TariffType" NOT NULL,
    "regoBacked" BOOLEAN NOT NULL DEFAULT false,
    "regoVolumeKwh" DECIMAL(18,3),
    "source" TEXT,
    "enteredByUserId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEnergyContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" TEXT NOT NULL,
    "activityDataPointId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "rawValue" DECIMAL(18,4) NOT NULL,
    "rawUnit" TEXT NOT NULL,
    "canonicalValue" DECIMAL(18,8) NOT NULL,
    "canonicalUnit" TEXT NOT NULL,
    "factorOptionId" TEXT,
    "dataQualityTier" "DataQualityTier" NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'SUBMITTED',
    "plausibilityFlagged" BOOLEAN NOT NULL DEFAULT false,
    "plausibilityReason" TEXT,
    "notes" TEXT,
    "enteredByUserId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calculation" (
    "id" TEXT NOT NULL,
    "activityEntryId" TEXT NOT NULL,
    "emissionFactorId" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "basis" "FactorBasis" NOT NULL,
    "inputValue" DECIMAL(18,8) NOT NULL,
    "inputUnit" TEXT NOT NULL,
    "factorValueSnapshot" DECIMAL(18,8) NOT NULL,
    "factorUnitSnapshot" TEXT NOT NULL,
    "factorSourceSnapshot" TEXT NOT NULL,
    "factorVintageSnapshot" TEXT NOT NULL,
    "formulaApplied" TEXT NOT NULL,
    "resultKgCo2e" DECIMAL(18,8) NOT NULL,
    "dataQualityTier" "DataQualityTier" NOT NULL,
    "calculatedByUserId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engineVersion" TEXT NOT NULL DEFAULT 'calc-engine-v1',
    "supersededById" TEXT,

    CONSTRAINT "Calculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "version" SERIAL NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshotCalculation" (
    "id" TEXT NOT NULL,
    "reportSnapshotId" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,

    CONSTRAINT "ReportSnapshotCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_name_key" ON "Entity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Site_entityId_name_key" ON "Site"("entityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityDataPoint_code_key" ON "ActivityDataPoint"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FactorOption_activityDataPointId_subtypeKey_key" ON "FactorOption"("activityDataPointId", "subtypeKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmissionFactor_factorSetId_category_subtypeKey_basis_key" ON "EmissionFactor"("factorSetId", "category", "subtypeKey", "basis");

-- CreateIndex
CREATE INDEX "ActivityEntry_activityDataPointId_siteId_periodStart_idx" ON "ActivityEntry"("activityDataPointId", "siteId", "periodStart");

-- CreateIndex
CREATE INDEX "Calculation_activityEntryId_idx" ON "Calculation"("activityEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSnapshotCalculation_reportSnapshotId_calculationId_key" ON "ReportSnapshotCalculation"("reportSnapshotId", "calculationId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactorOption" ADD CONSTRAINT "FactorOption_activityDataPointId_fkey" FOREIGN KEY ("activityDataPointId") REFERENCES "ActivityDataPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_factorSetId_fkey" FOREIGN KEY ("factorSetId") REFERENCES "EmissionFactorSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEnergyContract" ADD CONSTRAINT "SiteEnergyContract_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteEnergyContract" ADD CONSTRAINT "SiteEnergyContract_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_activityDataPointId_fkey" FOREIGN KEY ("activityDataPointId") REFERENCES "ActivityDataPoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_factorOptionId_fkey" FOREIGN KEY ("factorOptionId") REFERENCES "FactorOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_activityEntryId_fkey" FOREIGN KEY ("activityEntryId") REFERENCES "ActivityEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotCalculation" ADD CONSTRAINT "ReportSnapshotCalculation_reportSnapshotId_fkey" FOREIGN KEY ("reportSnapshotId") REFERENCES "ReportSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshotCalculation" ADD CONSTRAINT "ReportSnapshotCalculation_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "Calculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
