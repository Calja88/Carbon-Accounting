-- Phase 3-vi: additive schema/contracts only. No data backfill or runtime activation.
-- Canonical UTF-8 LF. Do not rewrite this file after application.

-- CreateEnum
CREATE TYPE "of_application_domain" AS ENUM ('CORPORATE');

-- CreateEnum
CREATE TYPE "of_registry_mode" AS ENUM ('LEGACY', 'MANAGED');

-- CreateEnum
CREATE TYPE "of_set_management" AS ENUM ('LEGACY', 'GUARDED');

-- CreateEnum
CREATE TYPE "of_release_status" AS ENUM ('REGISTERED', 'RECONCILIATION_REQUIRED', 'VERIFIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "of_artifact_format" AS ENUM ('XLSX', 'CSV', 'PDF', 'HTML', 'OTHER');

-- CreateEnum
CREATE TYPE "of_artifact_kind" AS ENUM ('FLAT', 'FULL', 'CONDENSED', 'METHODOLOGY', 'GUIDANCE', 'ERRATA', 'OTHER');

-- CreateEnum
CREATE TYPE "of_artifact_role" AS ENUM ('CLAIMED', 'AUTHORITATIVE', 'COMPANION', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "of_storage_state" AS ENUM ('READY', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "of_numeric_kind" AS ENUM ('FINITE', 'MISSING', 'INVALID', 'FORMULA', 'ERROR');

-- CreateEnum
CREATE TYPE "of_parse_status" AS ENUM ('VALID', 'WARNING', 'REJECTED');

-- CreateEnum
CREATE TYPE "of_gas_measure" AS ENUM ('WHOLE_GAS_CO2E', 'GAS_CONTRIBUTION_CO2E', 'GAS_MASS', 'ENERGY_CONVERSION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "of_corporate_boundary" AS ENUM ('DIRECT', 'WTT', 'TD_LOSSES', 'COMBINED', 'OTHER_REVIEWED', 'UNREVIEWED');

-- CreateEnum
CREATE TYPE "of_cv_basis" AS ENUM ('GROSS', 'NET', 'NOT_APPLICABLE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "of_rf_choice" AS ENUM ('WITH_RF', 'WITHOUT_RF', 'NOT_APPLICABLE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "of_mapping_decision" AS ENUM ('MAPPED', 'UNMAPPED', 'REJECTED');

-- CreateEnum
CREATE TYPE "of_value_transform" AS ENUM ('IDENTITY', 'EXACT_UNIT_SCALE');

-- CreateEnum
CREATE TYPE "of_manifest_purpose" AS ENUM ('PRODUCTION_COMPLETE', 'TEST_ONLY');

-- CreateEnum
CREATE TYPE "of_manifest_artifact_use" AS ENUM ('FACTOR_INPUT', 'PROVENANCE', 'METHODOLOGY', 'ERRATA');

-- CreateEnum
CREATE TYPE "of_disposition_kind" AS ENUM ('SELECTED', 'EXCLUDED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "of_factor_origin" AS ENUM ('NEW_OFFICIAL', 'CARRY_FORWARD');

-- CreateEnum
CREATE TYPE "of_approval_purpose" AS ENUM ('MANIFEST_REVIEW', 'PUBLISH', 'ACTIVATE');

-- CreateEnum
CREATE TYPE "of_factor_capability" AS ENUM ('VIEW', 'VERIFY_SOURCE', 'MAP', 'REVIEW', 'PUBLISH', 'ACTIVATE', 'MANAGE_GRANTS');

-- CreateEnum
CREATE TYPE "of_actor_kind" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "of_factor_event_type" AS ENUM ('RELEASE_REGISTERED', 'SOURCE_CLAIMED', 'SOURCE_RECONCILED', 'SOURCE_VERIFIED', 'SOURCE_WITHDRAWN', 'ARTIFACT_QUARANTINED', 'PARSE_SEALED', 'MAPPING_CREATED', 'MANIFEST_SEALED', 'APPROVAL_GRANTED', 'APPROVAL_REVOKED', 'PUBLICATION_SUCCEEDED', 'PUBLICATION_FAILED', 'PLAN_SEALED', 'ACTIVATION_SUCCEEDED', 'ACTIVATION_FAILED', 'GRANT_CREATED', 'GRANT_REVOKED');

-- CreateEnum
CREATE TYPE "of_coverage_level" AS ENUM ('MANDATORY', 'OPTIONAL');

-- AlterTable
ALTER TABLE "EmissionFactorSet" ADD COLUMN     "officialManagement" "of_set_management";

-- AlterTable
ALTER TABLE "EmissionFactor" ADD COLUMN     "officialManifestFactorId" TEXT,
ADD COLUMN     "publishedLookupKey" TEXT;

-- CreateTable
CREATE TABLE "of_registry" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "publisherCode" TEXT NOT NULL,
    "datasetFamily" TEXT NOT NULL,
    "applicationDomain" "of_application_domain" NOT NULL,
    "geographyProfile" TEXT NOT NULL,
    "mode" "of_registry_mode" NOT NULL DEFAULT 'LEGACY',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "currentPlanId" TEXT,
    "nextEventSequence" BIGINT NOT NULL DEFAULT 1,
    "lastEventHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_registry_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_release" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "reportingYear" INTEGER NOT NULL,
    "revisionKey" TEXT NOT NULL,
    "officialVersion" TEXT,
    "publisherName" TEXT NOT NULL,
    "publicationDate" DATE,
    "publisherUpdateDate" DATE,
    "workbookUpdateDate" DATE,
    "sourceUrl" TEXT NOT NULL,
    "methodologyUrl" TEXT,
    "declaredEffectiveFrom" DATE,
    "declaredEffectiveTo" DATE,
    "revisionEvidence" TEXT NOT NULL,
    "status" "of_release_status" NOT NULL DEFAULT 'REGISTERED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_release_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_artifact" (
    "id" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "firstFileName" TEXT NOT NULL,
    "fileFormat" "of_artifact_format" NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageVersion" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "firstRetrievedAt" TIMESTAMPTZ(3) NOT NULL,
    "firstSourceUrl" TEXT NOT NULL,
    "storageState" "of_storage_state" NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_artifact_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_release_artifact" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "artifactKind" "of_artifact_kind" NOT NULL,
    "variantKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "role" "of_artifact_role" NOT NULL DEFAULT 'CLAIMED',
    "roleRationale" TEXT,
    "claimedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_release_artifact_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_verification" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "inventoryHash" CHAR(64) NOT NULL,
    "verificationHash" CHAR(64) NOT NULL,
    "verificationPolicyVersion" TEXT NOT NULL,
    "verifiedByUserId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "of_verification_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_parse" (
    "id" TEXT NOT NULL,
    "releaseArtifactId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "sourceProfileVersion" TEXT NOT NULL,
    "identityVersion" TEXT NOT NULL,
    "validationVersion" TEXT NOT NULL,
    "parseKey" CHAR(64) NOT NULL,
    "parseHash" CHAR(64) NOT NULL,
    "scannedCount" INTEGER NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "sheetSummary" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "of_parse_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_identity" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "identityVersion" TEXT NOT NULL,
    "sourceIdentityHash" CHAR(64) NOT NULL,
    "canonicalIdentity" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_identity_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_source_factor" (
    "id" TEXT NOT NULL,
    "parseId" TEXT NOT NULL,
    "identityId" TEXT,
    "sheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "sourceColumnKey" TEXT NOT NULL,
    "officialSourceId" TEXT,
    "rawScope" TEXT,
    "level1" TEXT,
    "level2" TEXT,
    "level3" TEXT,
    "level4" TEXT,
    "columnText" TEXT,
    "rawFactorText" TEXT,
    "rawNumericToken" TEXT,
    "numericKind" "of_numeric_kind" NOT NULL,
    "exactCoefficient" TEXT,
    "exactExponent" INTEGER,
    "rawUnit" TEXT,
    "canonicalSourceUnit" TEXT,
    "rawGas" TEXT,
    "gasMeasure" "of_gas_measure" NOT NULL,
    "gasSpecies" TEXT,
    "rawBoundary" TEXT,
    "boundaryClass" "of_corporate_boundary" NOT NULL,
    "rawGeography" TEXT,
    "sourceGeography" TEXT,
    "geographyEvidence" TEXT,
    "cvBasis" "of_cv_basis" NOT NULL,
    "rfChoice" "of_rf_choice" NOT NULL,
    "loadDescription" TEXT,
    "occupancyDescription" TEXT,
    "vehicleClass" TEXT,
    "sourceQualifiers" JSONB NOT NULL,
    "rawCells" JSONB NOT NULL,
    "parseStatus" "of_parse_status" NOT NULL,
    "validationCodes" JSONB NOT NULL,
    "observationHash" CHAR(64) NOT NULL,
    "semanticValueHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "of_source_factor_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_mapping" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "sourceFactorId" TEXT NOT NULL,
    "targetSlot" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "supersedesMappingId" TEXT,
    "decision" "of_mapping_decision" NOT NULL,
    "targetCategory" TEXT,
    "targetSubtype" TEXT,
    "targetSubtypeIdentity" TEXT,
    "targetUnit" TEXT,
    "factorBasis" "FactorBasis",
    "reportingScope" "Scope",
    "scope3Category" TEXT,
    "emissionsBoundary" "of_corporate_boundary" NOT NULL,
    "gasMeasure" "of_gas_measure" NOT NULL,
    "applicabilityGeography" TEXT,
    "geographyRationale" TEXT,
    "cvBasis" "of_cv_basis" NOT NULL,
    "qualifierPolicy" TEXT,
    "transform" "of_value_transform" NOT NULL,
    "interpretedCoefficient" TEXT,
    "interpretedExponent" INTEGER,
    "mappingRuleVersion" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "mappedByUserId" TEXT NOT NULL,
    "mappedAt" TIMESTAMPTZ(3) NOT NULL,
    "mappingHash" CHAR(64) NOT NULL,

    CONSTRAINT "of_mapping_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_coverage" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "predecessorId" TEXT,
    "profileName" TEXT NOT NULL,
    "purpose" "of_manifest_purpose" NOT NULL,
    "productContractVersion" TEXT NOT NULL,
    "coverageHash" CHAR(64) NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "of_coverage_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_requirement" (
    "id" TEXT NOT NULL,
    "coverageContractId" TEXT NOT NULL,
    "lookupKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subtype" TEXT,
    "subtypeIdentity" TEXT NOT NULL,
    "basis" "FactorBasis" NOT NULL,
    "unit" TEXT NOT NULL,
    "scope" "Scope" NOT NULL,
    "scope3Category" TEXT,
    "boundary" "of_corporate_boundary" NOT NULL,
    "gasMeasure" "of_gas_measure" NOT NULL,
    "geography" TEXT NOT NULL,
    "cvBasis" "of_cv_basis" NOT NULL,
    "companionOfId" TEXT,
    "rationale" TEXT NOT NULL,
    "carryForwardAllowed" BOOLEAN NOT NULL DEFAULT false,
    "level" "of_coverage_level" NOT NULL DEFAULT 'MANDATORY',

    CONSTRAINT "of_requirement_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_manifest" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "primaryReleaseId" TEXT NOT NULL,
    "coverageContractId" TEXT NOT NULL,
    "baselinePlanId" TEXT,
    "baselineGeneration" INTEGER NOT NULL,
    "purpose" "of_manifest_purpose" NOT NULL,
    "proposedName" TEXT NOT NULL,
    "applicableFrom" TIMESTAMPTZ(3) NOT NULL,
    "applicableUntil" TIMESTAMPTZ(3),
    "manifestHash" CHAR(64) NOT NULL,
    "manifestFormatVersion" TEXT NOT NULL,
    "validationVersion" TEXT NOT NULL,
    "mappingRuleVersion" TEXT NOT NULL,
    "numericPolicyVersion" TEXT NOT NULL,
    "approvalPolicyVersion" TEXT NOT NULL,
    "sourceCounts" JSONB NOT NULL,
    "coverageMetrics" JSONB NOT NULL,
    "warningSummary" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "of_manifest_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_manifest_artifact" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "releaseArtifactId" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "parseId" TEXT,
    "use" "of_manifest_artifact_use" NOT NULL,
    "boundArtifactHash" CHAR(64) NOT NULL,
    "boundInventoryHash" CHAR(64) NOT NULL,
    "boundParseHash" CHAR(64),

    CONSTRAINT "of_manifest_artifact_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_disposition" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "sourceFactorId" TEXT NOT NULL,
    "decision" "of_disposition_kind" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "acknowledgedWarningCodes" JSONB NOT NULL,

    CONSTRAINT "of_disposition_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_manifest_factor" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "coverageRequirementId" TEXT NOT NULL,
    "origin" "of_factor_origin" NOT NULL,
    "mappingId" TEXT,
    "dispositionId" TEXT,
    "predecessorFactorId" TEXT,
    "rootSourceFactorId" TEXT,
    "sourceReleaseId" TEXT,
    "originalSourceName" TEXT NOT NULL,
    "originalPublisher" TEXT NOT NULL,
    "originalVintageYear" INTEGER NOT NULL,
    "originalSourceUrl" TEXT,
    "lookupKey" TEXT NOT NULL,
    "targetCategory" TEXT NOT NULL,
    "targetSubtype" TEXT,
    "targetSubtypeIdentity" TEXT NOT NULL,
    "factorBasis" "FactorBasis" NOT NULL,
    "reportingScope" "Scope" NOT NULL,
    "scope3Category" TEXT,
    "targetUnit" TEXT NOT NULL,
    "geography" TEXT NOT NULL,
    "emissionsBoundary" "of_corporate_boundary" NOT NULL,
    "gasMeasure" "of_gas_measure" NOT NULL,
    "cvBasis" "of_cv_basis" NOT NULL,
    "exactCoefficient" TEXT NOT NULL,
    "exactExponent" INTEGER NOT NULL,
    "candidateValue" DECIMAL(18,8) NOT NULL,
    "carryForwardRationale" TEXT,
    "carryValidFrom" TIMESTAMPTZ(3),
    "carryValidUntil" TIMESTAMPTZ(3),
    "itemHash" CHAR(64) NOT NULL,

    CONSTRAINT "of_manifest_factor_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_grant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capability" "of_factor_capability" NOT NULL,
    "grantedByUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" TEXT,
    "reason" TEXT NOT NULL,

    CONSTRAINT "of_grant_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_approval" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT,
    "activationPlanId" TEXT,
    "purpose" "of_approval_purpose" NOT NULL,
    "subjectHash" CHAR(64) NOT NULL,
    "approvalPolicyVersion" TEXT NOT NULL,
    "contributorsHash" CHAR(64) NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rationale" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "of_approval_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_publication" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "factorSetId" TEXT NOT NULL,
    "reviewApprovalId" TEXT NOT NULL,
    "publishApprovalId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "publishedByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "projectionHash" CHAR(64) NOT NULL,
    "publicationContractVersion" TEXT NOT NULL,

    CONSTRAINT "of_publication_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_plan" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "expectedPreviousPlanId" TEXT,
    "expectedGeneration" INTEGER NOT NULL,
    "planHash" CHAR(64) NOT NULL,
    "activationPolicyVersion" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "sealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "of_plan_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_window" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "factorSetId" TEXT NOT NULL,
    "fromInclusive" TIMESTAMPTZ(3) NOT NULL,
    "untilExclusive" TIMESTAMPTZ(3),
    "coverageManifestId" TEXT,
    "legacyCoverageContractId" TEXT,
    "legacyAssessmentHash" CHAR(64),
    "legacyAssessment" JSONB,
    "rationale" TEXT NOT NULL,

    CONSTRAINT "of_window_pk" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "of_event" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "eventType" "of_factor_event_type" NOT NULL,
    "actorUserId" TEXT,
    "actorKind" "of_actor_kind" NOT NULL,
    "releaseId" TEXT,
    "artifactId" TEXT,
    "mappingId" TEXT,
    "manifestId" TEXT,
    "publicationId" TEXT,
    "activationPlanId" TEXT,
    "activationGeneration" INTEGER,
    "grantId" TEXT,
    "approvalId" TEXT,
    "correlationId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "previousEventHash" CHAR(64),
    "contentHash" CHAR(64) NOT NULL,

    CONSTRAINT "of_event_pk" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "of_registry_current_plan_ix" ON "of_registry"("currentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "of_registry_namespace_uq" ON "of_registry"("namespace");

-- CreateIndex
CREATE INDEX "of_release_created_by_user_ix" ON "of_release"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_release_key_uq" ON "of_release"("registryId", "reportingYear", "revisionKey");

-- CreateIndex
CREATE INDEX "of_artifact_created_by_user_ix" ON "of_artifact"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_artifact_sha_uq" ON "of_artifact"("sha256");

-- CreateIndex
CREATE INDEX "of_release_artifact_artifact_ix" ON "of_release_artifact"("artifactId");

-- CreateIndex
CREATE INDEX "of_release_artifact_claimed_by_user_ix" ON "of_release_artifact"("claimedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_ra_claim_uq" ON "of_release_artifact"("releaseId", "artifactId", "artifactKind", "variantKey");

-- CreateIndex
CREATE INDEX "of_verification_release_ix" ON "of_verification"("releaseId");

-- CreateIndex
CREATE INDEX "of_verification_verified_by_user_ix" ON "of_verification"("verifiedByUserId");

-- CreateIndex
CREATE INDEX "of_verification_revoked_by_user_ix" ON "of_verification"("revokedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_verification_hash_uq" ON "of_verification"("verificationHash");

-- CreateIndex
CREATE INDEX "of_parse_release_artifact_ix" ON "of_parse"("releaseArtifactId");

-- CreateIndex
CREATE INDEX "of_parse_created_by_user_ix" ON "of_parse"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_parse_key_uq" ON "of_parse"("parseKey");

-- CreateIndex
CREATE UNIQUE INDEX "of_identity_key_uq" ON "of_identity"("releaseId", "identityVersion", "sourceIdentityHash");

-- CreateIndex
CREATE INDEX "of_source_factor_identity_ix" ON "of_source_factor"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "of_source_position_uq" ON "of_source_factor"("parseId", "sheet", "sourceRow", "sourceColumnKey");

-- CreateIndex
CREATE UNIQUE INDEX "of_source_id_identity_uq" ON "of_source_factor"("id", "identityId");

-- CreateIndex
CREATE INDEX "of_mapping_source_factor_ix" ON "of_mapping"("sourceFactorId");

-- CreateIndex
CREATE INDEX "of_mapping_mapped_by_user_ix" ON "of_mapping"("mappedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_mapping_revision_uq" ON "of_mapping"("identityId", "targetSlot", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "of_mapping_successor_uq" ON "of_mapping"("supersedesMappingId");

-- CreateIndex
CREATE INDEX "of_coverage_predecessor_ix" ON "of_coverage"("predecessorId");

-- CreateIndex
CREATE INDEX "of_coverage_created_by_user_ix" ON "of_coverage"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_coverage_revision_uq" ON "of_coverage"("registryId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "of_coverage_hash_uq" ON "of_coverage"("coverageHash");

-- CreateIndex
CREATE INDEX "of_requirement_companion_of_ix" ON "of_requirement"("companionOfId");

-- CreateIndex
CREATE UNIQUE INDEX "of_requirement_key_uq" ON "of_requirement"("coverageContractId", "lookupKey");

-- CreateIndex
CREATE INDEX "of_manifest_registry_ix" ON "of_manifest"("registryId");

-- CreateIndex
CREATE INDEX "of_manifest_primary_release_ix" ON "of_manifest"("primaryReleaseId");

-- CreateIndex
CREATE INDEX "of_manifest_coverage_contract_ix" ON "of_manifest"("coverageContractId");

-- CreateIndex
CREATE INDEX "of_manifest_baseline_plan_ix" ON "of_manifest"("baselinePlanId");

-- CreateIndex
CREATE INDEX "of_manifest_created_by_user_ix" ON "of_manifest"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_manifest_hash_uq" ON "of_manifest"("manifestHash");

-- CreateIndex
CREATE INDEX "of_manifest_artifact_release_artifact_ix" ON "of_manifest_artifact"("releaseArtifactId");

-- CreateIndex
CREATE INDEX "of_manifest_artifact_verification_ix" ON "of_manifest_artifact"("verificationId");

-- CreateIndex
CREATE INDEX "of_manifest_artifact_parse_ix" ON "of_manifest_artifact"("parseId");

-- CreateIndex
CREATE UNIQUE INDEX "of_ma_input_uq" ON "of_manifest_artifact"("manifestId", "releaseArtifactId", "use");

-- CreateIndex
CREATE INDEX "of_disposition_source_factor_ix" ON "of_disposition"("sourceFactorId");

-- CreateIndex
CREATE UNIQUE INDEX "of_disposition_source_uq" ON "of_disposition"("manifestId", "sourceFactorId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_coverage_requirement_ix" ON "of_manifest_factor"("coverageRequirementId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_mapping_ix" ON "of_manifest_factor"("mappingId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_disposition_ix" ON "of_manifest_factor"("dispositionId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_predecessor_factor_ix" ON "of_manifest_factor"("predecessorFactorId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_root_source_factor_ix" ON "of_manifest_factor"("rootSourceFactorId");

-- CreateIndex
CREATE INDEX "of_manifest_factor_source_release_ix" ON "of_manifest_factor"("sourceReleaseId");

-- CreateIndex
CREATE UNIQUE INDEX "of_mf_lookup_uq" ON "of_manifest_factor"("manifestId", "lookupKey");

-- CreateIndex
CREATE UNIQUE INDEX "of_mf_requirement_uq" ON "of_manifest_factor"("manifestId", "coverageRequirementId");

-- CreateIndex
CREATE INDEX "of_grant_user_ix" ON "of_grant"("userId");

-- CreateIndex
CREATE INDEX "of_grant_granted_by_user_ix" ON "of_grant"("grantedByUserId");

-- CreateIndex
CREATE INDEX "of_grant_revoked_by_user_ix" ON "of_grant"("revokedByUserId");

-- CreateIndex
CREATE INDEX "of_approval_approver_user_ix" ON "of_approval"("approverUserId");

-- CreateIndex
CREATE INDEX "of_approval_revoked_by_user_ix" ON "of_approval"("revokedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_approval_manifest_uq" ON "of_approval"("manifestId", "purpose", "approverUserId", "subjectHash", "approvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "of_approval_plan_uq" ON "of_approval"("activationPlanId", "purpose", "approverUserId", "subjectHash", "approvedAt");

-- CreateIndex
CREATE INDEX "of_publication_review_approval_ix" ON "of_publication"("reviewApprovalId");

-- CreateIndex
CREATE INDEX "of_publication_publish_approval_ix" ON "of_publication"("publishApprovalId");

-- CreateIndex
CREATE INDEX "of_publication_published_by_user_ix" ON "of_publication"("publishedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_publication_manifest_uq" ON "of_publication"("manifestId");

-- CreateIndex
CREATE UNIQUE INDEX "of_publication_set_uq" ON "of_publication"("factorSetId");

-- CreateIndex
CREATE UNIQUE INDEX "of_publication_retry_uq" ON "of_publication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "of_plan_registry_ix" ON "of_plan"("registryId");

-- CreateIndex
CREATE INDEX "of_plan_expected_previous_plan_ix" ON "of_plan"("expectedPreviousPlanId");

-- CreateIndex
CREATE INDEX "of_plan_created_by_user_ix" ON "of_plan"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "of_plan_hash_uq" ON "of_plan"("planHash");

-- CreateIndex
CREATE INDEX "of_window_factor_set_ix" ON "of_window"("factorSetId");

-- CreateIndex
CREATE INDEX "of_window_coverage_manifest_ix" ON "of_window"("coverageManifestId");

-- CreateIndex
CREATE INDEX "of_window_legacy_coverage_contract_ix" ON "of_window"("legacyCoverageContractId");

-- CreateIndex
CREATE UNIQUE INDEX "of_window_start_uq" ON "of_window"("planId", "fromInclusive");

-- CreateIndex
CREATE INDEX "of_event_actor_user_ix" ON "of_event"("actorUserId");

-- CreateIndex
CREATE INDEX "of_event_release_ix" ON "of_event"("releaseId");

-- CreateIndex
CREATE INDEX "of_event_artifact_ix" ON "of_event"("artifactId");

-- CreateIndex
CREATE INDEX "of_event_mapping_ix" ON "of_event"("mappingId");

-- CreateIndex
CREATE INDEX "of_event_manifest_ix" ON "of_event"("manifestId");

-- CreateIndex
CREATE INDEX "of_event_publication_ix" ON "of_event"("publicationId");

-- CreateIndex
CREATE INDEX "of_event_activation_plan_ix" ON "of_event"("activationPlanId");

-- CreateIndex
CREATE INDEX "of_event_grant_ix" ON "of_event"("grantId");

-- CreateIndex
CREATE INDEX "of_event_approval_ix" ON "of_event"("approvalId");

-- CreateIndex
CREATE UNIQUE INDEX "of_event_sequence_uq" ON "of_event"("registryId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "of_event_hash_uq" ON "of_event"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "of_factor_item_uq" ON "EmissionFactor"("officialManifestFactorId");

-- CreateIndex
CREATE UNIQUE INDEX "of_factor_lookup_uq" ON "EmissionFactor"("factorSetId", "publishedLookupKey");

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "of_factor_manifest_item_fk" FOREIGN KEY ("officialManifestFactorId") REFERENCES "of_manifest_factor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_registry" ADD CONSTRAINT "of_registry_current_plan_fk" FOREIGN KEY ("currentPlanId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_release" ADD CONSTRAINT "of_release_registry_fk" FOREIGN KEY ("registryId") REFERENCES "of_registry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_release" ADD CONSTRAINT "of_release_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_artifact" ADD CONSTRAINT "of_artifact_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_release_artifact" ADD CONSTRAINT "of_release_artifact_release_fk" FOREIGN KEY ("releaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_release_artifact" ADD CONSTRAINT "of_release_artifact_artifact_fk" FOREIGN KEY ("artifactId") REFERENCES "of_artifact"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_release_artifact" ADD CONSTRAINT "of_release_artifact_claimed_by_user_fk" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_verification" ADD CONSTRAINT "of_verification_release_fk" FOREIGN KEY ("releaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_verification" ADD CONSTRAINT "of_verification_verified_by_user_fk" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_verification" ADD CONSTRAINT "of_verification_revoked_by_user_fk" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_parse" ADD CONSTRAINT "of_parse_release_artifact_fk" FOREIGN KEY ("releaseArtifactId") REFERENCES "of_release_artifact"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_parse" ADD CONSTRAINT "of_parse_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_identity" ADD CONSTRAINT "of_identity_release_fk" FOREIGN KEY ("releaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_source_factor" ADD CONSTRAINT "of_source_factor_parse_fk" FOREIGN KEY ("parseId") REFERENCES "of_parse"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_source_factor" ADD CONSTRAINT "of_source_factor_identity_fk" FOREIGN KEY ("identityId") REFERENCES "of_identity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_mapping" ADD CONSTRAINT "of_mapping_identity_fk" FOREIGN KEY ("identityId") REFERENCES "of_identity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_mapping" ADD CONSTRAINT "of_mapping_source_identity_fk" FOREIGN KEY ("sourceFactorId", "identityId") REFERENCES "of_source_factor"("id", "identityId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_mapping" ADD CONSTRAINT "of_mapping_supersedes_mapping_fk" FOREIGN KEY ("supersedesMappingId") REFERENCES "of_mapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_mapping" ADD CONSTRAINT "of_mapping_mapped_by_user_fk" FOREIGN KEY ("mappedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_coverage" ADD CONSTRAINT "of_coverage_registry_fk" FOREIGN KEY ("registryId") REFERENCES "of_registry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_coverage" ADD CONSTRAINT "of_coverage_predecessor_fk" FOREIGN KEY ("predecessorId") REFERENCES "of_coverage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_coverage" ADD CONSTRAINT "of_coverage_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_requirement" ADD CONSTRAINT "of_requirement_coverage_contract_fk" FOREIGN KEY ("coverageContractId") REFERENCES "of_coverage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_requirement" ADD CONSTRAINT "of_requirement_companion_of_fk" FOREIGN KEY ("companionOfId") REFERENCES "of_requirement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest" ADD CONSTRAINT "of_manifest_registry_fk" FOREIGN KEY ("registryId") REFERENCES "of_registry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest" ADD CONSTRAINT "of_manifest_primary_release_fk" FOREIGN KEY ("primaryReleaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest" ADD CONSTRAINT "of_manifest_coverage_contract_fk" FOREIGN KEY ("coverageContractId") REFERENCES "of_coverage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest" ADD CONSTRAINT "of_manifest_baseline_plan_fk" FOREIGN KEY ("baselinePlanId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest" ADD CONSTRAINT "of_manifest_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_artifact" ADD CONSTRAINT "of_manifest_artifact_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_artifact" ADD CONSTRAINT "of_manifest_artifact_release_artifact_fk" FOREIGN KEY ("releaseArtifactId") REFERENCES "of_release_artifact"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_artifact" ADD CONSTRAINT "of_manifest_artifact_verification_fk" FOREIGN KEY ("verificationId") REFERENCES "of_verification"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_artifact" ADD CONSTRAINT "of_manifest_artifact_parse_fk" FOREIGN KEY ("parseId") REFERENCES "of_parse"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_disposition" ADD CONSTRAINT "of_disposition_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_disposition" ADD CONSTRAINT "of_disposition_source_factor_fk" FOREIGN KEY ("sourceFactorId") REFERENCES "of_source_factor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_coverage_requirement_fk" FOREIGN KEY ("coverageRequirementId") REFERENCES "of_requirement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_mapping_fk" FOREIGN KEY ("mappingId") REFERENCES "of_mapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_disposition_fk" FOREIGN KEY ("dispositionId") REFERENCES "of_disposition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_predecessor_factor_fk" FOREIGN KEY ("predecessorFactorId") REFERENCES "EmissionFactor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_root_source_factor_fk" FOREIGN KEY ("rootSourceFactorId") REFERENCES "of_source_factor"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_manifest_factor" ADD CONSTRAINT "of_manifest_factor_source_release_fk" FOREIGN KEY ("sourceReleaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_grant" ADD CONSTRAINT "of_grant_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_grant" ADD CONSTRAINT "of_grant_granted_by_user_fk" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_grant" ADD CONSTRAINT "of_grant_revoked_by_user_fk" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_approval" ADD CONSTRAINT "of_approval_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_approval" ADD CONSTRAINT "of_approval_activation_plan_fk" FOREIGN KEY ("activationPlanId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_approval" ADD CONSTRAINT "of_approval_approver_user_fk" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_approval" ADD CONSTRAINT "of_approval_revoked_by_user_fk" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_publication" ADD CONSTRAINT "of_publication_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_publication" ADD CONSTRAINT "of_publication_factor_set_fk" FOREIGN KEY ("factorSetId") REFERENCES "EmissionFactorSet"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_publication" ADD CONSTRAINT "of_publication_review_approval_fk" FOREIGN KEY ("reviewApprovalId") REFERENCES "of_approval"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_publication" ADD CONSTRAINT "of_publication_publish_approval_fk" FOREIGN KEY ("publishApprovalId") REFERENCES "of_approval"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_publication" ADD CONSTRAINT "of_publication_published_by_user_fk" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_plan" ADD CONSTRAINT "of_plan_registry_fk" FOREIGN KEY ("registryId") REFERENCES "of_registry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_plan" ADD CONSTRAINT "of_plan_expected_previous_plan_fk" FOREIGN KEY ("expectedPreviousPlanId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_plan" ADD CONSTRAINT "of_plan_created_by_user_fk" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_window" ADD CONSTRAINT "of_window_plan_fk" FOREIGN KEY ("planId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_window" ADD CONSTRAINT "of_window_factor_set_fk" FOREIGN KEY ("factorSetId") REFERENCES "EmissionFactorSet"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_window" ADD CONSTRAINT "of_window_coverage_manifest_fk" FOREIGN KEY ("coverageManifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_window" ADD CONSTRAINT "of_window_legacy_coverage_contract_fk" FOREIGN KEY ("legacyCoverageContractId") REFERENCES "of_coverage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_registry_fk" FOREIGN KEY ("registryId") REFERENCES "of_registry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_actor_user_fk" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_release_fk" FOREIGN KEY ("releaseId") REFERENCES "of_release"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_artifact_fk" FOREIGN KEY ("artifactId") REFERENCES "of_artifact"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_mapping_fk" FOREIGN KEY ("mappingId") REFERENCES "of_mapping"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_manifest_fk" FOREIGN KEY ("manifestId") REFERENCES "of_manifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_publication_fk" FOREIGN KEY ("publicationId") REFERENCES "of_publication"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_activation_plan_fk" FOREIGN KEY ("activationPlanId") REFERENCES "of_plan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_grant_fk" FOREIGN KEY ("grantId") REFERENCES "of_grant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "of_event" ADD CONSTRAINT "of_event_approval_fk" FOREIGN KEY ("approvalId") REFERENCES "of_approval"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;



-- Source precision and null-safe runtime identity. No floating-point operations.
CREATE FUNCTION of_exact_valid(c TEXT, e INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(c ~ '^(0|-?[1-9][0-9]*)$' AND length(replace(c, '-', '')) <= 1000
    AND e BETWEEN -1000 AND 1000 AND CASE WHEN c = '0' THEN e = 0 ELSE right(c, 1) <> '0' END, false)
$$;
CREATE FUNCTION of_exact_decimal(c TEXT, e INTEGER) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
  IF NOT of_exact_valid(c,e) THEN RAISE EXCEPTION 'Invalid exact source number' USING ERRCODE='23514'; END IF;
  RETURN (c || 'e' || e::text)::numeric;
END $$;
CREATE FUNCTION of_subtype_key(s TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN s IS NULL THEN '["null"]' ELSE '["string",' || to_json(normalize(replace(replace(s, E'\r\n', E'\n'), E'\r', E'\n'), NFC))::text || ']' END
$$;
CREATE FUNCTION of_lookup_key(c TEXT, s TEXT, b TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT '[' || to_json(normalize(replace(replace(c, E'\r\n', E'\n'), E'\r', E'\n'), NFC))::text || ',' || of_subtype_key(s) || ',' || to_json(b)::text || ']'
$$;

-- Partial uniqueness avoids PostgreSQL's distinct-NULL loophole.
CREATE UNIQUE INDEX of_ra_authority_uq ON of_release_artifact ("releaseId", "artifactKind", "variantKey") WHERE role = 'AUTHORITATIVE';
CREATE UNIQUE INDEX of_grant_live_uq ON of_grant ("userId", capability) WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX of_event_activation_uq ON of_event ("registryId", "activationGeneration") WHERE "eventType" = 'ACTIVATION_SUCCEEDED';
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE of_window ADD CONSTRAINT of_window_no_overlap_excl EXCLUDE USING gist
  ("planId" WITH =, tstzrange("fromInclusive", "untilExclusive", '[)') WITH &&);

ALTER TABLE of_registry ADD CONSTRAINT of_registry_counts_ck CHECK (generation >= 0 AND "nextEventSequence" > 0);
ALTER TABLE of_release ADD CONSTRAINT of_release_year_ck CHECK ("reportingYear" BETWEEN 1900 AND 9999 AND btrim("revisionKey") <> '');
ALTER TABLE of_artifact ADD CONSTRAINT of_artifact_size_ck CHECK ("byteSize" > 0 AND btrim("storageVersion") <> '');
ALTER TABLE of_source_factor ADD CONSTRAINT of_num_pair_ck CHECK (
  CASE WHEN "numericKind" = 'FINITE' THEN of_exact_valid("exactCoefficient", "exactExponent")
  ELSE "exactCoefficient" IS NULL AND "exactExponent" IS NULL END);
ALTER TABLE of_source_factor ADD CONSTRAINT of_source_position_ck CHECK ("sourceRow" > 0 AND btrim(sheet) <> '' AND btrim("sourceColumnKey") <> '');
ALTER TABLE of_mapping ADD CONSTRAINT of_mapping_revision_ck CHECK (revision > 0 AND
  ((revision = 1 AND "supersedesMappingId" IS NULL) OR (revision > 1 AND "supersedesMappingId" IS NOT NULL AND "supersedesMappingId" <> id)));
ALTER TABLE of_mapping ADD CONSTRAINT of_mapping_shape_ck CHECK (btrim(rationale) <> '' AND transform = 'IDENTITY' AND
 CASE WHEN decision = 'MAPPED' THEN
   "targetCategory" IS NOT NULL AND btrim("targetCategory") <> '' AND "targetUnit" IS NOT NULL AND btrim("targetUnit") <> ''
   AND "factorBasis" IS NOT NULL AND "reportingScope" IS NOT NULL AND "targetSubtypeIdentity" IS NOT NULL
   AND "targetSubtypeIdentity" = of_subtype_key("targetSubtype")
   AND ("targetSubtype" IS NULL OR btrim("targetSubtype") <> '')
   AND "targetSlot" = of_lookup_key("targetCategory", "targetSubtype", "factorBasis"::text)
   AND octet_length("targetSlot") <= 1024
   AND "applicabilityGeography" IS NOT NULL AND "applicabilityGeography" = 'GB'
   AND "geographyRationale" IS NOT NULL AND btrim("geographyRationale") <> ''
   AND "qualifierPolicy" IS NOT NULL AND btrim("qualifierPolicy") <> ''
   AND "gasMeasure" = 'WHOLE_GAS_CO2E' AND "emissionsBoundary" IN ('DIRECT','WTT','TD_LOSSES') AND "cvBasis" <> 'UNSPECIFIED'
   AND (("reportingScope"='SCOPE_2') = ("factorBasis"<>'STANDARD'))
   AND (("reportingScope"='SCOPE_3') = ("scope3Category" IS NOT NULL))
   AND CASE WHEN "emissionsBoundary"='WTT' THEN left("targetCategory",4)='wtt_' AND "reportingScope"='SCOPE_3'
     WHEN "emissionsBoundary"='TD_LOSSES' THEN left("targetCategory",10)='td_losses_' AND "reportingScope"='SCOPE_3'
     ELSE left("targetCategory",4)<>'wtt_' AND left("targetCategory",10)<>'td_losses_' END
   AND of_exact_valid("interpretedCoefficient", "interpretedExponent")
 ELSE "targetCategory" IS NULL AND "targetSubtype" IS NULL AND "targetSubtypeIdentity" IS NULL
   AND "targetUnit" IS NULL AND "factorBasis" IS NULL AND "reportingScope" IS NULL
   AND "scope3Category" IS NULL AND "interpretedCoefficient" IS NULL AND "interpretedExponent" IS NULL END);
ALTER TABLE of_requirement ADD CONSTRAINT of_requirement_key_ck CHECK (
 "subtypeIdentity" = of_subtype_key(subtype) AND (subtype IS NULL OR btrim(subtype) <> '')
 AND "lookupKey" = of_lookup_key(category, subtype, basis::text) AND octet_length("lookupKey") <= 1024
 AND btrim(category) <> '' AND btrim(unit) <> '' AND btrim(geography) <> '' AND btrim(rationale) <> ''
 AND "companionOfId" IS DISTINCT FROM id);
ALTER TABLE of_manifest ADD CONSTRAINT of_manifest_interval_ck CHECK (
 "baselineGeneration" >= 0 AND ("applicableUntil" IS NULL OR "applicableUntil" > "applicableFrom")
 AND (purpose <> 'PRODUCTION_COMPLETE' OR "applicableUntil" IS NOT NULL));
ALTER TABLE of_manifest_factor ADD CONSTRAINT of_item_value_ck CHECK (
 of_exact_valid("exactCoefficient", "exactExponent") AND "candidateValue" >= 0
 AND "candidateValue" = of_exact_decimal("exactCoefficient", "exactExponent"));
ALTER TABLE of_manifest_factor ADD CONSTRAINT of_item_key_ck CHECK (
 "targetSubtypeIdentity" = of_subtype_key("targetSubtype") AND ("targetSubtype" IS NULL OR btrim("targetSubtype") <> '')
 AND "lookupKey" = of_lookup_key("targetCategory", "targetSubtype", "factorBasis"::text)
 AND octet_length("lookupKey") <= 1024 AND btrim("originalSourceName") <> '' AND "originalVintageYear" BETWEEN 1900 AND 9999);
ALTER TABLE of_manifest_factor ADD CONSTRAINT of_item_origin_ck CHECK (
 CASE WHEN origin = 'NEW_OFFICIAL' THEN "mappingId" IS NOT NULL AND "dispositionId" IS NOT NULL
 AND "rootSourceFactorId" IS NOT NULL AND "sourceReleaseId" IS NOT NULL
 AND "carryForwardRationale" IS NULL AND "carryValidFrom" IS NULL AND "carryValidUntil" IS NULL
 ELSE "predecessorFactorId" IS NOT NULL AND "mappingId" IS NULL AND "dispositionId" IS NULL
 AND "carryForwardRationale" IS NOT NULL AND btrim("carryForwardRationale") <> ''
 AND "carryValidFrom" IS NOT NULL AND "carryValidUntil" IS NOT NULL AND "carryValidFrom" < "carryValidUntil" END);
ALTER TABLE of_approval ADD CONSTRAINT of_approval_subject_ck CHECK (
 (("manifestId" IS NOT NULL)::int + ("activationPlanId" IS NOT NULL)::int) = 1
 AND ((purpose = 'ACTIVATE') = ("activationPlanId" IS NOT NULL))
 AND "expiresAt" > "approvedAt" AND "expiresAt" <= "approvedAt" + INTERVAL '7 days' AND btrim(rationale) <> '');
ALTER TABLE of_grant ADD CONSTRAINT of_grant_no_self_ck CHECK ("userId" <> "grantedByUserId" AND ("expiresAt" IS NULL OR "expiresAt" > "grantedAt") AND btrim(reason) <> '');
ALTER TABLE of_window ADD CONSTRAINT of_window_bounds_ck CHECK ("untilExclusive" IS NULL OR "untilExclusive" > "fromInclusive");
ALTER TABLE of_plan ADD CONSTRAINT of_plan_generation_ck CHECK ("expectedGeneration" >= 0 AND revision = "expectedGeneration" + 1);
ALTER TABLE of_event ADD CONSTRAINT of_event_shape_ck CHECK (sequence > 0
 AND ((sequence = 1) = ("previousEventHash" IS NULL))
 AND ("actorKind" <> 'USER' OR "actorUserId" IS NOT NULL)
 AND CASE WHEN "eventType" = 'ACTIVATION_SUCCEEDED' THEN "activationGeneration" IS NOT NULL AND "activationGeneration" > 0
 AND "activationPlanId" IS NOT NULL AND "approvalId" IS NOT NULL ELSE "activationGeneration" IS NULL END);
ALTER TABLE "EmissionFactor" ADD CONSTRAINT of_factor_link_pair_ck CHECK (
 ("officialManifestFactorId" IS NULL AND "publishedLookupKey" IS NULL) OR
 ("officialManifestFactorId" IS NOT NULL AND "publishedLookupKey" IS NOT NULL
 AND "publishedLookupKey" = of_lookup_key(category,"subtypeKey",basis::text) AND octet_length("publishedLookupKey") <= 1024));

-- Immutable records and aggregates. No trigger publishes factors or activates a set.
CREATE FUNCTION of_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Official factor record is immutable' USING ERRCODE='23514'; END $$;
CREATE FUNCTION of_header_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
   IF NEW."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'Build and validate before sealing' USING ERRCODE='23514'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP = 'DELETE' OR OLD."sealedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'Official aggregate is sealed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION of_require_seal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE stamp timestamptz;
BEGIN
 EXECUTE format('SELECT "sealedAt" FROM %I WHERE id=$1',TG_TABLE_NAME) INTO stamp USING NEW.id;
 IF stamp IS NULL THEN RAISE EXCEPTION 'Official aggregate must be sealed before commit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION of_child_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; stamp timestamptz;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Official child is immutable' USING ERRCODE='23514'; END IF;
 parent_id := to_jsonb(NEW)->>TG_ARGV[1];
 EXECUTE format('SELECT "sealedAt" FROM %I WHERE id=$1 FOR UPDATE',TG_ARGV[0]) INTO stamp USING parent_id;
 IF stamp IS NOT NULL THEN RAISE EXCEPTION 'Cannot append to sealed official aggregate' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION of_revocation_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' OR OLD."revokedAt" IS NOT NULL OR NEW."revokedAt" IS NULL OR
 (to_jsonb(OLD)-ARRAY['revokedAt','revokedByUserId','revocationReason']) IS DISTINCT FROM
 (to_jsonb(NEW)-ARRAY['revokedAt','revokedByUserId','revocationReason']) THEN
 RAISE EXCEPTION 'Only one-way revocation is permitted' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION of_lifecycle_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[] := string_to_array(TG_ARGV[0],',');
BEGIN
 IF TG_OP = 'DELETE' OR (to_jsonb(OLD)-allowed) IS DISTINCT FROM (to_jsonb(NEW)-allowed) THEN
 RAISE EXCEPTION 'Immutable official identity/content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Typed cross-record identity and numeric consistency (not publication authority).
CREATE FUNCTION of_source_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release_id text; identity_release text;
BEGIN
 SELECT ra."releaseId" INTO release_id FROM of_parse p JOIN of_release_artifact ra ON ra.id=p."releaseArtifactId" WHERE p.id=NEW."parseId";
 IF NEW."identityId" IS NOT NULL THEN
 SELECT "releaseId" INTO identity_release FROM of_identity WHERE id=NEW."identityId";
 IF release_id IS DISTINCT FROM identity_release THEN RAISE EXCEPTION 'Source identity belongs to another release' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION of_mapping_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior of_mapping; source of_source_factor;
BEGIN
 IF NEW.revision > 1 THEN
 SELECT * INTO prior FROM of_mapping WHERE id=NEW."supersedesMappingId";
 IF prior.id IS NULL OR prior."identityId" <> NEW."identityId" OR prior."targetSlot" <> NEW."targetSlot" OR prior.revision <> NEW.revision-1 THEN
 RAISE EXCEPTION 'Invalid mapping revision stream' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.decision='MAPPED' THEN
 SELECT * INTO source FROM of_source_factor WHERE id=NEW."sourceFactorId";
 IF source."numericKind" IS DISTINCT FROM 'FINITE' OR source."parseStatus"='REJECTED'
 OR source."gasMeasure" IS DISTINCT FROM NEW."gasMeasure" OR source."boundaryClass" IS DISTINCT FROM NEW."emissionsBoundary" OR source."cvBasis" IS DISTINCT FROM NEW."cvBasis"
 OR source."exactCoefficient" IS DISTINCT FROM NEW."interpretedCoefficient" OR source."exactExponent" IS DISTINCT FROM NEW."interpretedExponent"
 OR of_exact_decimal(NEW."interpretedCoefficient",NEW."interpretedExponent") < 0
 OR of_exact_decimal(NEW."interpretedCoefficient",NEW."interpretedExponent") >= 10000000000 OR NEW."interpretedExponent" < -8 THEN
 RAISE EXCEPTION 'Mapping would change or lose source precision' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER of_source_integrity_trg BEFORE INSERT ON of_source_factor FOR EACH ROW EXECUTE FUNCTION of_source_integrity();
CREATE TRIGGER of_mapping_integrity_trg BEFORE INSERT ON of_mapping FOR EACH ROW EXECUTE FUNCTION of_mapping_integrity();

CREATE FUNCTION of_manifest_artifact_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ra of_release_artifact; artifact of_artifact; verification of_verification; parsed of_parse;
BEGIN
 SELECT * INTO ra FROM of_release_artifact WHERE id=NEW."releaseArtifactId";
 SELECT * INTO artifact FROM of_artifact WHERE id=ra."artifactId";
 SELECT * INTO verification FROM of_verification WHERE id=NEW."verificationId";
 IF verification."releaseId" IS DISTINCT FROM ra."releaseId" OR NEW."boundArtifactHash" IS DISTINCT FROM artifact.sha256
 OR NEW."boundInventoryHash" IS DISTINCT FROM verification."inventoryHash" THEN RAISE EXCEPTION 'Manifest artifact binding mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.use='FACTOR_INPUT' AND NEW."parseId" IS NULL THEN RAISE EXCEPTION 'Factor input requires a parse' USING ERRCODE='23514'; END IF;
 IF NEW."parseId" IS NOT NULL THEN
 SELECT * INTO parsed FROM of_parse WHERE id=NEW."parseId";
 IF parsed."releaseArtifactId" IS DISTINCT FROM ra.id OR parsed."parseHash" IS DISTINCT FROM NEW."boundParseHash" OR parsed."sealedAt" IS NULL THEN
 RAISE EXCEPTION 'Manifest parse binding mismatch' USING ERRCODE='23514'; END IF;
 ELSIF NEW."boundParseHash" IS NOT NULL THEN RAISE EXCEPTION 'Unexpected parse hash' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER of_ma_integrity_trg BEFORE INSERT ON of_manifest_artifact FOR EACH ROW EXECUTE FUNCTION of_manifest_artifact_integrity();

CREATE FUNCTION of_manifest_item_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest of_manifest; requirement of_requirement; mapping of_mapping; disposition of_disposition; source_release text; vintage integer; predecessor "EmissionFactor";
BEGIN
 SELECT * INTO manifest FROM of_manifest WHERE id=NEW."manifestId";
 SELECT * INTO requirement FROM of_requirement WHERE id=NEW."coverageRequirementId";
 IF requirement."coverageContractId" IS DISTINCT FROM manifest."coverageContractId" OR
 (requirement."lookupKey",requirement.unit,requirement.scope,requirement."scope3Category",requirement.boundary,requirement."gasMeasure",requirement.geography,requirement."cvBasis") IS DISTINCT FROM
 (NEW."lookupKey",NEW."targetUnit",NEW."reportingScope",NEW."scope3Category",NEW."emissionsBoundary",NEW."gasMeasure",NEW.geography,NEW."cvBasis") THEN
 RAISE EXCEPTION 'Manifest item does not match coverage dimensions' USING ERRCODE='23514'; END IF;
 IF NEW.origin='NEW_OFFICIAL' THEN
 SELECT * INTO mapping FROM of_mapping WHERE id=NEW."mappingId";
 SELECT * INTO disposition FROM of_disposition WHERE id=NEW."dispositionId";
 SELECT i."releaseId" INTO source_release FROM of_source_factor s JOIN of_identity i ON i.id=s."identityId" WHERE s.id=NEW."rootSourceFactorId";
 IF mapping.decision IS DISTINCT FROM 'MAPPED' OR disposition.decision IS DISTINCT FROM 'SELECTED'
 OR disposition."manifestId" IS DISTINCT FROM NEW."manifestId" OR disposition."sourceFactorId" IS DISTINCT FROM mapping."sourceFactorId"
 OR NEW."rootSourceFactorId" IS DISTINCT FROM mapping."sourceFactorId" OR NEW."sourceReleaseId" IS DISTINCT FROM source_release OR
 (mapping."targetSlot",mapping."targetUnit",mapping."reportingScope",mapping."scope3Category",mapping."emissionsBoundary",mapping."gasMeasure",mapping."applicabilityGeography",mapping."cvBasis",mapping."interpretedCoefficient",mapping."interpretedExponent") IS DISTINCT FROM
 (NEW."lookupKey",NEW."targetUnit",NEW."reportingScope",NEW."scope3Category",NEW."emissionsBoundary",NEW."gasMeasure",NEW.geography,NEW."cvBasis",NEW."exactCoefficient",NEW."exactExponent") THEN
 RAISE EXCEPTION 'Manifest item has invalid source/mapping lineage' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT * INTO predecessor FROM "EmissionFactor" WHERE id=NEW."predecessorFactorId";
 IF NOT requirement."carryForwardAllowed" OR NEW."carryValidFrom" > manifest."applicableFrom"
 OR manifest."applicableUntil" IS NULL OR NEW."carryValidUntil" < manifest."applicableUntil"
 OR predecessor."co2eFactor" IS DISTINCT FROM NEW."candidateValue" THEN RAISE EXCEPTION 'Invalid carry-forward permission/value/period' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."sourceReleaseId" IS NOT NULL THEN
 SELECT "reportingYear" INTO vintage FROM of_release WHERE id=NEW."sourceReleaseId";
 IF vintage IS DISTINCT FROM NEW."originalVintageYear" THEN RAISE EXCEPTION 'Source vintage cannot be relabelled' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER of_mf_integrity_trg BEFORE INSERT ON of_manifest_factor FOR EACH ROW EXECUTE FUNCTION of_manifest_item_integrity();

CREATE FUNCTION of_seal_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header of_manifest; contract of_coverage;
BEGIN
 IF TG_TABLE_NAME='of_parse' THEN
 IF NEW."candidateCount" <> (SELECT count(*) FROM of_source_factor WHERE "parseId"=NEW.id) THEN RAISE EXCEPTION 'Incomplete parse inventory' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='of_coverage' THEN
 IF NOT EXISTS(SELECT 1 FROM of_requirement WHERE "coverageContractId"=NEW.id) OR EXISTS(
 SELECT 1 FROM of_requirement r LEFT JOIN of_requirement p ON p.id=r."companionOfId"
 WHERE r."coverageContractId"=NEW.id AND r."companionOfId" IS NOT NULL AND
 (p."coverageContractId" IS DISTINCT FROM r."coverageContractId" OR p.unit<>r.unit OR p.geography<>r.geography OR p."cvBasis"<>r."cvBasis" OR (p.level='MANDATORY' AND r.level<>'MANDATORY'))) THEN
 RAISE EXCEPTION 'Invalid coverage inventory/companion' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='of_manifest' THEN
 SELECT * INTO header FROM of_manifest WHERE id=NEW.id;
 SELECT * INTO contract FROM of_coverage WHERE id=header."coverageContractId";
 IF contract.purpose IS DISTINCT FROM header.purpose OR contract."registryId" IS DISTINCT FROM header."registryId" OR contract."sealedAt" IS NULL THEN RAISE EXCEPTION 'Coverage contract mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM of_manifest_artifact WHERE "manifestId"=NEW.id) OR
 EXISTS(SELECT 1 FROM of_requirement r WHERE r."coverageContractId"=header."coverageContractId" AND r.level='MANDATORY' AND NOT EXISTS(SELECT 1 FROM of_manifest_factor f WHERE f."manifestId"=NEW.id AND f."coverageRequirementId"=r.id)) THEN
 RAISE EXCEPTION 'Incomplete mandatory publication coverage' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM of_manifest_artifact a JOIN of_source_factor s ON s."parseId"=a."parseId" WHERE a."manifestId"=NEW.id AND a.use='FACTOR_INPUT' AND NOT EXISTS(SELECT 1 FROM of_disposition d WHERE d."manifestId"=NEW.id AND d."sourceFactorId"=s.id)) OR
 EXISTS(SELECT 1 FROM of_disposition d JOIN of_source_factor s ON s.id=d."sourceFactorId" WHERE d."manifestId"=NEW.id AND NOT EXISTS(SELECT 1 FROM of_manifest_artifact a WHERE a."manifestId"=NEW.id AND a.use='FACTOR_INPUT' AND a."parseId"=s."parseId")) OR
 EXISTS(SELECT 1 FROM of_disposition d WHERE d."manifestId"=NEW.id AND (d.decision='SELECTED') IS DISTINCT FROM EXISTS(SELECT 1 FROM of_manifest_factor f WHERE f."dispositionId"=d.id)) THEN
 RAISE EXCEPTION 'Incomplete manifest dispositions' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE of_registry ADD CONSTRAINT of_hash_format_ck CHECK (("lastEventHash" IS NULL OR "lastEventHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_registry_immutable_trg BEFORE UPDATE OR DELETE ON of_registry FOR EACH ROW EXECUTE FUNCTION of_lifecycle_only('currentPlanId,generation,mode,nextEventSequence,lastEventHash');
CREATE TRIGGER of_release_immutable_trg BEFORE UPDATE OR DELETE ON of_release FOR EACH ROW EXECUTE FUNCTION of_lifecycle_only('status');

ALTER TABLE of_artifact ADD CONSTRAINT of_hash_format_ck CHECK (("sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_artifact_immutable_trg BEFORE UPDATE OR DELETE ON of_artifact FOR EACH ROW EXECUTE FUNCTION of_lifecycle_only('storageState');
CREATE TRIGGER of_release_artifact_immutable_trg BEFORE UPDATE OR DELETE ON of_release_artifact FOR EACH ROW EXECUTE FUNCTION of_lifecycle_only('role,roleRationale');

ALTER TABLE of_verification ADD CONSTRAINT of_hash_format_ck CHECK (("inventoryHash" IS NULL OR "inventoryHash" ~ '^[a-f0-9]{64}$') AND ("verificationHash" IS NULL OR "verificationHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE of_verification ADD CONSTRAINT of_revocation_shape_ck CHECK (("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revocationReason" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "revocationReason" IS NOT NULL AND btrim("revocationReason") <> ''));
CREATE TRIGGER of_verification_immutable_trg BEFORE UPDATE OR DELETE ON of_verification FOR EACH ROW EXECUTE FUNCTION of_revocation_only();

ALTER TABLE of_parse ADD CONSTRAINT of_hash_format_ck CHECK (("parseHash" IS NULL OR "parseHash" ~ '^[a-f0-9]{64}$') AND ("parseKey" IS NULL OR "parseKey" ~ '^[a-f0-9]{64}$'));
ALTER TABLE of_parse ADD CONSTRAINT of_count_bounds_ck CHECK ("scannedCount" >= 0 AND "candidateCount" >= 0 AND "skippedCount" >= 0 AND "warningCount" >= 0 AND "rejectedCount" >= 0);
CREATE TRIGGER of_parse_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_parse FOR EACH ROW EXECUTE FUNCTION of_header_write();
CREATE CONSTRAINT TRIGGER of_parse_seal_complete_trg AFTER INSERT OR UPDATE ON of_parse DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION of_require_seal();
CREATE TRIGGER of_parse_seal_integrity_trg BEFORE UPDATE ON of_parse FOR EACH ROW WHEN (OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL) EXECUTE FUNCTION of_seal_integrity();

ALTER TABLE of_identity ADD CONSTRAINT of_hash_format_ck CHECK (("sourceIdentityHash" IS NULL OR "sourceIdentityHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_identity_immutable_trg BEFORE UPDATE OR DELETE ON of_identity FOR EACH ROW EXECUTE FUNCTION of_immutable();

ALTER TABLE of_source_factor ADD CONSTRAINT of_hash_format_ck CHECK (("observationHash" IS NULL OR "observationHash" ~ '^[a-f0-9]{64}$') AND ("semanticValueHash" IS NULL OR "semanticValueHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_source_factor_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_source_factor FOR EACH ROW EXECUTE FUNCTION of_child_write('of_parse','parseId');

ALTER TABLE of_mapping ADD CONSTRAINT of_hash_format_ck CHECK (("mappingHash" IS NULL OR "mappingHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_mapping_immutable_trg BEFORE UPDATE OR DELETE ON of_mapping FOR EACH ROW EXECUTE FUNCTION of_immutable();

ALTER TABLE of_coverage ADD CONSTRAINT of_hash_format_ck CHECK (("coverageHash" IS NULL OR "coverageHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_coverage_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_coverage FOR EACH ROW EXECUTE FUNCTION of_header_write();
CREATE CONSTRAINT TRIGGER of_coverage_seal_complete_trg AFTER INSERT OR UPDATE ON of_coverage DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION of_require_seal();
CREATE TRIGGER of_coverage_seal_integrity_trg BEFORE UPDATE ON of_coverage FOR EACH ROW WHEN (OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL) EXECUTE FUNCTION of_seal_integrity();
CREATE TRIGGER of_requirement_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_requirement FOR EACH ROW EXECUTE FUNCTION of_child_write('of_coverage','coverageContractId');

ALTER TABLE of_manifest ADD CONSTRAINT of_hash_format_ck CHECK (("manifestHash" IS NULL OR "manifestHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_manifest_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_manifest FOR EACH ROW EXECUTE FUNCTION of_header_write();
CREATE CONSTRAINT TRIGGER of_manifest_seal_complete_trg AFTER INSERT OR UPDATE ON of_manifest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION of_require_seal();
CREATE TRIGGER of_manifest_seal_integrity_trg BEFORE UPDATE ON of_manifest FOR EACH ROW WHEN (OLD."sealedAt" IS NULL AND NEW."sealedAt" IS NOT NULL) EXECUTE FUNCTION of_seal_integrity();

ALTER TABLE of_manifest_artifact ADD CONSTRAINT of_hash_format_ck CHECK (("boundArtifactHash" IS NULL OR "boundArtifactHash" ~ '^[a-f0-9]{64}$') AND ("boundInventoryHash" IS NULL OR "boundInventoryHash" ~ '^[a-f0-9]{64}$') AND ("boundParseHash" IS NULL OR "boundParseHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_manifest_artifact_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_manifest_artifact FOR EACH ROW EXECUTE FUNCTION of_child_write('of_manifest','manifestId');
CREATE TRIGGER of_disposition_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_disposition FOR EACH ROW EXECUTE FUNCTION of_child_write('of_manifest','manifestId');

ALTER TABLE of_manifest_factor ADD CONSTRAINT of_hash_format_ck CHECK (("itemHash" IS NULL OR "itemHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_manifest_factor_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_manifest_factor FOR EACH ROW EXECUTE FUNCTION of_child_write('of_manifest','manifestId');
ALTER TABLE of_grant ADD CONSTRAINT of_revocation_shape_ck CHECK (("revokedAt" IS NULL AND "revokedByUserId" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL));
CREATE TRIGGER of_grant_immutable_trg BEFORE UPDATE OR DELETE ON of_grant FOR EACH ROW EXECUTE FUNCTION of_revocation_only();

ALTER TABLE of_approval ADD CONSTRAINT of_hash_format_ck CHECK (("subjectHash" IS NULL OR "subjectHash" ~ '^[a-f0-9]{64}$') AND ("contributorsHash" IS NULL OR "contributorsHash" ~ '^[a-f0-9]{64}$'));
ALTER TABLE of_approval ADD CONSTRAINT of_revocation_shape_ck CHECK (("revokedAt" IS NULL AND "revokedByUserId" IS NULL AND "revocationReason" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "revocationReason" IS NOT NULL AND btrim("revocationReason") <> ''));
CREATE TRIGGER of_approval_immutable_trg BEFORE UPDATE OR DELETE ON of_approval FOR EACH ROW EXECUTE FUNCTION of_revocation_only();

ALTER TABLE of_publication ADD CONSTRAINT of_hash_format_ck CHECK (("requestHash" IS NULL OR "requestHash" ~ '^[a-f0-9]{64}$') AND ("projectionHash" IS NULL OR "projectionHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_publication_immutable_trg BEFORE UPDATE OR DELETE ON of_publication FOR EACH ROW EXECUTE FUNCTION of_immutable();

ALTER TABLE of_plan ADD CONSTRAINT of_hash_format_ck CHECK (("planHash" IS NULL OR "planHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_plan_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_plan FOR EACH ROW EXECUTE FUNCTION of_header_write();
CREATE CONSTRAINT TRIGGER of_plan_seal_complete_trg AFTER INSERT OR UPDATE ON of_plan DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION of_require_seal();

ALTER TABLE of_window ADD CONSTRAINT of_hash_format_ck CHECK (("legacyAssessmentHash" IS NULL OR "legacyAssessmentHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_window_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON of_window FOR EACH ROW EXECUTE FUNCTION of_child_write('of_plan','planId');

ALTER TABLE of_event ADD CONSTRAINT of_hash_format_ck CHECK (("previousEventHash" IS NULL OR "previousEventHash" ~ '^[a-f0-9]{64}$') AND ("contentHash" IS NULL OR "contentHash" ~ '^[a-f0-9]{64}$'));
CREATE TRIGGER of_event_immutable_trg BEFORE UPDATE OR DELETE ON of_event FOR EACH ROW EXECUTE FUNCTION of_immutable();
