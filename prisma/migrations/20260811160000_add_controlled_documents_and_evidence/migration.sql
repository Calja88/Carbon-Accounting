-- CreateEnum
CREATE TYPE "ControlledDocumentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'EFFECTIVE', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "EvidenceClassification" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('STANDARD', 'LONG_TERM', 'LEGAL_HOLD');

-- CreateEnum
CREATE TYPE "MalwareScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ControlledDocument" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "classification" "EvidenceClassification" NOT NULL DEFAULT 'INTERNAL',
    "ownerMembershipId" TEXT,
    "reviewIntervalMonths" INTEGER,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledDocumentRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "ControlledDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "changeSummary" TEXT,
    "evidenceObjectId" TEXT,
    "checksumSha256" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "classification" "EvidenceClassification" NOT NULL DEFAULT 'INTERNAL',
    "retentionCategory" "RetentionCategory" NOT NULL DEFAULT 'STANDARD',
    "retentionUntil" TIMESTAMP(3),
    "preparedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "approvedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "reviewDueDate" TIMESTAMP(3),
    "obsoleteDate" TIMESTAMP(3),
    "supersedesRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledDocumentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceObject" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "classification" "EvidenceClassification" NOT NULL DEFAULT 'INTERNAL',
    "retentionCategory" "RetentionCategory" NOT NULL DEFAULT 'STANDARD',
    "retentionUntil" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "malwareScanStatus" "MalwareScanStatus" NOT NULL DEFAULT 'PENDING',
    "malwareScannedAt" TIMESTAMP(3),
    "malwareScanner" TEXT,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvidenceObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceObjectBlob" (
    "id" TEXT NOT NULL,
    "evidenceObjectId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "EvidenceObjectBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "purpose" TEXT,
    "linkedByUserId" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDistribution" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "audienceMembershipId" TEXT,
    "audienceRole" TEXT,
    "audienceSiteId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_currentRevisionId_key" ON "ControlledDocument"("currentRevisionId");

-- CreateIndex
CREATE INDEX "ControlledDocument_organisationId_category_idx" ON "ControlledDocument"("organisationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_organisationId_reference_key" ON "ControlledDocument"("organisationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_organisationId_id_key" ON "ControlledDocument"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocumentRevision_evidenceObjectId_key" ON "ControlledDocumentRevision"("evidenceObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocumentRevision_supersedesRevisionId_key" ON "ControlledDocumentRevision"("supersedesRevisionId");

-- CreateIndex
CREATE INDEX "ControlledDocumentRevision_organisationId_status_idx" ON "ControlledDocumentRevision"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocumentRevision_documentId_revisionNumber_key" ON "ControlledDocumentRevision"("documentId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocumentRevision_organisationId_id_key" ON "ControlledDocumentRevision"("organisationId", "id");

-- CreateIndex
CREATE INDEX "EvidenceObject_organisationId_classification_idx" ON "EvidenceObject"("organisationId", "classification");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObject_organisationId_id_key" ON "EvidenceObject"("organisationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObjectBlob_evidenceObjectId_key" ON "EvidenceObjectBlob"("evidenceObjectId");

-- CreateIndex
CREATE INDEX "EvidenceLink_organisationId_resourceType_resourceId_idx" ON "EvidenceLink"("organisationId", "resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceLink_evidenceId_resourceType_resourceId_key" ON "EvidenceLink"("evidenceId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "DocumentDistribution_organisationId_revisionId_idx" ON "DocumentDistribution"("organisationId", "revisionId");

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ControlledDocumentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ControlledDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_evidenceObjectId_fkey" FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocumentRevision" ADD CONSTRAINT "ControlledDocumentRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "ControlledDocumentRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObject" ADD CONSTRAINT "EvidenceObject_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceObjectBlob" ADD CONSTRAINT "EvidenceObjectBlob_evidenceObjectId_fkey" FOREIGN KEY ("evidenceObjectId") REFERENCES "EvidenceObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "EvidenceObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_linkedByUserId_fkey" FOREIGN KEY ("linkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDistribution" ADD CONSTRAINT "DocumentDistribution_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ControlledDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDistribution" ADD CONSTRAINT "DocumentDistribution_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDistribution" ADD CONSTRAINT "DocumentDistribution_audienceMembershipId_fkey" FOREIGN KEY ("audienceMembershipId") REFERENCES "OrganisationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDistribution" ADD CONSTRAINT "DocumentDistribution_audienceSiteId_fkey" FOREIGN KEY ("audienceSiteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- T22 revision-immutability guard (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §§1-2:
-- "Controlled document revisions are immutable after approval. New content
-- creates a successor revision."; T22 acceptance "approved revision
-- immutable"). document-control-service.ts already refuses to touch a
-- non-DRAFT/IN_REVIEW revision's content; this trigger is defence-in-depth
-- so a future direct-SQL write cannot bypass it either. Once a revision has
-- left DRAFT/IN_REVIEW, its content/classification/retention columns may
-- never change, and its status may never move back to DRAFT/IN_REVIEW.
CREATE FUNCTION controlled_document_revision_immutable_once_approved() RETURNS trigger AS $$
BEGIN
  IF OLD."status" NOT IN ('DRAFT', 'IN_REVIEW') THEN
    IF NEW."status" IN ('DRAFT', 'IN_REVIEW') THEN
      RAISE EXCEPTION 'ControlledDocumentRevision % cannot move back to % once it has left draft/review', OLD."id", NEW."status"
        USING ERRCODE = '23000';
    END IF;
    IF NEW."documentId" IS DISTINCT FROM OLD."documentId"
      OR NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber"
      OR NEW."evidenceObjectId" IS DISTINCT FROM OLD."evidenceObjectId"
      OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
      OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
      OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
      OR NEW."changeSummary" IS DISTINCT FROM OLD."changeSummary"
      OR NEW."classification" IS DISTINCT FROM OLD."classification"
      OR NEW."retentionCategory" IS DISTINCT FROM OLD."retentionCategory"
      OR NEW."retentionUntil" IS DISTINCT FROM OLD."retentionUntil"
    THEN
      RAISE EXCEPTION 'ControlledDocumentRevision % is % and its content/classification/retention fields are immutable', OLD."id", OLD."status"
        USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER controlled_document_revision_immutable
  BEFORE UPDATE ON "ControlledDocumentRevision"
  FOR EACH ROW EXECUTE FUNCTION controlled_document_revision_immutable_once_approved();
