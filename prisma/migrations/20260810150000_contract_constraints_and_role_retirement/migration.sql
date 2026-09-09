-- T1A: tenant constraint contract migration
-- (Docs/PHASE1_TENANCY_RBAC_SPEC.md §9 "Contract migration B").
--
-- LcaMethodologyProfile.organisationId is deliberately excluded — it stays
-- nullable (a platform-shared methodology profile is a real, permanent
-- state, not a pre-tenancy artefact) — see the model's own comment.
--
-- Order:
--   1. Mechanical backfill of organisationId from each row's own parent,
--      which is unambiguous because that parent is already required
--      (Entity/Site were backfilled by the T12 structural backfill command;
--      everything below is denormalised or derived one hop from them).
--   2. A guarded single-tenant-only fallback for the handful of roots that
--      have no parent to derive from (ReportSnapshot, AiInteraction,
--      AiSuggestion, and a triage-stage SourceDocument with no siteId yet).
--      This only fires when exactly one Organisation exists — this
--      application's pre-Phase-1 history is genuinely single-tenant, so
--      that is a safe, correct attribution; with more than one Organisation
--      a blind fallback could misattribute a row to the wrong tenant, so it
--      is left for the preflight abort below instead of guessed at here.
--   3. Removal of the pre-tenancy AiSettings singleton row, which already
--      predates Organisation and is unread by application code (see the
--      model comment) — deleted rather than backfilled, so it can never
--      collide with the real per-Organisation row on the @@unique(organisationId)
--      constraint added below.
--   4. A preflight check that aborts the entire migration (this file runs
--      in one transaction, so RAISE EXCEPTION rolls back every statement
--      above too) with diagnostic counts only — never row values — if any
--      null or cross-tenant-mismatched row remains.
--   5. The NOT NULL / composite-constraint / FK DDL itself.

-- =====================================================================
-- 1. Mechanical parent-derived backfill
-- =====================================================================

UPDATE "SiteEnergyContract" c SET "organisationId" = s."organisationId"
FROM "Site" s WHERE c."siteId" = s.id AND c."organisationId" IS NULL;

UPDATE "ActivityEntry" c SET "organisationId" = s."organisationId"
FROM "Site" s WHERE c."siteId" = s.id AND c."organisationId" IS NULL;

UPDATE "CommutingSurvey" c SET "organisationId" = s."organisationId"
FROM "Site" s WHERE c."siteId" = s.id AND c."organisationId" IS NULL;

UPDATE "SourceDocument" d SET "organisationId" = s."organisationId"
FROM "Site" s WHERE d."siteId" = s.id AND d."organisationId" IS NULL;

UPDATE "Calculation" c SET "organisationId" = e."organisationId"
FROM "ActivityEntry" e WHERE c."activityEntryId" = e.id AND c."organisationId" IS NULL;

UPDATE "Supplier" sup SET "organisationId" = e."organisationId"
FROM "Entity" e WHERE sup."entityId" = e.id AND sup."organisationId" IS NULL;

UPDATE "Product" p SET "organisationId" = e."organisationId"
FROM "Entity" e WHERE p."entityId" = e.id AND p."organisationId" IS NULL;

UPDATE "LcaAssessment" a SET "organisationId" = e."organisationId"
FROM "Entity" e WHERE a."entityId" = e.id AND a."organisationId" IS NULL;

UPDATE "LcaSupplierPcf" p SET "organisationId" = e."organisationId"
FROM "Entity" e WHERE p."entityId" = e.id AND p."organisationId" IS NULL;

UPDATE "LcaEvidence" ev SET "organisationId" = a."organisationId"
FROM "LcaAssessment" a WHERE ev."assessmentId" = a.id AND ev."organisationId" IS NULL;

UPDATE "LcaAssessmentVersion" v SET "organisationId" = a."organisationId"
FROM "LcaAssessment" a WHERE v."assessmentId" = a.id AND v."organisationId" IS NULL;

-- =====================================================================
-- 2. Guarded single-tenant fallback
-- =====================================================================

DO $$
DECLARE
  org_count integer;
  the_org_id text;
BEGIN
  SELECT count(*) INTO org_count FROM "Organisation";
  IF org_count = 1 THEN
    SELECT id INTO the_org_id FROM "Organisation" LIMIT 1;

    UPDATE "ReportSnapshot" SET "organisationId" = the_org_id WHERE "organisationId" IS NULL;
    UPDATE "AiInteraction" SET "organisationId" = the_org_id WHERE "organisationId" IS NULL;
    UPDATE "AiSuggestion" SET "organisationId" = the_org_id WHERE "organisationId" IS NULL;
    UPDATE "SourceDocument" SET "organisationId" = the_org_id WHERE "organisationId" IS NULL AND "siteId" IS NULL;
  END IF;
END $$;

-- =====================================================================
-- 3. Drop the dead pre-tenancy AiSettings singleton
-- =====================================================================

DELETE FROM "AiSettings" WHERE "organisationId" IS NULL;

-- =====================================================================
-- 4. Preflight — abort with diagnostic counts, never row values
-- =====================================================================

DO $$
DECLARE
  diagnostics text := '';
  n integer;
BEGIN
  -- Null organisationId, one line per in-scope table.
  SELECT count(*) INTO n FROM "Entity" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('Entity.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Site" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('Site.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "SiteEnergyContract" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('SiteEnergyContract.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "ActivityEntry" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('ActivityEntry.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "CommutingSurvey" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('CommutingSurvey.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Calculation" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('Calculation.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "ReportSnapshot" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('ReportSnapshot.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "SourceDocument" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('SourceDocument.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Supplier" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('Supplier.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Product" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('Product.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaAssessment" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('LcaAssessment.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaSupplierPcf" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('LcaSupplierPcf.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaEvidence" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('LcaEvidence.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaAssessmentVersion" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('LcaAssessmentVersion.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "AiSettings" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('AiSettings.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "AiInteraction" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('AiInteraction.organisationId null=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "AiSuggestion" WHERE "organisationId" IS NULL;
  IF n > 0 THEN diagnostics := diagnostics || format('AiSuggestion.organisationId null=%s; ', n); END IF;

  -- Cross-tenant / conflicting mismatch against each row's own parent —
  -- catches a row whose organisationId was already set, but wrongly.
  SELECT count(*) INTO n FROM "Site" s JOIN "Entity" e ON s."entityId" = e.id
    WHERE s."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('Site/Entity organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "SiteEnergyContract" c JOIN "Site" s ON c."siteId" = s.id
    WHERE c."organisationId" IS DISTINCT FROM s."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('SiteEnergyContract/Site organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "ActivityEntry" c JOIN "Site" s ON c."siteId" = s.id
    WHERE c."organisationId" IS DISTINCT FROM s."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('ActivityEntry/Site organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "CommutingSurvey" c JOIN "Site" s ON c."siteId" = s.id
    WHERE c."organisationId" IS DISTINCT FROM s."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('CommutingSurvey/Site organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Calculation" c JOIN "ActivityEntry" e ON c."activityEntryId" = e.id
    WHERE c."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('Calculation/ActivityEntry organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "SourceDocument" d JOIN "Site" s ON d."siteId" = s.id
    WHERE d."organisationId" IS DISTINCT FROM s."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('SourceDocument/Site organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Supplier" sup JOIN "Entity" e ON sup."entityId" = e.id
    WHERE sup."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('Supplier/Entity organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "Product" p JOIN "Entity" e ON p."entityId" = e.id
    WHERE p."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('Product/Entity organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaAssessment" a JOIN "Entity" e ON a."entityId" = e.id
    WHERE a."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('LcaAssessment/Entity organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaSupplierPcf" p JOIN "Entity" e ON p."entityId" = e.id
    WHERE p."organisationId" IS DISTINCT FROM e."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('LcaSupplierPcf/Entity organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaEvidence" ev JOIN "LcaAssessment" a ON ev."assessmentId" = a.id
    WHERE ev."organisationId" IS DISTINCT FROM a."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('LcaEvidence/LcaAssessment organisationId mismatch=%s; ', n); END IF;

  SELECT count(*) INTO n FROM "LcaAssessmentVersion" v JOIN "LcaAssessment" a ON v."assessmentId" = a.id
    WHERE v."organisationId" IS DISTINCT FROM a."organisationId";
  IF n > 0 THEN diagnostics := diagnostics || format('LcaAssessmentVersion/LcaAssessment organisationId mismatch=%s; ', n); END IF;

  IF diagnostics <> '' THEN
    RAISE EXCEPTION 'T1A contract migration preflight failed — orphaned/inconsistent rows found: %', diagnostics;
  END IF;
END $$;

-- =====================================================================
-- 5. Constraint contract: NOT NULL, organisation-scoped uniqueness, and
-- FK onDelete RESTRICT (a required tenant-owned row can no longer be
-- silently orphaned by deleting its Organisation).
-- =====================================================================

-- DropForeignKey
ALTER TABLE "ActivityEntry" DROP CONSTRAINT "ActivityEntry_organisationId_fkey";
ALTER TABLE "AiInteraction" DROP CONSTRAINT "AiInteraction_organisationId_fkey";
ALTER TABLE "AiSettings" DROP CONSTRAINT "AiSettings_organisationId_fkey";
ALTER TABLE "AiSuggestion" DROP CONSTRAINT "AiSuggestion_organisationId_fkey";
ALTER TABLE "Calculation" DROP CONSTRAINT "Calculation_organisationId_fkey";
ALTER TABLE "CommutingSurvey" DROP CONSTRAINT "CommutingSurvey_organisationId_fkey";
ALTER TABLE "Entity" DROP CONSTRAINT "Entity_organisationId_fkey";
ALTER TABLE "LcaAssessment" DROP CONSTRAINT "LcaAssessment_organisationId_fkey";
ALTER TABLE "LcaAssessmentVersion" DROP CONSTRAINT "LcaAssessmentVersion_organisationId_fkey";
ALTER TABLE "LcaEvidence" DROP CONSTRAINT "LcaEvidence_organisationId_fkey";
ALTER TABLE "LcaSupplierPcf" DROP CONSTRAINT "LcaSupplierPcf_organisationId_fkey";
ALTER TABLE "Product" DROP CONSTRAINT "Product_organisationId_fkey";
ALTER TABLE "ReportSnapshot" DROP CONSTRAINT "ReportSnapshot_organisationId_fkey";
ALTER TABLE "Site" DROP CONSTRAINT "Site_organisationId_fkey";
ALTER TABLE "SiteEnergyContract" DROP CONSTRAINT "SiteEnergyContract_organisationId_fkey";
ALTER TABLE "SourceDocument" DROP CONSTRAINT "SourceDocument_organisationId_fkey";
ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_organisationId_fkey";

-- DropIndex
DROP INDEX "Entity_name_key";
DROP INDEX "Site_entityId_name_key";

-- AlterTable
ALTER TABLE "ActivityEntry" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AiInteraction" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AiSettings" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AiSuggestion" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Calculation" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "CommutingSurvey" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Entity" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "LcaAssessment" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "LcaAssessmentVersion" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "LcaEvidence" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "LcaSupplierPcf" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "ReportSnapshot" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Site" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "SiteEnergyContract" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "SourceDocument" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "organisationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Entity_organisationId_name_key" ON "Entity"("organisationId", "name");
CREATE UNIQUE INDEX "Site_organisationId_entityId_name_key" ON "Site"("organisationId", "entityId", "name");

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Site" ADD CONSTRAINT "Site_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SiteEnergyContract" ADD CONSTRAINT "SiteEnergyContract_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommutingSurvey" ADD CONSTRAINT "CommutingSurvey_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Calculation" ADD CONSTRAINT "Calculation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LcaAssessment" ADD CONSTRAINT "LcaAssessment_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LcaSupplierPcf" ADD CONSTRAINT "LcaSupplierPcf_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LcaEvidence" ADD CONSTRAINT "LcaEvidence_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LcaAssessmentVersion" ADD CONSTRAINT "LcaAssessmentVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
