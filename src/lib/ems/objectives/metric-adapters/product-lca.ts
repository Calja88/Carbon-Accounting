/**
 * Product LCA metric adapter (task T51,
 * Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md §4, "P5-04 Product LCA ...
 * adapters and semantic guards"). Reads one issued, frozen
 * `LcaAssessmentVersion` (T17) — never a live/mutable assessment, never a
 * scenario copy — so a metric can only ever point at a figure that has
 * already gone through the product LCA system's own issue/freeze step.
 *
 * A product LCA figure is an intensity (per functional or declared unit),
 * never an absolute total, and is never summed with a corporate carbon
 * total (spec §1) — every observation this adapter returns carries
 * `magnitudeKind: "INTENSITY"` and the functional/declared unit string the
 * figure is actually expressed against, read from the same frozen payload.
 */

import { z } from "zod";
import { Prisma, LcaVersionStatus, type ObjectiveMetricVersion } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext, findTenantAssessmentVersion } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { SerialisedTotals } from "@/lib/lca/calculation-service";
import {
  parseAggregationConfig,
  MetricAdapterResolutionError,
  type MetricObservation,
  type MetricPeriod,
  type MetricSourceAdapter,
  type ValidationResult,
} from "./types";

/** Frozen, immutable states an adapter may read from — spec §7 "LCA adapter refuses draft/live mutable assessment when issued version is required". `DRAFT_REVISION` is excluded on purpose: it can still change under the reader. */
const READABLE_STATUSES: readonly LcaVersionStatus[] = [LcaVersionStatus.ISSUED, LcaVersionStatus.SUPERSEDED];

export const productLcaMetricConfigSchema = z.object({
  assessmentId: z.string().trim().min(1),
  /** The specific frozen version this metric reads — never "the latest run", which would make the observation change under a metric without a new version being issued. */
  versionId: z.string().trim().min(1),
  /** Which figure in the frozen totals to read. Fossil-only headline vs. including-biogenic are never interchangeable without saying so explicitly (spec §4 "intensity semantics"). */
  intensityBasis: z.enum(["HEADLINE_PER_FUNCTIONAL_UNIT", "INCLUDING_BIOGENIC_PER_FUNCTIONAL_UNIT"]),
});

export type ProductLcaMetricConfig = z.infer<typeof productLcaMetricConfigSchema>;

interface LcaVersionPayloadShape {
  assessment: {
    id: string;
    functionalUnitUnit: string | null;
    isDeclaredUnit: boolean;
    periodStart: string | null;
    periodEnd: string | null;
  };
  calculation: {
    runId: string;
    runAt: string;
    engineVersion: string;
    methodologyVersion: string | null;
    totals: SerialisedTotals;
  } | null;
}

function readIntensityValue(totals: SerialisedTotals, basis: ProductLcaMetricConfig["intensityBasis"]): number {
  return basis === "INCLUDING_BIOGENIC_PER_FUNCTIONAL_UNIT" ? totals.includingBiogenicPerFunctionalUnitKgCo2e : totals.headlinePerFunctionalUnitKgCo2e;
}

async function resolveProductLcaObservations(
  context: OrganisationContext,
  version: ObjectiveMetricVersion,
  period: MetricPeriod,
): Promise<MetricObservation[]> {
  const config = parseAggregationConfig(productLcaMetricConfigSchema, version.aggregationConfig, "PRODUCT_LCA");
  const ctx = toTenantRepositoryContext(context);

  const assessmentVersion = await findTenantAssessmentVersion(ctx, config.versionId, config.assessmentId);
  if (!assessmentVersion) throw new TenantOwnershipError();

  if (!READABLE_STATUSES.includes(assessmentVersion.status)) {
    throw new MetricAdapterResolutionError(
      `Assessment version ${assessmentVersion.version} is ${assessmentVersion.status}, not ISSUED/SUPERSEDED — a metric can only read a frozen version.`,
    );
  }

  const payload = assessmentVersion.payload as unknown as LcaVersionPayloadShape;
  if (!payload.calculation) {
    throw new MetricAdapterResolutionError(`Assessment version ${assessmentVersion.version} was issued without a calculation run frozen into it.`);
  }
  if (!payload.assessment.functionalUnitUnit) {
    throw new MetricAdapterResolutionError(`Assessment version ${assessmentVersion.version} has no functional/declared unit recorded.`);
  }

  const value = readIntensityValue(payload.calculation.totals, config.intensityBasis);

  const observation: MetricObservation = {
    periodStart: payload.assessment.periodStart ? new Date(payload.assessment.periodStart) : period.periodStart,
    periodEnd: payload.assessment.periodEnd ? new Date(payload.assessment.periodEnd) : period.periodEnd,
    value: new Prisma.Decimal(value),
    unit: `kgCO2e / ${payload.assessment.functionalUnitUnit}`,
    magnitudeKind: "INTENSITY",
    provenance: {
      sourceType: "PRODUCT_LCA",
      recordId: assessmentVersion.id,
      recordVersion: assessmentVersion.version,
      assessmentId: config.assessmentId,
      versionId: assessmentVersion.id,
      versionStatus: assessmentVersion.status,
      issuedAt: assessmentVersion.issuedAt?.toISOString() ?? null,
      issuedByUserId: assessmentVersion.issuedByUserId,
      engineVersion: assessmentVersion.engineVersion,
      methodologyVersion: assessmentVersion.methodologyVersion,
      calculationRunId: payload.calculation.runId,
      isDeclaredUnit: payload.assessment.isDeclaredUnit,
      intensityBasis: config.intensityBasis,
    },
  };

  return [observation];
}

async function validateProductLcaDefinition(context: OrganisationContext, config: unknown): Promise<ValidationResult> {
  const parsed = productLcaMetricConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const ctx = toTenantRepositoryContext(context);
  const assessmentVersion = await findTenantAssessmentVersion(ctx, parsed.data.versionId, parsed.data.assessmentId);
  if (!assessmentVersion) {
    return { valid: false, errors: ["versionId does not resolve to an assessment version owned by this organisation under the given assessmentId."] };
  }
  if (!READABLE_STATUSES.includes(assessmentVersion.status)) {
    return { valid: false, errors: [`Assessment version ${assessmentVersion.version} is ${assessmentVersion.status} — only ISSUED or SUPERSEDED versions can back a metric.`] };
  }
  return { valid: true, errors: [] };
}

export const productLcaMetricAdapter: MetricSourceAdapter = {
  type: "PRODUCT_LCA",
  validateDefinition: validateProductLcaDefinition,
  resolve: resolveProductLcaObservations,
};
