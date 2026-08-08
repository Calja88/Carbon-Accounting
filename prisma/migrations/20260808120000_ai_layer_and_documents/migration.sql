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

