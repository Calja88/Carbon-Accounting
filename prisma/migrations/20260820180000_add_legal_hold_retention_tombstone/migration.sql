-- T81: legal hold register and evidence retention tombstone
-- (Docs/PHASE8_HARDENING_READINESS_SPEC.md §4 "T81 audit, retention and export").

-- CreateEnum
CREATE TYPE "LegalHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "EvidenceObject" ADD COLUMN "retentionTombstonedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EvidenceObject_organisationId_retentionUntil_idx" ON "EvidenceObject"("organisationId", "retentionUntil");

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "LegalHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByUserId" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalHold_organisationId_status_idx" ON "LegalHold"("organisationId", "status");

-- CreateIndex
CREATE INDEX "LegalHold_organisationId_resourceType_resourceId_status_idx" ON "LegalHold"("organisationId", "resourceType", "resourceId", "status");

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_releasedByUserId_fkey" FOREIGN KEY ("releasedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T81 append-only enforcement, mirroring the AuditEvent trigger
-- (20260811132659_add_audit_event/migration.sql): a legal hold's identity
-- (organisation/resource/reason/creator) can never be rewritten once
-- created. Releasing a hold is the one allowed transition, enforced here at
-- the database level rather than only in the service layer, and restricted
-- to exactly the release columns so a caller cannot use "release" as cover
-- to also rewrite `reason` or the resource it targets.
CREATE FUNCTION legal_hold_deny_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LegalHold rows cannot be deleted (id=%)', OLD."id"
      USING ERRCODE = '23000';
  END IF;

  IF NEW."organisationId" IS DISTINCT FROM OLD."organisationId"
    OR NEW."resourceType" IS DISTINCT FROM OLD."resourceType"
    OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'LegalHold rows are immutable except for release (id=%)', OLD."id"
      USING ERRCODE = '23000';
  END IF;

  IF OLD."status" = 'RELEASED' AND NEW."status" = 'RELEASED' THEN
    RAISE EXCEPTION 'LegalHold % is already released', OLD."id"
      USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER legal_hold_deny_delete
  BEFORE DELETE ON "LegalHold"
  FOR EACH ROW EXECUTE FUNCTION legal_hold_deny_mutation();

CREATE TRIGGER legal_hold_restrict_update
  BEFORE UPDATE ON "LegalHold"
  FOR EACH ROW EXECUTE FUNCTION legal_hold_deny_mutation();
