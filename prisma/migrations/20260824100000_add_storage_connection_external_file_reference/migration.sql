-- SP01: provider-neutral organisation storage configuration and SharePoint
-- external-file reference schema (Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md
-- §§2,6-7,9,11). No Microsoft Graph calls, credentials, or UI ship with this
-- migration -- it is the tenant-scoped configuration and exact-version
-- reference schema a later connector task populates. Expand-only: adds new
-- tables only, no change to any existing table.

-- CreateEnum
CREATE TYPE "StorageConnectionProvider" AS ENUM ('SHAREPOINT');

-- CreateEnum
CREATE TYPE "StorageConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'SUSPENDED', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "ApplicationIdentityMode" AS ENUM ('PARAGON_MULTI_TENANT', 'CUSTOMER_OWNED');

-- CreateEnum
CREATE TYPE "ExternalFileReferenceStatus" AS ENUM ('ACTIVE', 'STALE', 'UNREACHABLE');

-- CreateTable
CREATE TABLE "OrganisationStorageConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "provider" "StorageConnectionProvider" NOT NULL DEFAULT 'SHAREPOINT',
    "status" "StorageConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "entraTenantId" TEXT,
    "applicationIdentityMode" "ApplicationIdentityMode",
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationStorageConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageSiteBinding" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "rootFolderId" TEXT,
    "rootFolderPath" TEXT,
    "label" TEXT,
    "status" "StorageConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageSiteBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalFileReference" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteBindingId" TEXT NOT NULL,
    "evidenceObjectId" TEXT,
    "controlledDocumentRevisionId" TEXT,
    "itemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "eTag" TEXT,
    "webUrl" TEXT,
    "checksumSha256" TEXT NOT NULL,
    "byteSize" INTEGER,
    "mimeType" TEXT,
    "pinnedAt" TIMESTAMP(3),
    "referenceStatus" "ExternalFileReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "staleReason" TEXT,
    "lastObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalFileReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationStorageConnection_organisationId_key" ON "OrganisationStorageConnection"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationStorageConnection_organisationId_id_key" ON "OrganisationStorageConnection"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StorageSiteBinding_organisationId_id_key" ON "StorageSiteBinding"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StorageSiteBinding_connectionId_siteId_driveId_key" ON "StorageSiteBinding"("connectionId", "siteId", "driveId");

-- CreateIndex
CREATE INDEX "StorageSiteBinding_organisationId_status_idx" ON "StorageSiteBinding"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFileReference_evidenceObjectId_key" ON "ExternalFileReference"("evidenceObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFileReference_controlledDocumentRevisionId_key" ON "ExternalFileReference"("controlledDocumentRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalFileReference_organisationId_id_key" ON "ExternalFileReference"("organisationId", "id");

-- CreateIndex
CREATE INDEX "ExternalFileReference_organisationId_siteBindingId_idx" ON "ExternalFileReference"("organisationId", "siteBindingId");

-- CreateIndex
CREATE INDEX "ExternalFileReference_organisationId_referenceStatus_idx" ON "ExternalFileReference"("organisationId", "referenceStatus");

-- AddForeignKey
ALTER TABLE "OrganisationStorageConnection" ADD CONSTRAINT "OrganisationStorageConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationStorageConnection" ADD CONSTRAINT "OrganisationStorageConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationStorageConnection" ADD CONSTRAINT "OrganisationStorageConnection_disabledByUserId_fkey" FOREIGN KEY ("disabledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageSiteBinding" ADD CONSTRAINT "StorageSiteBinding_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "OrganisationStorageConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageSiteBinding" ADD CONSTRAINT "StorageSiteBinding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFileReference" ADD CONSTRAINT "ExternalFileReference_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFileReference" ADD CONSTRAINT "ExternalFileReference_organisationId_siteBindingId_fkey" FOREIGN KEY ("organisationId", "siteBindingId") REFERENCES "StorageSiteBinding"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFileReference" ADD CONSTRAINT "ExternalFileReference_evidenceObjectId_fkey" FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalFileReference" ADD CONSTRAINT "ExternalFileReference_controlledDocumentRevisionId_fkey" FOREIGN KEY ("controlledDocumentRevisionId") REFERENCES "ControlledDocumentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defence-in-depth: exactly one of evidenceObjectId/controlledDocumentRevisionId
-- must be set on each row (service-layer rule in the SP01 storage-connection
-- service), the same "exactly one of N" pattern already promoted to a CHECK
-- constraint for ApplicabilityAssessment/ComplianceObligationVersion's
-- instrumentId/otherRequirementSourceId columns.
ALTER TABLE "ExternalFileReference" ADD CONSTRAINT "ExternalFileReference_target_xor" CHECK (
  ((("evidenceObjectId" IS NOT NULL))::int + (("controlledDocumentRevisionId" IS NOT NULL))::int) = 1
);
