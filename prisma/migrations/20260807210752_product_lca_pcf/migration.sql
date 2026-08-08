-- CreateEnum
CREATE TYPE "LcaAssessmentStatus" AS ENUM ('DRAFT', 'DATA_COLLECTION', 'CALCULATION', 'INTERNAL_REVIEW', 'READY_FOR_VERIFICATION', 'VERIFIED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LcaBoundary" AS ENUM ('CRADLE_TO_GATE', 'CRADLE_TO_GRAVE', 'CRADLE_TO_CRADLE', 'GATE_TO_GATE', 'GATE_TO_GRAVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LcaLifecycleStage" AS ENUM ('RAW_MATERIALS', 'INBOUND_TRANSPORT', 'MANUFACTURING', 'PACKAGING', 'DISTRIBUTION', 'USE_PHASE', 'END_OF_LIFE', 'OTHER');

-- CreateEnum
CREATE TYPE "LcaAllocationMethod" AS ENUM ('NONE', 'MASS', 'PHYSICAL', 'ECONOMIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "LcaEmissionClassification" AS ENUM ('FOSSIL', 'BIOGENIC', 'BIOGENIC_REMOVAL', 'TECHNOLOGICAL_REMOVAL', 'STORED_CARBON', 'AVOIDED_BURDEN', 'OFFSET');

-- CreateEnum
CREATE TYPE "LcaDataType" AS ENUM ('PRIMARY', 'SUPPLIER_SPECIFIC', 'SECONDARY', 'PROXY', 'MODELLED');

-- CreateEnum
CREATE TYPE "LcaItemType" AS ENUM ('MATERIAL', 'ENERGY', 'FUEL', 'TRANSPORT', 'MANUFACTURING_PROCESS', 'PACKAGING', 'WASTE', 'WATER', 'USE_PHASE', 'END_OF_LIFE', 'SUPPLIER_PCF', 'OTHER');

-- CreateEnum
CREATE TYPE "LcaTransportMode" AS ENUM ('ROAD', 'RAIL', 'SEA', 'AIR', 'INLAND_WATERWAY', 'MULTIMODAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LcaEndOfLifeRouteType" AS ENUM ('LANDFILL', 'RECYCLING', 'INCINERATION_ENERGY_RECOVERY', 'INCINERATION_NO_RECOVERY', 'REUSE', 'COMPOSTING', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LcaUncertaintyStatus" AS ENUM ('NOT_ASSESSED', 'QUALITATIVE', 'ESTIMATED', 'QUANTIFIED');

-- CreateEnum
CREATE TYPE "LcaMateriality" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LcaAssuranceType" AS ENUM ('NONE', 'INTERNAL_REVIEW', 'CRITICAL_REVIEW', 'LIMITED_ASSURANCE', 'REASONABLE_ASSURANCE');

-- CreateEnum
CREATE TYPE "LcaPcfVerificationStatus" AS ENUM ('UNVERIFIED', 'SELF_DECLARED', 'SECOND_PARTY_REVIEWED', 'THIRD_PARTY_VERIFIED');

-- CreateEnum
CREATE TYPE "LcaFactorBoundary" AS ENUM ('UNKNOWN', 'CRADLE_TO_GATE', 'CRADLE_TO_GRAVE', 'GATE_TO_GATE', 'UPSTREAM', 'DOWNSTREAM', 'COMBUSTION_ONLY', 'WELL_TO_TANK', 'WELL_TO_WHEEL', 'END_OF_LIFE');

-- CreateEnum
CREATE TYPE "LcaFactorSelectionMode" AS ENUM ('NONE', 'LIBRARY_FACTOR', 'SUPPLIER_PCF', 'MANUAL');

-- CreateEnum
CREATE TYPE "LcaVersionStatus" AS ENUM ('DRAFT_REVISION', 'ISSUED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LcaBiogenicTreatment" AS ENUM ('EXCLUDED', 'REPORTED_SEPARATELY', 'INCLUDED_IN_TOTAL');

-- CreateEnum
CREATE TYPE "LcaRecyclingMethod" AS ENUM ('CUT_OFF', 'AVOIDED_BURDEN', 'CIRCULAR_FOOTPRINT_FORMULA', 'MANUAL');

-- CreateEnum
CREATE TYPE "LcaElectricityApproach" AS ENUM ('LOCATION_BASED', 'MARKET_BASED', 'DUAL_REPORTED');

-- CreateEnum
CREATE TYPE "LcaOffsetTreatment" AS ENUM ('EXCLUDED', 'DISCLOSED_SEPARATELY');

-- CreateEnum
CREATE TYPE "LcaProductStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "LcaEvidenceKind" AS ENUM ('EXTERNAL_LINK', 'UPLOADED_FILE', 'SYSTEM_RECORD');

-- CreateEnum
CREATE TYPE "LcaCorporateLinkType" AS ENUM ('FACILITY_ENERGY', 'SUPPLIER_RECORD', 'SCOPE3_ACTIVITY', 'OTHER');

-- AlterEnum
ALTER TYPE "FactorSourceType" ADD VALUE 'LCA_SECONDARY';

-- AlterTable
ALTER TABLE "EmissionFactor" ADD COLUMN     "boundary" "LcaFactorBoundary",
ADD COLUMN     "gwpBasis" TEXT,
ADD COLUMN     "lcaDataSource" TEXT,
ADD COLUMN     "referenceYear" INTEGER,
ADD COLUMN     "uncertaintyPercent" DECIMAL(9,4);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT,
    "country" TEXT,
    "contact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "status" "LcaProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVersion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "description" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductManufacturingLocation" (
    "id" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "siteId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "ProductManufacturingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaMethodologyProfile" (
    "id" TEXT NOT NULL,
    "entityId" TEXT,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "summary" TEXT,
    "defaultBoundary" "LcaBoundary" NOT NULL DEFAULT 'CRADLE_TO_GATE',
    "gwpBasis" TEXT NOT NULL,
    "defaultAllocationMethod" "LcaAllocationMethod" NOT NULL DEFAULT 'MASS',
    "allocationRules" TEXT,
    "recyclingMethod" "LcaRecyclingMethod" NOT NULL DEFAULT 'CUT_OFF',
    "recyclingRules" TEXT,
    "electricityApproach" "LcaElectricityApproach" NOT NULL DEFAULT 'LOCATION_BASED',
    "electricityRules" TEXT,
    "biogenicTreatment" "LcaBiogenicTreatment" NOT NULL DEFAULT 'REPORTED_SEPARATELY',
    "biogenicRules" TEXT,
    "removalsRules" TEXT,
    "offsetTreatment" "LcaOffsetTreatment" NOT NULL DEFAULT 'DISCLOSED_SEPARATELY',
    "offsetRules" TEXT,
    "cutOffRules" TEXT,
    "cutOffThresholdPercent" DECIMAL(6,3),
    "factorHierarchy" TEXT[],
    "dataQualityRequirements" TEXT,
    "minimumDataQualityScore" DECIMAL(4,2),
    "requireEvidenceForPrimary" BOOLEAN NOT NULL DEFAULT true,
    "standardsReferenced" TEXT[],
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaMethodologyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaAssessment" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "LcaAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "versionLabel" TEXT,
    "parentAssessmentId" TEXT,
    "supersededByAssessmentId" TEXT,
    "isScenario" BOOLEAN NOT NULL DEFAULT false,
    "baselineAssessmentId" TEXT,
    "scenarioDescription" TEXT,
    "goal" TEXT,
    "intendedApplication" TEXT,
    "intendedAudience" TEXT,
    "comparativeAssertionDisclosed" BOOLEAN NOT NULL DEFAULT false,
    "scopeDescription" TEXT,
    "boundary" "LcaBoundary" NOT NULL DEFAULT 'CRADLE_TO_GATE',
    "boundaryNotes" TEXT,
    "includedStages" "LcaLifecycleStage"[],
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "ownerUserId" TEXT,
    "functionalUnitDescription" TEXT,
    "functionalUnitQuantity" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "functionalUnitUnit" TEXT,
    "isDeclaredUnit" BOOLEAN NOT NULL DEFAULT false,
    "declaredUnitDescription" TEXT,
    "referenceFlowDescription" TEXT,
    "referenceFlowQuantity" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "referenceFlowUnit" TEXT,
    "modelledOutputQuantity" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "modelledOutputUnit" TEXT,
    "modelledOutputDescription" TEXT,
    "methodologyProfileId" TEXT,
    "methodologySnapshot" JSONB,
    "methodologyNotes" TEXT,
    "usePhaseLifetimeYears" DECIMAL(12,4),
    "usePhaseAssumptions" TEXT,
    "completenessNotes" TEXT,
    "limitations" TEXT,
    "interpretation" TEXT,
    "engineVersion" TEXT NOT NULL DEFAULT 'lca-engine-v1',
    "lastCalculationRunId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaProcess" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "parentProcessId" TEXT,
    "stage" "LcaLifecycleStage" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "allocationMethod" "LcaAllocationMethod" NOT NULL DEFAULT 'NONE',
    "allocationPercent" DECIMAL(9,6) NOT NULL DEFAULT 100,
    "allocationRationale" TEXT,
    "allocationBasisDescription" TEXT,
    "geography" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaProcessOutput" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAssessedProduct" BOOLEAN NOT NULL DEFAULT false,
    "massValue" DECIMAL(24,10),
    "massUnit" TEXT,
    "physicalValue" DECIMAL(24,10),
    "physicalUnit" TEXT,
    "economicValue" DECIMAL(24,10),
    "economicCurrency" TEXT,
    "manualPercent" DECIMAL(9,6),
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LcaProcessOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaInventoryItem" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "itemType" "LcaItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "componentName" TEXT,
    "partNumber" TEXT,
    "materialName" TEXT,
    "recycledContentPercent" DECIMAL(9,6),
    "wastePercent" DECIMAL(9,6),
    "quantity" DECIMAL(24,10) NOT NULL,
    "unit" TEXT NOT NULL,
    "adjustmentFactor" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "adjustmentRationale" TEXT,
    "dataType" "LcaDataType" NOT NULL DEFAULT 'SECONDARY',
    "dataSource" TEXT,
    "supplierId" TEXT,
    "geography" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "factorSelectionMode" "LcaFactorSelectionMode" NOT NULL DEFAULT 'NONE',
    "emissionFactorId" TEXT,
    "recycledEmissionFactorId" TEXT,
    "supplierPcfId" TEXT,
    "manualFactorValue" DECIMAL(24,10),
    "manualFactorUnit" TEXT,
    "manualFactorSource" TEXT,
    "manualFactorVersion" TEXT,
    "manualFactorBoundary" "LcaFactorBoundary",
    "manualFactorGeography" TEXT,
    "manualFactorYear" INTEGER,
    "manualFactorGwpBasis" TEXT,
    "manualFactorRationale" TEXT,
    "classification" "LcaEmissionClassification" NOT NULL DEFAULT 'FOSSIL',
    "biogenicUptakePerUnit" DECIMAL(24,10),
    "storedCarbonPerUnit" DECIMAL(24,10),
    "temporalScore" INTEGER,
    "geographicalScore" INTEGER,
    "technologicalScore" INTEGER,
    "completenessScore" INTEGER,
    "reliabilityScore" INTEGER,
    "uncertaintyStatus" "LcaUncertaintyStatus" NOT NULL DEFAULT 'NOT_ASSESSED',
    "uncertaintyPercent" DECIMAL(9,4),
    "uncertaintyLower" DECIMAL(24,10),
    "uncertaintyUpper" DECIMAL(24,10),
    "uncertaintyNotes" TEXT,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaTransportLeg" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "mode" "LcaTransportMode" NOT NULL,
    "modeDescription" TEXT,
    "originName" TEXT,
    "destinationName" TEXT,
    "distanceValue" DECIMAL(24,10) NOT NULL,
    "distanceUnit" TEXT NOT NULL DEFAULT 'km',
    "massValue" DECIMAL(24,10) NOT NULL,
    "massUnit" TEXT NOT NULL DEFAULT 'kg',
    "loadFactorPercent" DECIMAL(9,6),
    "includesReturnTrip" BOOLEAN NOT NULL DEFAULT false,
    "emissionFactorId" TEXT,
    "manualFactorValue" DECIMAL(24,10),
    "manualFactorUnit" TEXT,
    "manualFactorSource" TEXT,
    "assumptions" TEXT,
    "notes" TEXT,

    CONSTRAINT "LcaTransportLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaEndOfLifeRoute" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "route" "LcaEndOfLifeRouteType" NOT NULL,
    "routeDescription" TEXT,
    "percent" DECIMAL(9,6) NOT NULL,
    "emissionFactorId" TEXT,
    "manualFactorValue" DECIMAL(24,10),
    "manualFactorUnit" TEXT,
    "manualFactorSource" TEXT,
    "recoveryRatePercent" DECIMAL(9,6),
    "avoidedFactorValue" DECIMAL(24,10),
    "avoidedFactorUnit" TEXT,
    "avoidedFactorSource" TEXT,
    "recoveryAssumptions" TEXT,
    "notes" TEXT,

    CONSTRAINT "LcaEndOfLifeRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaSupplierPcf" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productIdentifier" TEXT,
    "productCategory" TEXT,
    "pcfValue" DECIMAL(24,10) NOT NULL,
    "pcfBiogenicValue" DECIMAL(24,10),
    "declaredUnitQuantity" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "declaredUnitUnit" TEXT NOT NULL,
    "declaredUnitDescription" TEXT,
    "boundary" "LcaBoundary" NOT NULL,
    "boundaryNotes" TEXT,
    "methodology" TEXT,
    "methodologyVersion" TEXT,
    "gwpBasis" TEXT,
    "reportingPeriodStart" TIMESTAMP(3),
    "reportingPeriodEnd" TIMESTAMP(3),
    "geography" TEXT,
    "verificationStatus" "LcaPcfVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifierName" TEXT,
    "verificationDate" TIMESTAMP(3),
    "assuranceType" "LcaAssuranceType" NOT NULL DEFAULT 'NONE',
    "primaryDataSharePercent" DECIMAL(9,6),
    "temporalScore" INTEGER,
    "geographicalScore" INTEGER,
    "technologicalScore" INTEGER,
    "completenessScore" INTEGER,
    "reliabilityScore" INTEGER,
    "uncertaintyPercent" DECIMAL(9,4),
    "sourceFormat" TEXT,
    "sourcePayload" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaSupplierPcf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaAssumption" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "assumption" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "source" TEXT,
    "uncertainty" TEXT,
    "materiality" "LcaMateriality" NOT NULL DEFAULT 'MEDIUM',
    "ownerUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processId" TEXT,
    "inventoryItemId" TEXT,

    CONSTRAINT "LcaAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaExclusion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "excludedItem" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "estimatedRelevance" TEXT NOT NULL,
    "estimatedPercentOfTotal" DECIMAL(9,4),
    "ownerUserId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processId" TEXT,

    CONSTRAINT "LcaExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaCorporateDataLink" (
    "id" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "linkType" "LcaCorporateLinkType" NOT NULL,
    "activityEntryId" TEXT,
    "siteId" TEXT,
    "supplierName" TEXT,
    "allocationPercent" DECIMAL(9,6) NOT NULL DEFAULT 100,
    "allocationBasis" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaCorporateDataLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaEvidence" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "LcaEvidenceKind" NOT NULL DEFAULT 'EXTERNAL_LINK',
    "externalUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksumSha256" TEXT,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processId" TEXT,
    "inventoryItemId" TEXT,
    "emissionFactorId" TEXT,
    "supplierPcfId" TEXT,
    "assumptionId" TEXT,
    "exclusionId" TEXT,
    "verificationId" TEXT,

    CONSTRAINT "LcaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaEvidenceBlob" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "LcaEvidenceBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaCalculationRun" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runByUserId" TEXT,
    "assessmentUpdatedAt" TIMESTAMP(3),
    "engineVersion" TEXT NOT NULL,
    "methodologyVersion" TEXT,
    "methodologySnapshot" JSONB,
    "factorSnapshot" JSONB,
    "totals" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "LcaCalculationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaCalculationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "processId" TEXT,
    "transportLegId" TEXT,
    "endOfLifeRouteId" TEXT,
    "stage" "LcaLifecycleStage" NOT NULL,
    "processName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemType" "LcaItemType" NOT NULL,
    "classification" "LcaEmissionClassification" NOT NULL DEFAULT 'FOSSIL',
    "supplierName" TEXT,
    "materialName" TEXT,
    "activityValue" DECIMAL(24,10) NOT NULL,
    "activityUnit" TEXT NOT NULL,
    "conversionFactor" DECIMAL(30,15) NOT NULL,
    "normalizedValue" DECIMAL(24,10) NOT NULL,
    "normalizedUnit" TEXT NOT NULL,
    "factorValue" DECIMAL(24,10) NOT NULL,
    "factorUnit" TEXT NOT NULL,
    "factorSource" TEXT NOT NULL,
    "factorVersion" TEXT NOT NULL,
    "factorBoundary" "LcaFactorBoundary" NOT NULL DEFAULT 'UNKNOWN',
    "factorGeography" TEXT,
    "factorYear" INTEGER,
    "factorGwpBasis" TEXT,
    "factorSelectionMode" "LcaFactorSelectionMode" NOT NULL,
    "emissionFactorId" TEXT,
    "isPlaceholderFactor" BOOLEAN NOT NULL DEFAULT false,
    "allocationMethod" "LcaAllocationMethod" NOT NULL DEFAULT 'NONE',
    "allocationFactor" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "adjustmentFactor" DECIMAL(24,10) NOT NULL DEFAULT 1,
    "grossKgCo2e" DECIMAL(24,10) NOT NULL,
    "allocatedKgCo2e" DECIMAL(24,10) NOT NULL,
    "perFunctionalUnitKgCo2e" DECIMAL(24,10) NOT NULL,
    "dataType" "LcaDataType" NOT NULL,
    "dataQualityScore" DECIMAL(6,3),
    "uncertaintyPercent" DECIMAL(9,4),
    "formula" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaCalculationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaAssessmentVersion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "status" "LcaVersionStatus" NOT NULL DEFAULT 'DRAFT_REVISION',
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "engineVersion" TEXT NOT NULL,
    "methodologyVersion" TEXT,
    "calculationRunId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaAssessmentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaVerification" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "organisation" TEXT NOT NULL,
    "verifierName" TEXT NOT NULL,
    "verificationDate" TIMESTAMP(3) NOT NULL,
    "assuranceType" "LcaAssuranceType" NOT NULL,
    "scopeOfVerification" TEXT NOT NULL,
    "statementReference" TEXT,
    "statementUrl" TEXT,
    "conclusion" TEXT,
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaAuditEvent" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,

    CONSTRAINT "LcaAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_entityId_name_key" ON "Supplier"("entityId", "name");

-- CreateIndex
CREATE INDEX "Product_entityId_idx" ON "Product"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_entityId_sku_key" ON "Product"("entityId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVersion_productId_versionLabel_key" ON "ProductVersion"("productId", "versionLabel");

-- CreateIndex
CREATE UNIQUE INDEX "LcaMethodologyProfile_name_version_key" ON "LcaMethodologyProfile"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LcaAssessment_supersededByAssessmentId_key" ON "LcaAssessment"("supersededByAssessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LcaAssessment_lastCalculationRunId_key" ON "LcaAssessment"("lastCalculationRunId");

-- CreateIndex
CREATE INDEX "LcaAssessment_entityId_status_idx" ON "LcaAssessment"("entityId", "status");

-- CreateIndex
CREATE INDEX "LcaAssessment_productVersionId_idx" ON "LcaAssessment"("productVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LcaAssessment_entityId_reference_key" ON "LcaAssessment"("entityId", "reference");

-- CreateIndex
CREATE INDEX "LcaProcess_assessmentId_stage_idx" ON "LcaProcess"("assessmentId", "stage");

-- CreateIndex
CREATE INDEX "LcaInventoryItem_assessmentId_itemType_idx" ON "LcaInventoryItem"("assessmentId", "itemType");

-- CreateIndex
CREATE INDEX "LcaInventoryItem_processId_idx" ON "LcaInventoryItem"("processId");

-- CreateIndex
CREATE INDEX "LcaTransportLeg_inventoryItemId_idx" ON "LcaTransportLeg"("inventoryItemId");

-- CreateIndex
CREATE INDEX "LcaEndOfLifeRoute_inventoryItemId_idx" ON "LcaEndOfLifeRoute"("inventoryItemId");

-- CreateIndex
CREATE INDEX "LcaSupplierPcf_entityId_idx" ON "LcaSupplierPcf"("entityId");

-- CreateIndex
CREATE INDEX "LcaSupplierPcf_supplierId_idx" ON "LcaSupplierPcf"("supplierId");

-- CreateIndex
CREATE INDEX "LcaAssumption_assessmentId_idx" ON "LcaAssumption"("assessmentId");

-- CreateIndex
CREATE INDEX "LcaExclusion_assessmentId_idx" ON "LcaExclusion"("assessmentId");

-- CreateIndex
CREATE INDEX "LcaCorporateDataLink_inventoryItemId_idx" ON "LcaCorporateDataLink"("inventoryItemId");

-- CreateIndex
CREATE INDEX "LcaEvidence_assessmentId_idx" ON "LcaEvidence"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LcaEvidenceBlob_evidenceId_key" ON "LcaEvidenceBlob"("evidenceId");

-- CreateIndex
CREATE INDEX "LcaCalculationRun_assessmentId_runAt_idx" ON "LcaCalculationRun"("assessmentId", "runAt");

-- CreateIndex
CREATE INDEX "LcaCalculationResult_runId_idx" ON "LcaCalculationResult"("runId");

-- CreateIndex
CREATE INDEX "LcaCalculationResult_assessmentId_stage_idx" ON "LcaCalculationResult"("assessmentId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "LcaAssessmentVersion_assessmentId_version_key" ON "LcaAssessmentVersion"("assessmentId", "version");

-- CreateIndex
CREATE INDEX "LcaVerification_assessmentId_idx" ON "LcaVerification"("assessmentId");

-- CreateIndex
CREATE INDEX "LcaAuditEvent_assessmentId_occurredAt_idx" ON "LcaAuditEvent"("assessmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "LcaAuditEvent_entityType_entityId_idx" ON "LcaAuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturingLocation" ADD CONSTRAINT "ProductManufacturingLocation_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturingLocation" ADD CONSTRAINT "ProductManufacturingLocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaMethodologyProfile" ADD CONSTRAINT "LcaMethodologyProfile_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_productVersionId_fkey" FOREIGN KEY ("productVersionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_parentAssessmentId_fkey" FOREIGN KEY ("parentAssessmentId") REFERENCES "LcaAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_supersededByAssessmentId_fkey" FOREIGN KEY ("supersededByAssessmentId") REFERENCES "LcaAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_baselineAssessmentId_fkey" FOREIGN KEY ("baselineAssessmentId") REFERENCES "LcaAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_methodologyProfileId_fkey" FOREIGN KEY ("methodologyProfileId") REFERENCES "LcaMethodologyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaProcess" ADD CONSTRAINT "LcaProcess_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaProcess" ADD CONSTRAINT "LcaProcess_parentProcessId_fkey" FOREIGN KEY ("parentProcessId") REFERENCES "LcaProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaProcessOutput" ADD CONSTRAINT "LcaProcessOutput_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_recycledEmissionFactorId_fkey" FOREIGN KEY ("recycledEmissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaInventoryItem" ADD CONSTRAINT "LcaInventoryItem_supplierPcfId_fkey" FOREIGN KEY ("supplierPcfId") REFERENCES "LcaSupplierPcf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaTransportLeg" ADD CONSTRAINT "LcaTransportLeg_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaTransportLeg" ADD CONSTRAINT "LcaTransportLeg_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEndOfLifeRoute" ADD CONSTRAINT "LcaEndOfLifeRoute_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEndOfLifeRoute" ADD CONSTRAINT "LcaEndOfLifeRoute_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaSupplierPcf" ADD CONSTRAINT "LcaSupplierPcf_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaSupplierPcf" ADD CONSTRAINT "LcaSupplierPcf_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaExclusion" ADD CONSTRAINT "LcaExclusion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaExclusion" ADD CONSTRAINT "LcaExclusion_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaExclusion" ADD CONSTRAINT "LcaExclusion_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaExclusion" ADD CONSTRAINT "LcaExclusion_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCorporateDataLink" ADD CONSTRAINT "LcaCorporateDataLink_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCorporateDataLink" ADD CONSTRAINT "LcaCorporateDataLink_activityEntryId_fkey" FOREIGN KEY ("activityEntryId") REFERENCES "ActivityEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCorporateDataLink" ADD CONSTRAINT "LcaCorporateDataLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_supplierPcfId_fkey" FOREIGN KEY ("supplierPcfId") REFERENCES "LcaSupplierPcf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_assumptionId_fkey" FOREIGN KEY ("assumptionId") REFERENCES "LcaAssumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_exclusionId_fkey" FOREIGN KEY ("exclusionId") REFERENCES "LcaExclusion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "LcaVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidenceBlob" ADD CONSTRAINT "LcaEvidenceBlob_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "LcaEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationRun" ADD CONSTRAINT "LcaCalculationRun_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationRun" ADD CONSTRAINT "LcaCalculationRun_runByUserId_fkey" FOREIGN KEY ("runByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LcaCalculationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "LcaInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_transportLegId_fkey" FOREIGN KEY ("transportLegId") REFERENCES "LcaTransportLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_endOfLifeRouteId_fkey" FOREIGN KEY ("endOfLifeRouteId") REFERENCES "LcaEndOfLifeRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaCalculationResult" ADD CONSTRAINT "LcaCalculationResult_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessmentVersion" ADD CONSTRAINT "LcaAssessmentVersion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssessmentVersion" ADD CONSTRAINT "LcaAssessmentVersion_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaVerification" ADD CONSTRAINT "LcaVerification_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaVerification" ADD CONSTRAINT "LcaVerification_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAuditEvent" ADD CONSTRAINT "LcaAuditEvent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LcaAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAuditEvent" ADD CONSTRAINT "LcaAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
