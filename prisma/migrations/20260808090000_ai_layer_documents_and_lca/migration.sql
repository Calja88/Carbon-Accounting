-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('GENERAL_CHAT', 'CARBON_REASONING', 'EMISSION_CLASSIFICATION', 'DOCUMENT_EXTRACTION', 'DOCUMENT_VISION', 'LCA_ASSISTANT', 'DATA_QUALITY_REVIEW', 'REPORT_ASSISTANT');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('SUCCESS', 'VALIDATION_FAILED', 'PROVIDER_ERROR', 'RATE_LIMITED', 'TIMEOUT', 'DISABLED', 'NO_MODEL_AVAILABLE', 'NOT_CONFIGURED', 'FORBIDDEN');

-- CreateEnum
CREATE TYPE "AiSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AiLoggingLevel" AS ENUM ('MINIMAL', 'STANDARD', 'VERBOSE');

-- CreateEnum
CREATE TYPE "DataOrigin" AS ENUM ('USER_ENTERED', 'IMPORTED', 'AI_EXTRACTED', 'DERIVED');

-- CreateEnum
CREATE TYPE "SourceDocumentKind" AS ENUM ('ELECTRICITY_INVOICE', 'GAS_INVOICE', 'WATER_INVOICE', 'FUEL_INVOICE', 'WASTE_TRANSFER_NOTE', 'WASTE_INVOICE', 'TRANSPORT_RECORD', 'SUPPLIER_DOCUMENT', 'METER_STATEMENT', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'EXTRACTED', 'EXTRACTION_FAILED', 'PARTIALLY_ACCEPTED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LcaProjectStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'UNDER_REVIEW', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LcaBoundaryType" AS ENUM ('CRADLE_TO_GATE', 'CRADLE_TO_GRAVE', 'GATE_TO_GATE', 'CRADLE_TO_CRADLE', 'OTHER');

-- CreateEnum
CREATE TYPE "LcaAllocationMethod" AS ENUM ('NOT_APPLICABLE', 'NONE_SUBDIVISION', 'MASS', 'ECONOMIC', 'ENERGY', 'PHYSICAL_CAUSALITY', 'SYSTEM_EXPANSION', 'OTHER');

-- CreateEnum
CREATE TYPE "LcaStageKey" AS ENUM ('RAW_MATERIALS', 'INBOUND_TRANSPORT', 'MANUFACTURING', 'PACKAGING', 'DISTRIBUTION', 'USE', 'END_OF_LIFE', 'OTHER');

-- CreateEnum
CREATE TYPE "LcaFlowDirection" AS ENUM ('INPUT', 'OUTPUT');

-- CreateEnum
CREATE TYPE "LcaFlowType" AS ENUM ('MATERIAL', 'ENERGY', 'FUEL', 'ELECTRICITY', 'WATER', 'TRANSPORT', 'WASTE', 'EMISSION', 'PRODUCT', 'CO_PRODUCT');

-- CreateEnum
CREATE TYPE "LcaDataType" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "LcaReviewStatus" AS ENUM ('NOT_REVIEWED', 'INTERNAL_REVIEW', 'EXTERNAL_REVIEW', 'PANEL_REVIEW');

-- CreateEnum
CREATE TYPE "LcaFindingSource" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "LcaFindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LcaFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- AlterTable
ALTER TABLE "ActivityEntry" ADD COLUMN     "acceptedFromExtractionId" TEXT,
ADD COLUMN     "dataOrigin" "DataOrigin" NOT NULL DEFAULT 'USER_ENTERED',
ADD COLUMN     "sourceDocumentId" TEXT;

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "openRouterEnabled" BOOLEAN NOT NULL DEFAULT true,
    "freeOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowFreeRouter" BOOLEAN NOT NULL DEFAULT true,
    "autoAcceptExtraction" BOOLEAN NOT NULL DEFAULT false,
    "minConfidence" DECIMAL(4,3) NOT NULL DEFAULT 0.7,
    "loggingLevel" "AiLoggingLevel" NOT NULL DEFAULT 'STANDARD',
    "requestsPerMinute" INTEGER NOT NULL DEFAULT 12,
    "requestsPerDay" INTEGER NOT NULL DEFAULT 300,
    "catalogJson" JSONB,
    "catalogRefreshedAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTaskModel" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "task" "AiTaskType" NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTaskModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL,
    "task" "AiTaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "modelRequested" TEXT NOT NULL,
    "modelUsed" TEXT,
    "status" "AiCallStatus" NOT NULL,
    "usedFallback" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "userId" TEXT,
    "entityId" TEXT,
    "siteId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "sourceDocumentId" TEXT,
    "confidence" DECIMAL(4,3),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costUsd" DECIMAL(14,8),
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "outputSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "task" "AiTaskType" NOT NULL,
    "feature" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "status" "AiSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL(4,3),
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reasoningSummary" TEXT,
    "payload" JSONB NOT NULL,
    "finalPayload" JSONB,
    "modelUsed" TEXT,
    "interactionId" TEXT,
    "raisedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "kind" "SourceDocumentKind" NOT NULL DEFAULT 'UNKNOWN',
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "siteId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExtraction" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "modelUsed" TEXT,
    "status" "AiCallStatus" NOT NULL,
    "payload" JSONB,
    "confidence" DECIMAL(4,3),
    "warnings" TEXT[],
    "missingFields" TEXT[],
    "errorMessage" TEXT,
    "interactionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentExtraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "description" TEXT,
    "status" "LcaProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "entityId" TEXT,
    "siteId" TEXT,
    "methodologyVersion" TEXT NOT NULL DEFAULT 'paragon-lca-v1',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaGoalScope" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "purpose" TEXT,
    "intendedApplication" TEXT,
    "intendedAudience" TEXT,
    "comparativeAssertion" BOOLEAN NOT NULL DEFAULT false,
    "functionalUnitDescription" TEXT,
    "functionalUnitQuantity" DECIMAL(18,6),
    "functionalUnitUnit" TEXT,
    "referenceFlowDescription" TEXT,
    "referenceFlowQuantity" DECIMAL(18,6),
    "referenceFlowUnit" TEXT,
    "systemBoundaryType" "LcaBoundaryType",
    "systemBoundaryNotes" TEXT,
    "geography" TEXT,
    "timePeriodStart" TIMESTAMP(3),
    "timePeriodEnd" TIMESTAMP(3),
    "technologyDescription" TEXT,
    "cutOffCriteria" TEXT,
    "exclusions" TEXT,
    "allocationMethod" "LcaAllocationMethod" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "allocationRationale" TEXT,
    "impactCategories" TEXT[],
    "dataQualityRequirements" TEXT,
    "limitations" TEXT,
    "criticalReviewStatus" "LcaReviewStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
    "criticalReviewNotes" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaGoalScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaStage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" "LcaStageKey" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LcaStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaProcess" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "geography" TEXT,
    "referenceYear" INTEGER,
    "technologyNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LcaProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaFlow" (
    "id" TEXT NOT NULL,
    "processId" TEXT NOT NULL,
    "direction" "LcaFlowDirection" NOT NULL,
    "flowType" "LcaFlowType" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,8) NOT NULL,
    "unit" TEXT NOT NULL,
    "perFunctionalUnit" BOOLEAN NOT NULL DEFAULT true,
    "transportMassTonnes" DECIMAL(18,8),
    "transportDistanceKm" DECIMAL(18,6),
    "emissionFactorId" TEXT,
    "allocationPercent" DECIMAL(6,3) NOT NULL DEFAULT 100,
    "dataSource" TEXT,
    "dataType" "LcaDataType",
    "geography" TEXT,
    "referenceYear" INTEGER,
    "supplierName" TEXT,
    "notes" TEXT,
    "dqReliability" INTEGER,
    "dqCompleteness" INTEGER,
    "dqTemporal" INTEGER,
    "dqGeographical" INTEGER,
    "dqTechnological" INTEGER,
    "dataOrigin" "DataOrigin" NOT NULL DEFAULT 'USER_ENTERED',
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LcaFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaAssumption" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "rationale" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaScenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaScenarioOverride" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "overrideQuantity" DECIMAL(18,8),
    "overrideTransportDistanceKm" DECIMAL(18,6),
    "overrideEmissionFactorId" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "LcaScenarioOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT,
    "totalKgCo2e" DECIMAL(18,8) NOT NULL,
    "functionalUnitLabel" TEXT,
    "payload" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL DEFAULT 'lca-engine-v1',
    "unmappedFlowCount" INTEGER NOT NULL DEFAULT 0,
    "calculatedByUserId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "flowId" TEXT,
    "documentId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcaReviewFinding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "source" "LcaFindingSource" NOT NULL DEFAULT 'HUMAN',
    "severity" "LcaFindingSeverity" NOT NULL DEFAULT 'INFO',
    "status" "LcaFindingStatus" NOT NULL DEFAULT 'OPEN',
    "category" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "suggestion" TEXT,
    "raisedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "LcaReviewFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiTaskModel_settingsId_task_key" ON "AiTaskModel"("settingsId", "task");

-- CreateIndex
CREATE INDEX "AiInteraction_createdAt_idx" ON "AiInteraction"("createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_userId_createdAt_idx" ON "AiInteraction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_task_createdAt_idx" ON "AiInteraction"("task", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_status_createdAt_idx" ON "AiInteraction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AiSuggestion_targetType_targetId_idx" ON "AiSuggestion"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AiSuggestion_status_createdAt_idx" ON "AiSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SourceDocument_siteId_uploadedAt_idx" ON "SourceDocument"("siteId", "uploadedAt");

-- CreateIndex
CREATE INDEX "SourceDocument_sha256_idx" ON "SourceDocument"("sha256");

-- CreateIndex
CREATE INDEX "DocumentExtraction_documentId_createdAt_idx" ON "DocumentExtraction"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "LcaProject_entityId_idx" ON "LcaProject"("entityId");

-- CreateIndex
CREATE INDEX "LcaProject_status_updatedAt_idx" ON "LcaProject"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LcaGoalScope_projectId_key" ON "LcaGoalScope"("projectId");

-- CreateIndex
CREATE INDEX "LcaStage_projectId_sortOrder_idx" ON "LcaStage"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "LcaProcess_stageId_sortOrder_idx" ON "LcaProcess"("stageId", "sortOrder");

-- CreateIndex
CREATE INDEX "LcaFlow_processId_idx" ON "LcaFlow"("processId");

-- CreateIndex
CREATE INDEX "LcaScenario_projectId_idx" ON "LcaScenario"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "LcaScenarioOverride_scenarioId_flowId_key" ON "LcaScenarioOverride"("scenarioId", "flowId");

-- CreateIndex
CREATE INDEX "LcaResult_projectId_calculatedAt_idx" ON "LcaResult"("projectId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LcaEvidence_projectId_flowId_documentId_key" ON "LcaEvidence"("projectId", "flowId", "documentId");

-- CreateIndex
CREATE INDEX "LcaReviewFinding_projectId_status_idx" ON "LcaReviewFinding"("projectId", "status");

-- CreateIndex
CREATE INDEX "ActivityEntry_sourceDocumentId_idx" ON "ActivityEntry"("sourceDocumentId");

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_acceptedFromExtractionId_fkey" FOREIGN KEY ("acceptedFromExtractionId") REFERENCES "DocumentExtraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTaskModel" ADD CONSTRAINT "AiTaskModel_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "AiSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "AiInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtraction" ADD CONSTRAINT "DocumentExtraction_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaProject" ADD CONSTRAINT "LcaProject_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaGoalScope" ADD CONSTRAINT "LcaGoalScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaGoalScope" ADD CONSTRAINT "LcaGoalScope_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaStage" ADD CONSTRAINT "LcaStage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaProcess" ADD CONSTRAINT "LcaProcess_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "LcaStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaFlow" ADD CONSTRAINT "LcaFlow_processId_fkey" FOREIGN KEY ("processId") REFERENCES "LcaProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaFlow" ADD CONSTRAINT "LcaFlow_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaAssumption" ADD CONSTRAINT "LcaAssumption_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaScenario" ADD CONSTRAINT "LcaScenario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaScenario" ADD CONSTRAINT "LcaScenario_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaScenarioOverride" ADD CONSTRAINT "LcaScenarioOverride_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LcaScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaScenarioOverride" ADD CONSTRAINT "LcaScenarioOverride_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "LcaFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaScenarioOverride" ADD CONSTRAINT "LcaScenarioOverride_overrideEmissionFactorId_fkey" FOREIGN KEY ("overrideEmissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaResult" ADD CONSTRAINT "LcaResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaResult" ADD CONSTRAINT "LcaResult_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "LcaScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaResult" ADD CONSTRAINT "LcaResult_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "LcaFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaReviewFinding" ADD CONSTRAINT "LcaReviewFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "LcaProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcaReviewFinding" ADD CONSTRAINT "LcaReviewFinding_raisedByUserId_fkey" FOREIGN KEY ("raisedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

