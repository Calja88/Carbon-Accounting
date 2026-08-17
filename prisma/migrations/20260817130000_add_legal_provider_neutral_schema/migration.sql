-- T40 provider-neutral legal schema (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
-- §§1-3). All tables below are platform-global authoritative references,
-- not tenant data — no organisationId column, same as AiModelCatalog (T18).
-- LegalReviewCandidate (Organisation-owned) is out of scope; a later task
-- (T42) adds it once a sync worker exists to populate it.

-- CreateEnum
CREATE TYPE "LegalSourceAuthorityType" AS ENUM ('OFFICIAL', 'EDITORIAL');

-- CreateEnum
CREATE TYPE "LegalSourceProviderStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "LegalSyncStream" AS ENUM ('PUBLICATIONS', 'EFFECTS', 'VERSIONS');

-- CreateEnum
CREATE TYPE "LegalSyncCursorStatus" AS ENUM ('ACTIVE', 'STALE', 'ERROR');

-- CreateEnum
CREATE TYPE "LegalInstrumentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'SUPERSEDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LegalChangeEventStatus" AS ENUM ('DETECTED', 'TRIAGED', 'REVIEW_REQUIRED', 'REVIEWED', 'DISMISSED', 'CLOSED');

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "subdivision" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalTopic" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSourceProvider" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorityType" "LegalSourceAuthorityType" NOT NULL,
    "configReference" TEXT,
    "status" "LegalSourceProviderStatus" NOT NULL DEFAULT 'ENABLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSourceProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalSyncCursor" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "stream" "LegalSyncStream" NOT NULL,
    "jurisdictionId" TEXT,
    "filterKey" TEXT NOT NULL DEFAULT '',
    "cursor" TEXT,
    "overlapStartAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "status" "LegalSyncCursorStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalSyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalInstrument" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "canonicalId" TEXT NOT NULL,
    "instrumentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "number" TEXT,
    "madeAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "commencementAt" TIMESTAMP(3),
    "status" "LegalInstrumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "latestSourceHash" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalInstrumentJurisdiction" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalInstrumentJurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalInstrumentTopic" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalInstrumentTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalInstrumentVersion" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "providerVersionId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL,
    "documentStorageRef" TEXT,
    "checksum" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalInstrumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalProvisionReference" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "versionId" TEXT,
    "providerProvisionId" TEXT NOT NULL,
    "label" TEXT,
    "uri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalProvisionReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalChangeEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceInstrumentId" TEXT NOT NULL,
    "affectedInstrumentId" TEXT,
    "affectedProvisionId" TEXT,
    "sourceVersionId" TEXT,
    "sourceHash" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "rawEvidence" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "LegalChangeEventStatus" NOT NULL DEFAULT 'DETECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_code_key" ON "Jurisdiction"("code");

-- CreateIndex
CREATE INDEX "Jurisdiction_active_idx" ON "Jurisdiction"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LegalTopic_key_key" ON "LegalTopic"("key");

-- CreateIndex
CREATE INDEX "LegalTopic_active_idx" ON "LegalTopic"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LegalSourceProvider_key_key" ON "LegalSourceProvider"("key");

-- CreateIndex
CREATE INDEX "LegalSourceProvider_status_idx" ON "LegalSourceProvider"("status");

-- CreateIndex
CREATE INDEX "LegalSyncCursor_providerId_status_idx" ON "LegalSyncCursor"("providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalSyncCursor_providerId_stream_filterKey_key" ON "LegalSyncCursor"("providerId", "stream", "filterKey");

-- CreateIndex
CREATE INDEX "LegalInstrument_status_idx" ON "LegalInstrument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalInstrument_providerId_canonicalId_key" ON "LegalInstrument"("providerId", "canonicalId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalInstrumentJurisdiction_instrumentId_jurisdictionId_key" ON "LegalInstrumentJurisdiction"("instrumentId", "jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalInstrumentTopic_instrumentId_topicId_key" ON "LegalInstrumentTopic"("instrumentId", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalInstrumentVersion_instrumentId_providerVersionId_key" ON "LegalInstrumentVersion"("instrumentId", "providerVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalProvisionReference_instrumentId_providerProvisionId_key" ON "LegalProvisionReference"("instrumentId", "providerProvisionId");

-- CreateIndex
CREATE INDEX "LegalChangeEvent_providerId_detectedAt_idx" ON "LegalChangeEvent"("providerId", "detectedAt");

-- CreateIndex
CREATE INDEX "LegalChangeEvent_status_idx" ON "LegalChangeEvent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LegalChangeEvent_providerId_dedupeKey_key" ON "LegalChangeEvent"("providerId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "LegalSyncCursor" ADD CONSTRAINT "LegalSyncCursor_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LegalSourceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalSyncCursor" ADD CONSTRAINT "LegalSyncCursor_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrument" ADD CONSTRAINT "LegalInstrument_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LegalSourceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrumentJurisdiction" ADD CONSTRAINT "LegalInstrumentJurisdiction_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrumentJurisdiction" ADD CONSTRAINT "LegalInstrumentJurisdiction_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrumentTopic" ADD CONSTRAINT "LegalInstrumentTopic_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrumentTopic" ADD CONSTRAINT "LegalInstrumentTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "LegalTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalInstrumentVersion" ADD CONSTRAINT "LegalInstrumentVersion_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalProvisionReference" ADD CONSTRAINT "LegalProvisionReference_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalProvisionReference" ADD CONSTRAINT "LegalProvisionReference_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "LegalInstrumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeEvent" ADD CONSTRAINT "LegalChangeEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LegalSourceProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeEvent" ADD CONSTRAINT "LegalChangeEvent_sourceInstrumentId_fkey" FOREIGN KEY ("sourceInstrumentId") REFERENCES "LegalInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeEvent" ADD CONSTRAINT "LegalChangeEvent_affectedInstrumentId_fkey" FOREIGN KEY ("affectedInstrumentId") REFERENCES "LegalInstrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeEvent" ADD CONSTRAINT "LegalChangeEvent_affectedProvisionId_fkey" FOREIGN KEY ("affectedProvisionId") REFERENCES "LegalProvisionReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalChangeEvent" ADD CONSTRAINT "LegalChangeEvent_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "LegalInstrumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T40 immutability (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §3; acceptance:
-- "source provenance immutable"). LegalInstrumentVersion is the retrieved,
-- checksummed snapshot behind an instrument — append-only, exactly like
-- AuditEvent (T20): no application code path ever needs to update or delete
-- one, so a trigger blocks it regardless of which role issues the
-- statement. This is defence-in-depth alongside the application service
-- layer (src/lib/ems/legal/legal-source-service.ts), which never exposes an
-- update/delete for this table either.
CREATE FUNCTION legal_instrument_version_deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LegalInstrumentVersion rows are append-only and cannot be % (id=%)', TG_OP, OLD."id"
    USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_instrument_version_deny_update
  BEFORE UPDATE ON "LegalInstrumentVersion"
  FOR EACH ROW EXECUTE FUNCTION legal_instrument_version_deny_mutation();

CREATE TRIGGER legal_instrument_version_deny_delete
  BEFORE DELETE ON "LegalInstrumentVersion"
  FOR EACH ROW EXECUTE FUNCTION legal_instrument_version_deny_mutation();

-- LegalChangeEvent is never deleted (spec §9: "deleting/disappearing
-- upstream rows never deletes local history") and its detection/evidence
-- columns are immutable once recorded, matching the T40 "source provenance
-- immutable" acceptance criterion. Unlike LegalInstrumentVersion, `status`
-- is designed to progress through its DETECTED -> ... state machine in a
-- later task (T42 triage), so this trigger blocks only the provenance
-- columns rather than every column — the same partial-immutability shape as
-- EmsScopeVersion/AspectAssessment.
CREATE FUNCTION legal_change_event_deny_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LegalChangeEvent rows are append-only and cannot be deleted (id=%)', OLD."id"
    USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_change_event_deny_delete
  BEFORE DELETE ON "LegalChangeEvent"
  FOR EACH ROW EXECUTE FUNCTION legal_change_event_deny_delete();

CREATE FUNCTION legal_change_event_provenance_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."providerId" IS DISTINCT FROM OLD."providerId"
     OR NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."sourceInstrumentId" IS DISTINCT FROM OLD."sourceInstrumentId"
     OR NEW."affectedInstrumentId" IS DISTINCT FROM OLD."affectedInstrumentId"
     OR NEW."affectedProvisionId" IS DISTINCT FROM OLD."affectedProvisionId"
     OR NEW."sourceVersionId" IS DISTINCT FROM OLD."sourceVersionId"
     OR NEW."sourceHash" IS DISTINCT FROM OLD."sourceHash"
     OR NEW."detectedAt" IS DISTINCT FROM OLD."detectedAt"
     OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
     OR NEW."rawEvidence" IS DISTINCT FROM OLD."rawEvidence"
     OR NEW."dedupeKey" IS DISTINCT FROM OLD."dedupeKey" THEN
    RAISE EXCEPTION 'LegalChangeEvent % provenance/evidence fields are immutable; only status may change', OLD."id"
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_change_event_provenance_immutable
  BEFORE UPDATE ON "LegalChangeEvent"
  FOR EACH ROW EXECUTE FUNCTION legal_change_event_provenance_immutable();
