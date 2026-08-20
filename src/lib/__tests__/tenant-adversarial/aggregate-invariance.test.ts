/**
 * T80 aggregate-invariance test (Docs/PHASE8_HARDENING_READINESS_SPEC.md
 * §3: "aggregate invariance: adding B data never changes A result";
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md §5). `buildAnalyticsSnapshot` is
 * the dashboard's read-only aggregation engine — only its pure helpers
 * (`previousYearPeriod`/`buildDelta`/`resolveMonthRange`) had tests before
 * this file; the aggregate itself, and the tenant-scoping it relies on
 * (`tenantWhere`/`accessibleActivityEntryFilter`/`accessibleSiteFilter`),
 * had none. This proves the actual invariant end to end: computing
 * Organisation A's snapshot with only Organisation A data present, and
 * again after Organisation B data exists alongside it, must produce the
 * identical result — Organisation B's rows must never be summed, counted,
 * or listed into Organisation A's totals. No real environmental data; every
 * figure here is synthetic.
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, SITE_A, SITE_B, ENTITY_A, ENTITY_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const siteA = { id: SITE_A, organisationId: ORG_A, name: "Aster North", isActive: true, entity: { id: ENTITY_A, name: "Aster Manufacturing" } };
const siteB = { id: SITE_B, organisationId: ORG_B, name: "Birch South", isActive: true, entity: { id: ENTITY_B, name: "Birch Services" } };

function calculation(id: string, organisationId: string, siteId: string, scope: string, kg: number): Row {
  return {
    id,
    organisationId,
    scope,
    basis: scope === "SCOPE_2" ? "LOCATION_BASED" : null,
    resultKgCo2e: kg,
    dataQualityTier: "TIER_1",
    activityEntry: {
      id: `${id}-entry`,
      siteId,
      status: "APPROVED",
      periodStart: new Date("2026-06-01"),
      activityDataPoint: { category: "synthetic_category" },
      site: siteId === SITE_A ? siteA : siteB,
    },
  };
}

const calcA = calculation("calc-a-1", ORG_A, SITE_A, "SCOPE_1", 100);
const calcB = calculation("calc-b-1", ORG_B, SITE_B, "SCOPE_1", 9_999);

let calculationRows: Row[] = [calcA];
let siteRows: Row[] = [siteA];
let activityEntryRows: Row[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    calculation: {
      findMany: vi.fn(async ({ where }: { where: Row }) => calculationRows.filter((row) => row.organisationId === where.organisationId)),
    },
    site: {
      findMany: vi.fn(async ({ where }: { where: Row }) => siteRows.filter((row) => row.organisationId === where.organisationId && row.isActive === where.isActive)),
    },
    activityEntry: {
      count: vi.fn(async ({ where }: { where: Row }) => activityEntryRows.filter((row) => row.organisationId === where.organisationId && row.status === where.status).length),
    },
  },
}));

const { buildAnalyticsSnapshot } = await import("@/lib/analytics-service");

const contextA = makeOrganisationContext(ORG_A);
const periodStart = new Date("2026-06-01");
const periodEnd = new Date("2026-06-30");

describe("buildAnalyticsSnapshot: aggregate invariance across tenants", () => {
  it("Organisation A's totals, site breakdown and counts are identical whether or not Organisation B data exists", async () => {
    calculationRows = [calcA];
    siteRows = [siteA];
    activityEntryRows = [];
    const before = await buildAnalyticsSnapshot(contextA, periodStart, periodEnd);

    calculationRows = [calcA, calcB];
    siteRows = [siteA, siteB];
    activityEntryRows = [
      { organisationId: ORG_B, status: "AWAITING_FACTOR" },
      { organisationId: ORG_B, status: "AWAITING_FACTOR" },
      { organisationId: ORG_B, status: "FLAGGED" },
    ];
    const after = await buildAnalyticsSnapshot(contextA, periodStart, periodEnd);

    expect(after).toEqual(before);
  });

  it("never includes Organisation B's calculation, site, or category rows in Organisation A's snapshot", async () => {
    calculationRows = [calcA, calcB];
    siteRows = [siteA, siteB];
    activityEntryRows = [];
    const snapshot = await buildAnalyticsSnapshot(contextA, periodStart, periodEnd);

    expect(snapshot.sites.map((s) => s.siteId)).toEqual([SITE_A]);
    expect(snapshot.sites.map((s) => s.siteId)).not.toContain(SITE_B);
    expect(snapshot.group.scope1).toBe(100);
    expect(snapshot.group.total).toBe(100);
  });

  it("Organisation A's awaiting-factor/flagged counts exclude Organisation B rows entirely", async () => {
    calculationRows = [calcA];
    siteRows = [siteA];
    activityEntryRows = [
      { organisationId: ORG_A, status: "AWAITING_FACTOR" },
      { organisationId: ORG_B, status: "AWAITING_FACTOR" },
      { organisationId: ORG_B, status: "AWAITING_FACTOR" },
      { organisationId: ORG_B, status: "FLAGGED" },
    ];
    const snapshot = await buildAnalyticsSnapshot(contextA, periodStart, periodEnd);

    expect(snapshot.awaitingFactorCount).toBe(1);
    expect(snapshot.flaggedCount).toBe(0);
  });
});
