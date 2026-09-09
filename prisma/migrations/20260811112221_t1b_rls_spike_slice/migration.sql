-- CreateTable
CREATE TABLE "RlsSpikeRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RlsSpikeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RlsSpikeRecord_organisationId_idx" ON "RlsSpikeRecord"("organisationId");

-- T1B RLS defence-in-depth spike (Docs/T1B_RLS_SPIKE_FINDINGS.md).
--
-- The runtime role this migration grants to must already exist in the
-- target database before this migration runs: role/credential provisioning
-- is deliberately kept out of the Prisma migration history (it is an
-- infra-level, per-environment step — see scripts/rls-spike/setup-test-db.sh
-- for the local stand-in, and the findings doc for the Neon rollout gap
-- this leaves open). This migration runs as the owner role and only ever
-- touches RlsSpikeRecord — no existing table, constraint, or grant is
-- modified.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_spike_app') THEN
    RAISE EXCEPTION 'T1B RLS spike migration requires role "rls_spike_app" to already exist (see scripts/rls-spike/setup-test-db.sh)';
  END IF;
END
$$;

ALTER TABLE "RlsSpikeRecord" ENABLE ROW LEVEL SECURITY;

-- No public/default grants: the runtime role below is the only one this
-- migration grants access to, and it is deliberately NOT the table owner
-- (so it can never disable RLS or alter this policy — adversarial test
-- matrix §9 "Direct application role cannot disable RLS").
REVOKE ALL ON "RlsSpikeRecord" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON "RlsSpikeRecord" TO rls_spike_app;

-- current_setting(..., true) returns NULL when app.organisation_id was
-- never set in the current transaction; "organisationId" = NULL is never
-- true in SQL, so a missing transaction-local context denies both reads
-- (USING) and writes (WITH CHECK) by construction, with no separate
-- "deny when missing" policy required.
CREATE POLICY "rls_spike_org_isolation" ON "RlsSpikeRecord"
  USING ("organisationId" = current_setting('app.organisation_id', true))
  WITH CHECK ("organisationId" = current_setting('app.organisation_id', true));
