-- SP06: SharePoint delta reconciliation and external-file status
-- synchronisation (Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §9). Expand-only:
-- one new per-(organisation, site binding) delta cursor table, plus new
-- reconciliation-detail columns on ExternalFileReference. No change to any
-- existing column's type or nullability, and no data migration.

-- CreateEnum
CREATE TYPE "ExternalFileReconciliationIssue" AS ENUM ('MISSING', 'DELETED', 'MOVED_OUT_OF_SCOPE', 'RENAMED', 'CHECKSUM_DRIFT', 'PERMISSION_REVOKED', 'TENANT_MISMATCH', 'VERSION_DRIFT_BEHIND_ISSUED');

-- CreateEnum
CREATE TYPE "StorageReconciliationCursorStatus" AS ENUM ('ACTIVE', 'STALE', 'ERROR');

-- AlterTable
ALTER TABLE "ExternalFileReference"
  ADD COLUMN "reconciliationIssue" "ExternalFileReconciliationIssue",
  ADD COLUMN "lastKnownName" TEXT,
  ADD COLUMN "lastKnownPath" TEXT;

-- CreateIndex
CREATE INDEX "ExternalFileReference_organisationId_reconciliationIssue_idx" ON "ExternalFileReference"("organisationId", "reconciliationIssue");

-- CreateTable
CREATE TABLE "StorageReconciliationCursor" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteBindingId" TEXT NOT NULL,
    "deltaLink" TEXT,
    "status" "StorageReconciliationCursorStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastKnownEntraTenantId" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageReconciliationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageReconciliationCursor_organisationId_siteBindingId_key" ON "StorageReconciliationCursor"("organisationId", "siteBindingId");

-- CreateIndex
CREATE INDEX "StorageReconciliationCursor_organisationId_status_idx" ON "StorageReconciliationCursor"("organisationId", "status");

-- AddForeignKey
ALTER TABLE "StorageReconciliationCursor" ADD CONSTRAINT "StorageReconciliationCursor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageReconciliationCursor" ADD CONSTRAINT "StorageReconciliationCursor_organisationId_siteBindingId_fkey" FOREIGN KEY ("organisationId", "siteBindingId") REFERENCES "StorageSiteBinding"("organisationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
