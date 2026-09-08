-- Deployment repair for the non-production T1B RLS spike.
--
-- Some application databases recorded the original T1B migration as failed
-- because its local-only role was not provisioned. The release recovery
-- helper marks that known failed record applied, then this migration safely
-- establishes the isolated table regardless of how far the failed SQL got.
CREATE TABLE IF NOT EXISTS "RlsSpikeRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RlsSpikeRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RlsSpikeRecord_organisationId_idx" ON "RlsSpikeRecord"("organisationId");
REVOKE ALL ON "RlsSpikeRecord" FROM PUBLIC;

-- Preserve the tested spike when its dedicated role exists. In ordinary
-- application environments the table is unused and RLS is explicitly left
-- disabled; no real customer-owned table is affected by this repair.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_spike_app') THEN
    ALTER TABLE "RlsSpikeRecord" ENABLE ROW LEVEL SECURITY;
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "RlsSpikeRecord" TO rls_spike_app';
    DROP POLICY IF EXISTS "rls_spike_org_isolation" ON "RlsSpikeRecord";
    CREATE POLICY "rls_spike_org_isolation" ON "RlsSpikeRecord"
      USING ("organisationId" = current_setting('app.organisation_id', true))
      WITH CHECK ("organisationId" = current_setting('app.organisation_id', true));
  ELSE
    ALTER TABLE "RlsSpikeRecord" DISABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "rls_spike_org_isolation" ON "RlsSpikeRecord";
    RAISE NOTICE 'T1B spike role is absent; isolated spike RLS remains disabled';
  END IF;
END
$$;
