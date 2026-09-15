CREATE TYPE "ReportingPeriodState" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "ReportingPeriod" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "monthStart" DATE NOT NULL,
  "state" "ReportingPeriodState" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportingPeriod_month_start" CHECK (EXTRACT(DAY FROM "monthStart") = 1),
  CONSTRAINT "ReportingPeriod_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReportingPeriod_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportingPeriod_organisationId_siteId_monthStart_key" ON "ReportingPeriod"("organisationId", "siteId", "monthStart");

-- ponytail: serialize accounting writes per site, including months with no
-- period row. Split into month locks only if measured throughput requires it.
-- A no-value-change UPDATE also advances the MVCC row version: a stale
-- RepeatableRead/Serializable writer fails serialization after a close.
CREATE FUNCTION carbon_lock_accounting_site(p_org TEXT, p_site TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Site" SET "createdAt" = "createdAt" WHERE "id" = p_site AND "organisationId" = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting site does not belong to this organisation' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- The authoritative mutation rule. Entries/calculations use periodStart;
-- effective-date inputs may cover multiple months. No system-actor bypass.
CREATE FUNCTION carbon_assert_period_allows_mutation(p_org TEXT, p_site TEXT, p_from TIMESTAMP, p_through TIMESTAMP) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_from IS NULL OR p_through IS NULL OR p_through < p_from THEN
    RAISE EXCEPTION 'Invalid accounting date range' USING ERRCODE = '23514';
  END IF;
  PERFORM carbon_lock_accounting_site(p_org, p_site);
  IF EXISTS (
    SELECT 1 FROM "ReportingPeriod"
    WHERE "organisationId" = p_org AND "siteId" = p_site AND "state" = 'CLOSED'
      AND "monthStart" BETWEEN date_trunc('month', p_from)::date AND date_trunc('month', p_through)::date
  ) THEN
    RAISE EXCEPTION 'REPORTING_PERIOD_CLOSED: This reporting period is closed. Reopen the period before changing accounting data.' USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Parent resolution is based on persisted accounting ownership, not on a
-- caller's claimed organisation or on the time the background job executes.
CREATE FUNCTION carbon_assert_accounting_row(p_table TEXT, p_row JSONB) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  parent_row RECORD;
BEGIN
  IF p_table IN ('ActivityEntry', 'CommutingSurvey') THEN
    PERFORM carbon_assert_period_allows_mutation(p_row->>'organisationId', p_row->>'siteId',
      (p_row->>'periodStart')::timestamp, (p_row->>'periodStart')::timestamp);
  ELSIF p_table = 'SiteEnergyContract' THEN
    PERFORM carbon_assert_period_allows_mutation(p_row->>'organisationId', p_row->>'siteId',
      (p_row->>'effectiveFrom')::timestamp, COALESCE((p_row->>'effectiveTo')::timestamp, '9999-12-31'::timestamp));
  ELSIF p_table = 'Calculation' THEN
    SELECT * INTO STRICT parent_row FROM "ActivityEntry" WHERE "id" = p_row->>'activityEntryId';
    IF parent_row."organisationId" <> p_row->>'organisationId' THEN
      RAISE EXCEPTION 'Calculation organisation does not match its activity entry' USING ERRCODE = '23514';
    END IF;
    PERFORM carbon_assert_period_allows_mutation(parent_row."organisationId", parent_row."siteId", parent_row."periodStart", parent_row."periodStart");
    IF p_row->>'derivedFromCalculationId' IS NOT NULL THEN
      SELECT e.* INTO STRICT parent_row FROM "ActivityEntry" e JOIN "Calculation" c ON c."activityEntryId" = e."id"
        WHERE c."id" = p_row->>'derivedFromCalculationId';
      IF parent_row."organisationId" <> p_row->>'organisationId' THEN
        RAISE EXCEPTION 'Derived calculation organisation does not match its source' USING ERRCODE = '23514';
      END IF;
      PERFORM carbon_assert_period_allows_mutation(parent_row."organisationId", parent_row."siteId", parent_row."periodStart", parent_row."periodStart");
    END IF;
  ELSIF p_table = 'CommutingSurveyResponse' THEN
    SELECT * INTO STRICT parent_row FROM "CommutingSurvey" WHERE "id" = p_row->>'surveyId';
    PERFORM carbon_assert_period_allows_mutation(parent_row."organisationId", parent_row."siteId", parent_row."periodStart", parent_row."periodStart");
    IF p_row->>'activityEntryId' IS NOT NULL THEN
      SELECT * INTO STRICT parent_row FROM "ActivityEntry" WHERE "id" = p_row->>'activityEntryId';
      PERFORM carbon_assert_period_allows_mutation(parent_row."organisationId", parent_row."siteId", parent_row."periodStart", parent_row."periodStart");
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION carbon_accounting_mutation_barrier() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Check BOTH locations: changing the date/site/parent must not move a row
  -- out of (or into) a closed month to evade the barrier.
  IF TG_OP <> 'INSERT' THEN PERFORM carbon_assert_accounting_row(TG_TABLE_NAME, to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM carbon_assert_accounting_row(TG_TABLE_NAME, to_jsonb(NEW)); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER carbon_activity_entry_barrier BEFORE INSERT OR UPDATE OR DELETE ON "ActivityEntry"
  FOR EACH ROW EXECUTE FUNCTION carbon_accounting_mutation_barrier();
CREATE TRIGGER carbon_calculation_barrier BEFORE INSERT OR UPDATE OR DELETE ON "Calculation"
  FOR EACH ROW EXECUTE FUNCTION carbon_accounting_mutation_barrier();
CREATE TRIGGER carbon_commuting_survey_barrier BEFORE INSERT OR UPDATE OR DELETE ON "CommutingSurvey"
  FOR EACH ROW EXECUTE FUNCTION carbon_accounting_mutation_barrier();
CREATE TRIGGER carbon_commuting_response_barrier BEFORE INSERT OR UPDATE OR DELETE ON "CommutingSurveyResponse"
  FOR EACH ROW EXECUTE FUNCTION carbon_accounting_mutation_barrier();
CREATE TRIGGER carbon_energy_contract_barrier BEFORE INSERT OR UPDATE OR DELETE ON "SiteEnergyContract"
  FOR EACH ROW EXECUTE FUNCTION carbon_accounting_mutation_barrier();

CREATE FUNCTION carbon_reporting_period_transition() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reporting periods cannot be deleted; reopen through the audited service' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."organisationId", NEW."siteId", NEW."monthStart") IS DISTINCT FROM (OLD."organisationId", OLD."siteId", OLD."monthStart") THEN
    RAISE EXCEPTION 'Reporting period identity is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM carbon_lock_accounting_site(NEW."organisationId", NEW."siteId");
  RETURN NEW;
END;
$$;
CREATE TRIGGER carbon_reporting_period_transition BEFORE INSERT OR UPDATE OR DELETE ON "ReportingPeriod"
  FOR EACH ROW EXECUTE FUNCTION carbon_reporting_period_transition();
