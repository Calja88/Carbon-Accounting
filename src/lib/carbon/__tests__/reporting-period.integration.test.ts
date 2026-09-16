/** Real PostgreSQL, synthetic rows only. Hosted URLs skip, using the existing guard. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { localDatabaseUrl } from "@/lib/testing/local-database-url";
import { makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { prisma } from "@/lib/prisma";
import { getReportingPeriod, setReportingPeriodState } from "../reporting-period-service";
import { assertPeriodAllowsMutation, ReportingPeriodClosedError, isReportingPeriodClosedError } from "../reporting-period-guard";
import { createActivityEntryWithCalculations, runCalculationsForEntry, recalculatePendingEntries, deriveCategory3Calculations, prepareReportingData, createCommutingSurvey, upsertSiteEnergyContract } from "@/lib/entries-service";
import { buildReportPayload } from "@/lib/report-service";

// The service singleton must use the SAME guarded local URL as the fixtures,
// even if a shell has a different (possibly hosted) DATABASE_URL.
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { localDatabaseUrl } = await import("@/lib/testing/local-database-url");
  return { prisma: new PrismaClient({ datasources: { db: { url: localDatabaseUrl() ?? "postgresql://disabled@127.0.0.1:1/disabled" } }, transactionOptions: { timeout: 10000 } }) };
});

const dbUrl = localDatabaseUrl();
describe.skipIf(!dbUrl)("Carbon Phase 4-ii reporting period barrier", () => {
  const tag = randomUUID();
  const org = `period-org-${tag}`;
  const otherOrg = `period-other-${tag}`;
  const userId = `period-user-${tag}`;
  const siteId = `period-site-${tag}`;
  const openSiteId = `period-open-${tag}`;
  const otherSiteId = `period-foreign-${tag}`;
  const dpId = `period-dp-${tag}`;
  const factorId = `period-factor-${tag}`;
  const start = new Date("2040-01-01T00:00:00Z");
  const end = new Date("2040-01-31T23:59:59Z");
  const context = makeOrganisationContext(org, { userId, permissions: new Set(["carbon.view", "carbon.entry.create", "carbon.entry.approve", "carbon.report.generate"]) });
  const ctx = toTenantRepositoryContext(context);
  const input = { activityDataPointId: dpId, siteId, periodStart: start, periodEnd: end, rawValue: 100, rawUnit: "litres", enteredByUserId: userId };
  let storedEntryId: string;
  let storedCalculation: Prisma.CalculationGetPayload<object>;
  let pendingId: string;
  let periodId: string;
  let reportBefore: Awaited<ReturnType<typeof buildReportPayload>>;
  let snapshotId: string;

  const rawEntry = (overrides: Partial<Prisma.ActivityEntryUncheckedCreateInput> = {}): Prisma.ActivityEntryUncheckedCreateInput => ({
    organisationId: org, ...input, canonicalValue: 100, canonicalUnit: "litres", dataQualityTier: "TIER_2", ...overrides,
  });
  const transition = (state: "OPEN" | "CLOSED", overrides = {}) => setReportingPeriodState(context, { siteId, accountingDate: start, state, reason: "Synthetic accounting control test", ...overrides });

  beforeAll(async () => {
    await prisma.organisation.createMany({ data: [{ id: org, name: "Synthetic reporting org", slug: org }, { id: otherOrg, name: "Synthetic other org", slug: otherOrg }] });
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.invalid`, passwordHash: "synthetic", name: "Synthetic accountant", role: "ADMIN" } });
    for (const [organisationId, id] of [[org, siteId], [org, openSiteId], [otherOrg, otherSiteId]]) {
      const entity = await prisma.entity.create({ data: { organisationId, name: `Synthetic entity ${id}` } });
      await prisma.site.create({ data: { id, organisationId, name: id, entityId: entity.id } });
    }
    await prisma.activityDataPoint.create({ data: {
      id: dpId, code: `P4-${tag}`, scope: "SCOPE_1", category: "Diesel", dataPointName: "Synthetic diesel", promptTemplate: "Synthetic",
      unitOptions: ["litres"], frequency: "Monthly", defaultTier: "TIER_2", formType: "QUANTITY", buildPriority: "test", factorCategory: "stationary_combustion_diesel",
    } });
    // A deliberately future-effective synthetic set keeps this suite isolated
    // from other local test fixtures and exercises actual factor resolution.
    await prisma.emissionFactorSet.create({ data: {
      id: `period-set-${tag}`, name: "Synthetic period factors", publisher: "Synthetic", vintageYear: 2040, effectiveFrom: start,
      effectiveTo: new Date("2040-12-31T23:59:59Z"), visibility: "ORGANISATION", ownerOrganisationId: org,
      factors: { create: [
        { id: factorId, scope: "SCOPE_1", category: "stationary_combustion_diesel", unit: "litres", co2eFactor: 2.5 },
        { scope: "SCOPE_3", category: "wtt_diesel", unit: "litres", co2eFactor: 0.5 },
      ] },
    } });
    const stored = await createActivityEntryWithCalculations(ctx, input);
    storedEntryId = stored.entry.id;
    storedCalculation = stored.calculations[0];
    pendingId = (await prisma.activityEntry.create({ data: rawEntry({ status: "AWAITING_FACTOR" }) })).id;
    reportBefore = await buildReportPayload(context, start, end);
    snapshotId = (await prisma.reportSnapshot.create({ data: {
      organisationId: org, periodStart: start, periodEnd: end, generatedByUserId: userId,
      payload: JSON.parse(JSON.stringify(reportBefore)),
      calculationLinks: { create: { calculationId: storedCalculation.id } },
    } })).id;
    periodId = (await transition("CLOSED")).id;
  }, 30000);

  // Audit/period rows are intentionally retained: their deletion barriers are
  // part of the assertion. Dispose of the local database, not audit history.
  afterAll(async () => { await prisma.$disconnect(); });

  it("allows normal creation/calculation in OPEN data and reads the closed monthly state", async () => {
    expect(storedCalculation.resultKgCo2e.toString()).toBe("250");
    expect(await getReportingPeriod(context, siteId, end)).toMatchObject({ id: periodId, state: "CLOSED" });
    expect(await getReportingPeriod(context, openSiteId, start)).toMatchObject({ id: null, state: "OPEN" });
    const open = await createActivityEntryWithCalculations(ctx, { ...input, siteId: openSiteId });
    expect(open.calculations[0].resultKgCo2e.toString()).toBe("250");
  });

  it("rejects service creation with a deterministic domain error", async () => {
    await expect(createActivityEntryWithCalculations(ctx, input)).rejects.toMatchObject({
      name: "ReportingPeriodClosedError", code: "REPORTING_PERIOD_CLOSED",
      message: "This reporting period is closed. Reopen the period before changing accounting data.",
    });
  });

  it("blocks direct create/createMany, edits, provenance changes, delete and deleteMany", async () => {
    const operations = [
      () => prisma.activityEntry.create({ data: rawEntry() }),
      () => prisma.activityEntry.createMany({ data: [rawEntry()] }),
      () => prisma.activityEntry.update({ where: { id: storedEntryId }, data: { canonicalValue: 999 } }),
      () => prisma.activityEntry.updateMany({ where: { id: pendingId }, data: { status: "REJECTED" } }),
      () => prisma.activityEntry.update({ where: { id: storedEntryId }, data: { dataOrigin: "AI_EXTRACTED" } }),
      () => prisma.activityEntry.delete({ where: { id: pendingId } }),
      () => prisma.activityEntry.deleteMany({ where: { id: pendingId } }),
    ];
    for (const operation of operations) await expect(operation()).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    expect((await prisma.activityEntry.findUniqueOrThrow({ where: { id: storedEntryId } })).canonicalValue.toString()).toBe("100");
  });

  it("uses periodStart month and UTC boundaries, organisation and site; checks old and new dates/sites", async () => {
    await expect(prisma.activityEntry.create({ data: rawEntry({ periodStart: end, periodEnd: new Date("2040-12-31") }) })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    const nextMonth = await prisma.activityEntry.create({ data: rawEntry({ periodStart: new Date("2040-02-01"), periodEnd: new Date("2040-02-29") }) });
    const spanning = await prisma.activityEntry.create({ data: rawEntry({ periodStart: new Date("2039-12-31T23:59:59Z"), periodEnd: end }) });
    expect(spanning.id).toBeTruthy(); // periodEnd never silently reassigns the accounting month
    await expect(prisma.activityEntry.update({ where: { id: nextMonth.id }, data: { periodStart: start } })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    await expect(prisma.activityEntry.update({ where: { id: storedEntryId }, data: { periodStart: new Date("2040-02-01"), siteId: openSiteId } })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    const foreign = await prisma.activityEntry.create({ data: rawEntry({ organisationId: otherOrg, siteId: otherSiteId }) });
    expect(foreign.organisationId).toBe(otherOrg);
    await expect(prisma.activityEntry.create({ data: rawEntry({ siteId: otherSiteId }) })).rejects.toThrow("does not belong");
  });

  it("blocks first calculation, direct calculation writes, Category 3 and report preparation", async () => {
    await expect(runCalculationsForEntry(ctx, pendingId)).rejects.toBeInstanceOf(ReportingPeriodClosedError);
    await expect(deriveCategory3Calculations(ctx, start, end)).rejects.toBeInstanceOf(ReportingPeriodClosedError);
    await expect(prepareReportingData(context, start, end)).rejects.toBeInstanceOf(ReportingPeriodClosedError);
    const copy = { ...storedCalculation, id: undefined };
    await expect(prisma.calculation.create({ data: copy })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    await expect(prisma.calculation.update({ where: { id: storedCalculation.id }, data: { resultKgCo2e: 999 } })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    await expect(prisma.calculation.delete({ where: { id: storedCalculation.id } })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
  });

  it("backfill skips closed periods, continues open ones and audits SYSTEM skip counts", async () => {
    const pendingOpen = await prisma.activityEntry.create({ data: rawEntry({ siteId: openSiteId, status: "AWAITING_FACTOR" }) });
    const result = await recalculatePendingEntries(org);
    expect(result).toEqual({ checked: 2, recalculated: 1, skippedClosedPeriod: 1 });
    expect(await prisma.calculation.count({ where: { activityEntryId: pendingId } })).toBe(0);
    expect(await prisma.calculation.count({ where: { activityEntryId: pendingOpen.id } })).toBe(1);
    expect((await prisma.activityEntry.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe("AWAITING_FACTOR");
    const batch = await prisma.auditEvent.findFirstOrThrow({ where: { organisationId: org, eventType: "calculation.backfilled" }, orderBy: { sequence: "desc" } });
    expect(batch).toMatchObject({ actorType: "SYSTEM", actorUserId: null });
    expect(batch.after).toMatchObject({ skippedClosedPeriod: 1, backfilled: 1, stillAwaitingFactor: 1 });
  });

  it("keeps stored calculations and reports readable with no accounting writes", async () => {
    const before = await prisma.auditEvent.count({ where: { organisationId: org } });
    const replay = await runCalculationsForEntry(ctx, storedEntryId);
    expect(replay).toEqual([storedCalculation]);
    // Other tests add open-site figures. Restrict comparison to the originally
    // closed site's contribution, and prove its stored row never changed.
    const report = await buildReportPayload(context, start, end);
    expect(report.bySite?.find((s) => s.siteId === siteId)).toEqual(reportBefore.bySite?.find((s) => s.siteId === siteId));
    expect(await prisma.auditEvent.count({ where: { organisationId: org } })).toBe(before);
    expect(await prisma.calculation.findUnique({ where: { id: storedCalculation.id } })).toEqual(storedCalculation);
    expect(report.bySite?.find((s) => s.siteId === siteId)).toBeDefined();
    expect((await prisma.reportSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })).payload).toEqual(JSON.parse(JSON.stringify(reportBefore)));
  });

  it("blocks commuting records and effective energy contracts in closed months", async () => {
    const surveyData = { organisationId: org, siteId, periodStart: start, periodEnd: end, headcount: 10, commutingDaysInPeriod: 20, enteredByUserId: userId };
    await expect(prisma.commutingSurvey.create({ data: surveyData })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    // The service looks up the catalogue before the guard; mock only that read
    // to keep the fixture independent of whether S3-07 is seeded locally.
    const lookup = vi.spyOn(prisma.activityDataPoint, "findUniqueOrThrow").mockResolvedValueOnce(await prisma.activityDataPoint.findUniqueOrThrow({ where: { id: dpId } }));
    try { await expect(createCommutingSurvey(ctx, { ...surveyData, responses: [] })).rejects.toBeInstanceOf(ReportingPeriodClosedError); }
    finally { lookup.mockRestore(); }
    await expect(upsertSiteEnergyContract(ctx, { siteId, effectiveFrom: new Date("2039-12-01"), supplierName: "Synthetic", tariffType: "STANDARD", regoBacked: false, enteredByUserId: userId })).rejects.toBeInstanceOf(ReportingPeriodClosedError);
  });

  it("denies unprivileged/foreign/out-of-scope transitions and validates state and reason", async () => {
    await expect(setReportingPeriodState({ ...context, permissions: new Set() }, { siteId, accountingDate: start, state: "OPEN", reason: "test" })).rejects.toThrow();
    await expect(transition("OPEN", { siteId: otherSiteId })).rejects.toThrow();
    await expect(setReportingPeriodState({ ...context, access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([openSiteId]) } }, { siteId, accountingDate: start, state: "OPEN", reason: "test" })).rejects.toThrow();
    await expect(transition("OPEN", { reason: " " })).rejects.toThrow("reason");
    await expect(transition("INVALID" as "OPEN")).rejects.toThrow("Invalid reporting period state");
    expect((await getReportingPeriod(context, siteId, start)).state).toBe("CLOSED");
  });

  it("rolls back a mixed bulk statement and blocks raw SQL bypass", async () => {
    const notes = `bulk-${tag}`;
    await expect(prisma.activityEntry.createMany({ data: [rawEntry({ siteId: openSiteId, notes }), rawEntry({ notes })] })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    expect(await prisma.activityEntry.count({ where: { organisationId: org, notes } })).toBe(0);
    await expect(prisma.$executeRaw`UPDATE "ActivityEntry" SET "canonicalValue" = 999 WHERE "id" = ${storedEntryId}`).rejects.toThrow("REPORTING_PERIOD_CLOSED");
    await expect(prisma.$executeRaw`DELETE FROM "ActivityEntry" WHERE "id" = ${pendingId}`).rejects.toThrow("REPORTING_PERIOD_CLOSED");
  });

  it("retains open-period Category 3 behavior", async () => {
    const date = new Date("2040-03-01");
    const created = await createActivityEntryWithCalculations(ctx, { ...input, siteId: openSiteId, periodStart: date, periodEnd: date });
    expect(await deriveCategory3Calculations(ctx, date, date)).toEqual({ created: 1, skippedNoFactor: 0 });
    expect(await deriveCategory3Calculations(ctx, date, date)).toEqual({ created: 0, skippedNoFactor: 0 });
    expect(await prisma.calculation.count({ where: { activityEntryId: created.entry.id } })).toBe(2);
  });

  it("rolls back a close if the transition audit cannot be persisted", async () => {
    const date = new Date("2040-06-01");
    await expect(setReportingPeriodState({ ...context, userId: `missing-${tag}` }, { siteId, accountingDate: date, state: "CLOSED", reason: "Synthetic failed actor FK" })).rejects.toThrow();
    expect(await getReportingPeriod(context, siteId, date)).toMatchObject({ id: null, state: "OPEN" });
  });

  it("guards existing survey headers/responses and contracts, including reparenting", async () => {
    const date = new Date("2040-09-01");
    const option = await prisma.factorOption.create({ data: { activityDataPointId: dpId, label: "Synthetic commute", subtypeKey: "period-test" } });
    const survey = await prisma.commutingSurvey.create({ data: { organisationId: org, siteId: openSiteId, periodStart: date, periodEnd: date, headcount: 10, commutingDaysInPeriod: 20, enteredByUserId: userId } });
    const responseData = { surveyId: survey.id, factorOptionId: option.id, percentOfHeadcount: 100, avgOneWayDistanceMiles: 5 };
    const response = await prisma.commutingSurveyResponse.create({ data: responseData });
    const otherSurvey = await prisma.commutingSurvey.create({ data: { organisationId: org, siteId: openSiteId, periodStart: new Date("2040-10-01"), periodEnd: new Date("2040-10-31"), headcount: 10, commutingDaysInPeriod: 20, enteredByUserId: userId } });
    const contract = await upsertSiteEnergyContract(ctx, { siteId: openSiteId, effectiveFrom: date, effectiveTo: date, supplierName: "Synthetic", tariffType: "STANDARD", regoBacked: false, enteredByUserId: userId });
    await transition("CLOSED", { siteId: openSiteId, accountingDate: date });
    for (const operation of [
      () => prisma.commutingSurvey.update({ where: { id: survey.id }, data: { headcount: 99 } }),
      () => prisma.commutingSurvey.delete({ where: { id: survey.id } }),
      () => prisma.commutingSurveyResponse.update({ where: { id: response.id }, data: { surveyId: otherSurvey.id } }),
      () => prisma.commutingSurveyResponse.delete({ where: { id: response.id } }),
      () => prisma.commutingSurveyResponse.create({ data: responseData }),
      () => prisma.siteEnergyContract.update({ where: { id: contract.id }, data: { regoBacked: true } }),
      () => prisma.siteEnergyContract.delete({ where: { id: contract.id } }),
    ]) await expect(operation()).rejects.toThrow("REPORTING_PERIOD_CLOSED");
  });

  it("audits authorised reopen and close with real actors; legal holds block reopening", async () => {
    await transition("OPEN");
    await prisma.activityEntry.update({ where: { id: pendingId }, data: { notes: "Open-period update" } });
    await transition("CLOSED");
    const events = await prisma.auditEvent.findMany({ where: { organisationId: org, resourceType: "reporting_period", resourceId: periodId }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual(["reporting_period.closed", "reporting_period.opened", "reporting_period.closed"]);
    expect(events.every((e) => e.actorType === "USER" && e.actorUserId === userId)).toBe(true);
    expect(events[1].after).toMatchObject({ state: "OPEN", membershipId: context.membershipId, reason: "Synthetic accounting control test" });
    await prisma.legalHold.create({ data: { organisationId: org, resourceType: "reporting_period", resourceId: periodId, reason: "Synthetic hold", createdByUserId: userId } });
    await expect(transition("OPEN")).rejects.toThrow("legal hold");
    await expect(prisma.reportingPeriod.delete({ where: { id: periodId } })).rejects.toThrow("cannot be deleted");
    await expect(prisma.reportingPeriod.update({ where: { id: periodId }, data: { siteId: openSiteId } })).rejects.toThrow("identity is immutable");
  });

  it("serializes a concurrent close before a direct write, even without a prior period row", async () => {
    const date = new Date("2040-04-01");
    const monitor = new PrismaClient({ datasources: { db: { url: dbUrl! } } });
    const closing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const close = prisma.$transaction(async (tx) => {
      await tx.reportingPeriod.create({ data: { organisationId: org, siteId, monthStart: date, state: "CLOSED" } });
      closing.resolve();
      await release.promise;
    }, { timeout: 10000 });
    await closing.promise;
    const writing = prisma.activityEntry.create({ data: rawEntry({ periodStart: date, periodEnd: date }) }).then(() => null, (error: unknown) => error);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const rows = await monitor.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%ActivityEntry%') AS blocked`;
        blocked = rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally { release.resolve(); await close; await monitor.$disconnect(); }
    expect(isReportingPeriodClosedError(await writing)).toBe(true);
    expect(await prisma.activityEntry.count({ where: { siteId, periodStart: date } })).toBe(0);
  });

  it("aborts a stale RepeatableRead writer after a close instead of trusting its old snapshot", async () => {
    const date = new Date("2040-05-01");
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const writing = prisma.$transaction(async (tx) => {
      await tx.reportingPeriod.findMany({ where: { siteId } });
      started.resolve();
      await resume.promise;
      await assertPeriodAllowsMutation(tx, ctx, siteId, date);
      await tx.activityEntry.create({ data: rawEntry({ periodStart: date, periodEnd: date }) });
    }, { isolationLevel: "RepeatableRead", timeout: 10000 }).then(() => null, (error: unknown) => error);
    await started.promise;
    try { await transition("CLOSED", { accountingDate: date }); }
    finally { resume.resolve(); }
    expect(await writing).toBeInstanceOf(Error);
    expect(await prisma.activityEntry.count({ where: { siteId, periodStart: date } })).toBe(0);
  });

  it("waits for an earlier accounting write before closing, then rejects subsequent writes", async () => {
    const date = new Date("2040-07-01");
    const saved = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const write = prisma.$transaction(async (tx) => {
      await assertPeriodAllowsMutation(tx, ctx, siteId, date);
      await tx.activityEntry.create({ data: rawEntry({ periodStart: date, periodEnd: date }) });
      saved.resolve();
      await release.promise;
    }, { timeout: 10000 });
    await saved.promise;
    let closed = false;
    const close = transition("CLOSED", { accountingDate: date }).then(() => { closed = true; });
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const rows = await prisma.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%carbon_lock_accounting_site%') AS blocked`;
        blocked = rows[0].blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(closed).toBe(false);
    } finally { release.resolve(); await write; await close; }
    expect(await prisma.activityEntry.count({ where: { siteId, periodStart: date } })).toBe(1);
    await expect(prisma.activityEntry.create({ data: rawEntry({ periodStart: date, periodEnd: date }) })).rejects.toThrow("REPORTING_PERIOD_CLOSED");
  });
});
