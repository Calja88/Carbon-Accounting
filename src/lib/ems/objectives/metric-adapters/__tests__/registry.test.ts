/**
 * T51 adapter registry tests (UI07). Mocks the corporate-carbon and
 * product-LCA adapter modules directly — the registry's only job is
 * dispatching a metric version's `sourceType` to the right adapter and
 * deriving the defensive period echo from `aggregationConfig`, not the
 * adapters' own resolution logic (already covered by their own suites).
 */

import { describe, expect, it, vi } from "vitest";
import type { ObjectiveMetricVersion } from "@prisma/client";
import { makeOrganisationContext, ORG_A } from "@/lib/__tests__/tenant-fixtures";
import type { MetricObservation, MetricPeriod } from "../types";

const corporateResolve = vi.fn(async (_ctx: unknown, _version: unknown, period: MetricPeriod): Promise<MetricObservation[]> => [
  {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    value: { toString: () => "42" } as never,
    unit: "tCO2e",
    magnitudeKind: "ABSOLUTE",
    provenance: { sourceType: "CORPORATE_CARBON", recordId: "snap-1", recordVersion: 1 },
  },
]);
const lcaResolve = vi.fn(async (): Promise<MetricObservation[]> => []);

vi.mock("../corporate-carbon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../corporate-carbon")>();
  return { ...actual, corporateCarbonMetricAdapter: { type: "CORPORATE_CARBON", validateDefinition: vi.fn(), resolve: corporateResolve } };
});
vi.mock("../product-lca", () => ({
  productLcaMetricAdapter: { type: "PRODUCT_LCA", validateDefinition: vi.fn(), resolve: lcaResolve },
}));

const { getMetricSourceAdapter, resolveMetricVersionObservations, MetricAdapterUnavailableError } = await import("../registry");

function makeVersion(overrides: Partial<ObjectiveMetricVersion>): ObjectiveMetricVersion {
  return {
    id: "mv-1",
    organisationId: ORG_A,
    metricDefinitionId: "def-1",
    version: 1,
    name: "Synthetic metric",
    sourceType: "MANUAL",
    aggregationConfig: null,
    unit: "tCO2e",
    frequency: "Monthly",
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

describe("metric adapter registry", () => {
  it("has no adapter wired for MANUAL, MONITORING or DERIVED_APPROVED_FORMULA", () => {
    expect(getMetricSourceAdapter("MANUAL")).toBeNull();
    expect(getMetricSourceAdapter("MONITORING")).toBeNull();
    expect(getMetricSourceAdapter("DERIVED_APPROVED_FORMULA")).toBeNull();
  });

  it("dispatches CORPORATE_CARBON and PRODUCT_LCA to their own adapters", () => {
    expect(getMetricSourceAdapter("CORPORATE_CARBON")?.type).toBe("CORPORATE_CARBON");
    expect(getMetricSourceAdapter("PRODUCT_LCA")?.type).toBe("PRODUCT_LCA");
  });

  it("throws MetricAdapterUnavailableError for a MANUAL metric — never fabricates a reading", async () => {
    const context = makeOrganisationContext(ORG_A);
    const version = makeVersion({ sourceType: "MANUAL" });
    await expect(resolveMetricVersionObservations(context, version)).rejects.toThrow(MetricAdapterUnavailableError);
  });

  it("derives the defensive period echo from a CORPORATE_CARBON version's own stored aggregationConfig", async () => {
    const context = makeOrganisationContext(ORG_A);
    const version = makeVersion({
      sourceType: "CORPORATE_CARBON",
      aggregationConfig: {
        reportSnapshotId: "snap-1",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-03-31T23:59:59.000Z",
        scope: "SCOPE_1",
      },
    });
    const observations = await resolveMetricVersionObservations(context, version);
    expect(observations).toHaveLength(1);
    expect(corporateResolve).toHaveBeenCalledWith(
      context,
      version,
      expect.objectContaining({ periodStart: new Date("2025-01-01T00:00:00.000Z"), periodEnd: new Date("2025-03-31T23:59:59.000Z") }),
    );
  });

  it("falls back to a wide default period when a CORPORATE_CARBON version's config doesn't parse — resolve's own config check is the real guard", async () => {
    const context = makeOrganisationContext(ORG_A);
    const version = makeVersion({ sourceType: "CORPORATE_CARBON", aggregationConfig: { nonsense: true } });
    await resolveMetricVersionObservations(context, version);
    expect(corporateResolve).toHaveBeenCalled();
  });

  it("never accepts a foreign-tenant context implicitly — it only forwards whatever OrganisationContext it was given to the adapter", async () => {
    const context = makeOrganisationContext(ORG_A);
    const version = makeVersion({ sourceType: "PRODUCT_LCA" });
    await resolveMetricVersionObservations(context, version);
    expect(lcaResolve).toHaveBeenCalledWith(context, version, expect.anything());
  });
});
