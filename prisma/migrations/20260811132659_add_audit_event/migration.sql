-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "actorUserId" TEXT,
    "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
    "eventType" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "previousEventHash" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_occurredAt_idx" ON "AuditEvent"("organisationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_resourceType_resourceId_idx" ON "AuditEvent"("organisationId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_correlationId_idx" ON "AuditEvent"("organisationId", "correlationId");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_sequence_idx" ON "AuditEvent"("organisationId", "sequence");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T20 append-only enforcement (Docs/PHASE2_EMS_FOUNDATION_SPEC.md §6:
-- "Audit events cannot be updated/deleted through runtime application
-- role."). Unlike the T1B RLS spike, this app has no owner/runtime role
-- split yet (Docs/T1B_RLS_SPIKE_FINDINGS.md — Neon role-provisioning
-- automation for that split doesn't exist). A trigger rejects UPDATE/DELETE
-- regardless of which role issues it, so immutability does not depend on
-- that unresolved decision. The application repository
-- (src/lib/repositories/audit-repository.ts) additionally never exposes an
-- update/delete method at all — this is defence-in-depth, not the only
-- guard.
CREATE FUNCTION audit_event_deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are append-only and cannot be % (id=%)', TG_OP, OLD."id"
    USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_deny_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_deny_mutation();

CREATE TRIGGER audit_event_deny_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_deny_mutation();
