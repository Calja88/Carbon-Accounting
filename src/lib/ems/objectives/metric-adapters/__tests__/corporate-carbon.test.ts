/**
 * Corporate carbon metric adapter tests (task T51). No live database —
 * `@/lib/prisma`'s `reportSnapshot.findFirst` is replaced with an in-memory
 * fake, following the same pattern as the T50 metric-service tests. All
 * figures are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectiveMetricVersion } from "@prisma/client";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { ReportPayload } from "@/lib/report-service";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  snapshots: [] as Row[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    reportSnapshot: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        tables.snapshots.find((row) => row.id === where.id && row.organisationId === where.organisationId) ?? null,
      ),
    },
  },
}));

const PERIOD_START = new Date("2025-01-01T00:00:00.000Z");
const PERIOD_END = new Date("2025-03-31T23:59:59.000Z");

function samplePayload(): ReportPayload {
  return {
    periodStart: PERIOD_START.toISOString(),
    periodEnd: PERIOD_END.toISOString(),
    entity: { name: "Synthetic Group", boundaryApproach: "Operational control", entitiesIncluded: ["Synthetic Co"] },
    scope1: { totalKgCo2e: 1000, byCategory: [{ category: "Stationary combustion", kgCo2e: 1000 }] },
    scope2: {
      locationBasedTotalKgCo2e: 2000,
      marketBasedTotalKgCo2e: 1500,
      byCategory: [{ category: "Purchased electricity", locationKgCo2e: 2000, marketKgCo2e: 1500 }],
    },
    scope3: { totalKgCo2e: 3000, byCategory: [{ category: "Business travel", kgCo2e: 3000 }] },
    dataQuality: { tierBreakdown: [] },
    factorSources: [],
    excludedFlaggedEntries: [],
    awaitingFactorEntries: [],
    executiveSummary: "Synthetic summary.",
    generatedAt: new Date("2025-04-01T09:00:00.000Z").toISOString(),
    calculationIds: ["calc-1", "calc-2"],
    bySite: [{ siteId: "site-1", siteName: "Site One", entityName: "Synthetic Co", scope1: 400, scope2Location: 800, scope2Market: 600, scope3: 1200, total: 2400 }],
  };
}

function makeSnapshot(id: string, organisationId: string) {
  return {
    id,
    organisationId,
    version: 3,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    generatedByUserId: "user-1",
    generatedAt: new Date("2025-04-01T09:00:00.000Z"),
    payload: samplePayload() as unknown as Row,
  };
}

function makeMetricVersion(overrides: Partial<ObjectiveMetricVersion & { aggregationConfig: unknown }> = {}): ObjectiveMetricVersion {
  return {
    id: "metric-version-1",
    organisationId: ORG_A,
    metricDefinitionId: "metric-def-1",
    version: 1,
    name: "Scope 1 emissions",
    sourceType: "CORPORATE_CARBON",
    aggregationConfig: {
      reportSnapshotId: "snapshot-a-1",
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      scope: "SCOPE_1",
    },
    unit: "kgCO2e",
    frequency: "Quarterly",
    boundaryDescription: null,
    dataQualityRules: null,
    status: "ACTIVE",
    preparedByUserId: "user-1",
    preparedAt: new Date(),
    approvedByUserId: "user-2",
    approvedAt: new Date(),
    supersedesVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ObjectiveMetricVersion;
}

describe("corporateCarbonMetricAdapter", () => {
  beforeEach(() => {
    tables.snapshots.length = 0;
    tables.snapshots.push(makeSnapshot("snapshot-a-1", ORG_A), makeSnapshot("snapshot-b-1", ORG_B));
  });

  it("resolves the organisation-wide Scope 1 total with report provenance", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion();

    const observations = await corporateCarbonMetricAdapter.resolve(context, version, { periodStart: PERIOD_START, periodEnd: PERIOD_END });

    expect(observations).toHaveLength(1);
    expect(observations[0].value.toNumber()).toBe(1000);
    expect(observations[0].magnitudeKind).toBe("ABSOLUTE");
    expect(observations[0].unit).toBe("kgCO2e");
    expect(observations[0].provenance).toMatchObject({
      sourceType: "CORPORATE_CARBON",
      reportSnapshotId: "snapshot-a-1",
      reportVersion: 3,
      calculationIds: ["calc-1", "calc-2"],
    });
  });

  it("resolves a category-scoped Scope 3 slice", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({
      aggregationConfig: {
        reportSnapshotId: "snapshot-a-1",
        periodStart: PERIOD_START.toISOString(),
        periodEnd: PERIOD_END.toISOString(),
        scope: "SCOPE_3",
        category: "Business travel",
      },
    });

    const observations = await corporateCarbonMetricAdapter.resolve(context, version, { periodStart: PERIOD_START, periodEnd: PERIOD_END });
    expect(observations[0].value.toNumber()).toBe(3000);
  });

  it("resolves the market-based Scope 2 total, distinct from location-based", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const marketVersion = makeMetricVersion({
      aggregationConfig: { reportSnapshotId: "snapshot-a-1", periodStart: PERIOD_START.toISOString(), periodEnd: PERIOD_END.toISOString(), scope: "SCOPE_2", basis: "MARKET_BASED" },
    });
    const locationVersion = makeMetricVersion({
      aggregationConfig: { reportSnapshotId: "snapshot-a-1", periodStart: PERIOD_START.toISOString(), periodEnd: PERIOD_END.toISOString(), scope: "SCOPE_2", basis: "LOCATION_BASED" },
    });

    const [market] = await corporateCarbonMetricAdapter.resolve(context, marketVersion, { periodStart: PERIOD_START, periodEnd: PERIOD_END });
    const [location] = await corporateCarbonMetricAdapter.resolve(context, locationVersion, { periodStart: PERIOD_START, periodEnd: PERIOD_END });

    expect(market.value.toNumber()).toBe(1500);
    expect(location.value.toNumber()).toBe(2000);
  });

  it("denies a metric version pointing at another organisation's report snapshot", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({
      aggregationConfig: { reportSnapshotId: "snapshot-b-1", periodStart: PERIOD_START.toISOString(), periodEnd: PERIOD_END.toISOString(), scope: "SCOPE_1" },
    });

    await expect(corporateCarbonMetricAdapter.resolve(context, version, { periodStart: PERIOD_START, periodEnd: PERIOD_END })).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("rejects a requested period that does not match the snapshot's own period", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion();
    const wrongPeriodEnd = new Date("2025-06-30T23:59:59.000Z");

    await expect(
      corporateCarbonMetricAdapter.resolve(context, version, { periodStart: PERIOD_START, periodEnd: wrongPeriodEnd }),
    ).rejects.toThrow(/does not match/);
  });

  it("rejects an aggregation config missing the required Scope 2 basis", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({
      aggregationConfig: { reportSnapshotId: "snapshot-a-1", periodStart: PERIOD_START.toISOString(), periodEnd: PERIOD_END.toISOString(), scope: "SCOPE_2" },
    });

    await expect(corporateCarbonMetricAdapter.resolve(context, version, { periodStart: PERIOD_START, periodEnd: PERIOD_END })).rejects.toThrow(/invalid aggregation config/);
  });

  it("validateDefinition rejects a report snapshot id from another organisation", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);

    const result = await corporateCarbonMetricAdapter.validateDefinition(context, {
      reportSnapshotId: "snapshot-b-1",
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      scope: "SCOPE_1",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/organisation/);
  });

  it("validateDefinition accepts a well-formed config for an owned snapshot", async () => {
    const { corporateCarbonMetricAdapter } = await import("../corporate-carbon");
    const context = makeOrganisationContext(ORG_A);

    const result = await corporateCarbonMetricAdapter.validateDefinition(context, {
      reportSnapshotId: "snapshot-a-1",
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      scope: "SCOPE_1",
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
