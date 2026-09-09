/**
 * Carbon/LCA read-only metric adapter contract (task T51,
 * Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md §4). An adapter turns an existing,
 * already-calculated result owned by another domain (the T16 corporate
 * carbon inventory, the T17 product LCA system) into a typed
 * `MetricObservation` an EMS objective can read progress from.
 *
 * Fixed decisions this module encodes (spec §1):
 *  - Adapters read existing issued/provenance-rich results. They never copy
 *    a value into a second calculation system, never write, mutate,
 *    recalculate or backfill a carbon/LCA record.
 *  - Corporate absolute emissions and product intensity are never combined
 *    — every observation carries an explicit `magnitudeKind` so the two can
 *    never be silently summed or compared by a caller that forgot which
 *    kind it was holding.
 *  - An adapter never accepts a foreign Organisation ID or a raw
 *    browser-provided query: `resolve` takes the already-authenticated
 *    `OrganisationContext` and looks the source record up through the same
 *    tenant-scoped repository helpers T16/T17 services use, so a
 *    cross-tenant id is denied the same way it would be for any other
 *    carbon/LCA read.
 */

import type { ObjectiveMetricSourceType, ObjectiveMetricVersion, Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";

export type MetricSourceType = ObjectiveMetricSourceType;

/** Thrown when a persisted metric version's `aggregationConfig` does not match the shape its `sourceType` adapter requires. `validateDefinition` should have caught this before the version was ever approved — this is the defensive re-check `resolve` performs against whatever is actually stored. */
export class MetricAdapterConfigError extends Error {}

/** Thrown when the resolved source record cannot supply an observation for reasons that are not a config error — e.g. an LCA version that has no calculation run frozen into it yet. */
export class MetricAdapterResolutionError extends Error {}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface MetricPeriod {
  periodStart: Date;
  periodEnd: Date;
}

/** Absolute = a total for an organisation/boundary (corporate carbon). Intensity = a per-functional/declared-unit figure for one product (product LCA). Never combined (spec §1). */
export type MetricMagnitudeKind = "ABSOLUTE" | "INTENSITY";

/** Everything needed to trace an observation back to the exact frozen source record it was read from, without re-deriving or re-fetching it. Adapter-specific, but every provenance object at minimum names its adapter and the frozen record version it read. */
export interface MetricObservationProvenance {
  sourceType: MetricSourceType;
  recordId: string;
  recordVersion: number;
  [key: string]: unknown;
}

export interface MetricObservation {
  periodStart: Date;
  periodEnd: Date;
  value: Prisma.Decimal;
  unit: string;
  magnitudeKind: MetricMagnitudeKind;
  provenance: MetricObservationProvenance;
}

/**
 * One read-only metric source. `validateDefinition` checks a candidate
 * config (e.g. before a draft metric version is saved) without resolving
 * any observation. `resolve` reads the persisted `ObjectiveMetricVersion`'s
 * `aggregationConfig` and returns the observation(s) it names for the given
 * period — organisation-scoped, never a foreign-tenant record.
 */
export interface MetricSourceAdapter {
  readonly type: MetricSourceType;
  validateDefinition(context: OrganisationContext, config: unknown): Promise<ValidationResult>;
  resolve(context: OrganisationContext, version: ObjectiveMetricVersion, period: MetricPeriod): Promise<MetricObservation[]>;
}

/** Runs a zod schema against an `ObjectiveMetricVersion.aggregationConfig` value, raising `MetricAdapterConfigError` (not a generic zod error) so callers can tell a bad stored config apart from any other failure. */
export function parseAggregationConfig<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } },
  aggregationConfig: Prisma.JsonValue | null | undefined,
  sourceType: MetricSourceType,
): T {
  const result = schema.safeParse(aggregationConfig);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => issue.message).join("; ");
    throw new MetricAdapterConfigError(`${sourceType} metric version has an invalid aggregation config: ${detail}`);
  }
  return result.data;
}
