-- EMS/carbon lifecycle-coverage completion.
--
-- Adds the terminal states that records lacking any lifecycle exit need, so
-- each entity can be closed out without deleting a controlled or issued
-- record. Every addition here is additive and nullable/appended, so existing
-- rows keep their current state and no reported figure changes.

-- An audit programme may be abandoned before it is executed. DRAFT/APPROVED/
-- ACTIVE programmes are OPERATIONAL_CONTROLLED and are never hard-deleted;
-- CANCELLED is the terminal state the enum was missing.
ALTER TYPE "AuditProgrammeStatus" ADD VALUE 'CANCELLED';

-- A competence assignment may be withdrawn when a person no longer holds the
-- role it was raised for. PERSONAL_RESTRICTED — the record and its evidence
-- history are retained, only the obligation ends.
ALTER TYPE "CompetenceAssignmentStatus" ADD VALUE 'WITHDRAWN';

-- Submitted competence evidence may be withdrawn by the submitter before a
-- verifier acts on it. Retained, not deleted, so the submission history of a
-- personal record stays intact.
ALTER TYPE "CompetenceEvidenceStatus" ADD VALUE 'WITHDRAWN';

-- Carbon/LCA archival flags. Suppliers, supplier PCFs and methodology
-- profiles can all be referenced by inventory items, calculation runs and
-- frozen assessment-version snapshots, so archival is the only safe exit.
ALTER TABLE "Supplier" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "LcaSupplierPcf" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "LcaMethodologyProfile" ADD COLUMN "archivedAt" TIMESTAMP(3);
