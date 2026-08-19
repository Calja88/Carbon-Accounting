/**
 * Product LCA metric adapter tests (task T51). No live database —
 * `@/lib/prisma`'s `lcaAssessmentVersion.findFirst` is replaced with an
 * in-memory fake, following the same pattern as the T50 metric-service
 * tests. All figures are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectiveMetricVersion } from "@prisma/client";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

type Row = Record<string, unknown>;

const tables = vi.hoisted(() => ({
  versions: [] as Row[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lcaAssessmentVersion: {
      findFirst: vi.fn(async ({ where }: { where: Row }) =>
        tables.versions.find((row) => row.id === where.id && row.organisationId === where.organisationId) ?? null,
      ),
    },
  },
}));

function samplePayload(overrides: { hasCalculation?: boolean; functionalUnitUnit?: string | null } = {}) {
  return {
    assessment: {
      id: "assessment-a-1",
      functionalUnitUnit: overrides.functionalUnitUnit === undefined ? "unit produced" : overrides.functionalUnitUnit,
      isDeclaredUnit: false,
      periodStart: "2025-01-01T00:00:00.000Z",
      periodEnd: "2025-03-31T00:00:00.000Z",
    },
    calculation:
      overrides.hasCalculation === false
        ? null
        : {
            runId: "run-1",
            runAt: "2025-04-01T00:00:00.000Z",
            engineVersion: "lca-engine-v1",
            methodologyVersion: "GHG Protocol Product Standard 1.0",
            totals: {
              model: { fossil: 0, biogenicEmissions: 0, biogenicRemovals: 0, technologicalRemovals: 0, storedCarbon: 0, avoidedBurden: 0, offsets: 0 },
              perFunctionalUnit: { fossil: 0, biogenicEmissions: 0, biogenicRemovals: 0, technologicalRemovals: 0, storedCarbon: 0, avoidedBurden: 0, offsets: 0 },
              headlineModelKgCo2e: 500,
              headlinePerFunctionalUnitKgCo2e: 2.5,
              includingBiogenicPerFunctionalUnitKgCo2e: 2.8,
              functionalUnitsInModel: 200,
              functionalUnitResolved: true,
              functionalUnitNote: null,
              diagnostics: [],
            },
          },
  };
}

function makeVersion(id: string, organisationId: string, overrides: Partial<Row> = {}) {
  return {
    id,
    organisationId,
    assessmentId: "assessment-a-1",
    version: 1,
    label: null,
    status: "ISSUED",
    issuedAt: new Date("2025-04-01T09:00:00.000Z"),
    issuedByUserId: "user-1",
    engineVersion: "lca-engine-v1",
    methodologyVersion: "GHG Protocol Product Standard 1.0",
    calculationRunId: "run-1",
    payload: samplePayload(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMetricVersion(overrides: Partial<ObjectiveMetricVersion & { aggregationConfig: unknown }> = {}): ObjectiveMetricVersion {
  return {
    id: "metric-version-1",
    organisationId: ORG_A,
    metricDefinitionId: "metric-def-1",
    version: 1,
    name: "Product carbon intensity",
    sourceType: "PRODUCT_LCA",
    aggregationConfig: {
      assessmentId: "assessment-a-1",
      versionId: "lca-version-a-1",
      intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT",
    },
    unit: "kgCO2e/unit",
    frequency: "Per issued version",
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

const PERIOD = { periodStart: new Date("2025-01-01"), periodEnd: new Date("2025-03-31") };

describe("productLcaMetricAdapter", () => {
  beforeEach(() => {
    tables.versions.length = 0;
    tables.versions.push(
      makeVersion("lca-version-a-1", ORG_A),
      makeVersion("lca-version-a-draft", ORG_A, { status: "DRAFT_REVISION" }),
      makeVersion("lca-version-a-superseded", ORG_A, { status: "SUPERSEDED" }),
      makeVersion("lca-version-a-no-run", ORG_A, { payload: samplePayload({ hasCalculation: false }) }),
      makeVersion("lca-version-b-1", ORG_B, { assessmentId: "assessment-b-1" }),
    );
  });

  it("resolves the headline per-functional-unit intensity with provenance", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion();

    const observations = await productLcaMetricAdapter.resolve(context, version, PERIOD);

    expect(observations).toHaveLength(1);
    expect(observations[0].value.toNumber()).toBe(2.5);
    expect(observations[0].magnitudeKind).toBe("INTENSITY");
    expect(observations[0].unit).toBe("kgCO2e / unit produced");
    expect(observations[0].provenance).toMatchObject({
      sourceType: "PRODUCT_LCA",
      assessmentId: "assessment-a-1",
      versionId: "lca-version-a-1",
      versionStatus: "ISSUED",
      calculationRunId: "run-1",
    });
  });

  it("resolves the including-biogenic intensity as a distinct figure", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "assessment-a-1", versionId: "lca-version-a-1", intensityBasis: "INCLUDING_BIOGENIC_PER_FUNCTIONAL_UNIT" } });

    const [observation] = await productLcaMetricAdapter.resolve(context, version, PERIOD);
    expect(observation.value.toNumber()).toBe(2.8);
  });

  it("refuses a DRAFT_REVISION (live/mutable) assessment version", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "assessment-a-1", versionId: "lca-version-a-draft", intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT" } });

    await expect(productLcaMetricAdapter.resolve(context, version, PERIOD)).rejects.toThrow(/DRAFT_REVISION/);
  });

  it("still resolves a SUPERSEDED version — frozen and readable, just no longer current", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "assessment-a-1", versionId: "lca-version-a-superseded", intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT" } });

    const observations = await productLcaMetricAdapter.resolve(context, version, PERIOD);
    expect(observations[0].provenance.versionStatus).toBe("SUPERSEDED");
  });

  it("denies a metric version pointing at another organisation's assessment version", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "assessment-b-1", versionId: "lca-version-b-1", intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT" } });

    await expect(productLcaMetricAdapter.resolve(context, version, PERIOD)).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("denies a metric version whose versionId is real but under the wrong assessmentId", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "some-other-assessment", versionId: "lca-version-a-1", intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT" } });

    await expect(productLcaMetricAdapter.resolve(context, version, PERIOD)).rejects.toBeInstanceOf(TenantOwnershipError);
  });

  it("raises a resolution error when the issued version has no calculation run frozen into it", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);
    const version = makeMetricVersion({ aggregationConfig: { assessmentId: "assessment-a-1", versionId: "lca-version-a-no-run", intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT" } });

    await expect(productLcaMetricAdapter.resolve(context, version, PERIOD)).rejects.toThrow(/without a calculation run/);
  });

  it("validateDefinition rejects a non-ISSUED/SUPERSEDED version", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);

    const result = await productLcaMetricAdapter.validateDefinition(context, {
      assessmentId: "assessment-a-1",
      versionId: "lca-version-a-draft",
      intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT",
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/DRAFT_REVISION/);
  });

  it("validateDefinition accepts a well-formed config for an owned issued version", async () => {
    const { productLcaMetricAdapter } = await import("../product-lca");
    const context = makeOrganisationContext(ORG_A);

    const result = await productLcaMetricAdapter.validateDefinition(context, {
      assessmentId: "assessment-a-1",
      versionId: "lca-version-a-1",
      intensityBasis: "HEADLINE_PER_FUNCTIONAL_UNIT",
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
