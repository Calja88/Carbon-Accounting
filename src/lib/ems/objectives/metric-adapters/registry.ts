/**
 * UI07 — first caller of the T51 adapters outside their own tests. Neither
 * `corporateCarbonMetricAdapter` nor `productLcaMetricAdapter` was ever
 * invoked from application code before this file (both were exported and
 * unit-tested only) — the objectives UI could not actually surface a
 * carbon/LCA-backed metric's reading. This registry only wires the
 * existing, unmodified adapters to a metric version's own `sourceType`; it
 * adds no calculation logic of its own (spec §1 "EMS does not copy or
 * recalculate them").
 */

import type { ObjectiveMetricSourceType, ObjectiveMetricVersion } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { corporateCarbonMetricAdapter, corporateCarbonMetricConfigSchema } from "./corporate-carbon";
import { productLcaMetricAdapter } from "./product-lca";
import type { MetricObservation, MetricSourceAdapter } from "./types";

const ADAPTERS: Partial<Record<ObjectiveMetricSourceType, MetricSourceAdapter>> = {
  CORPORATE_CARBON: corporateCarbonMetricAdapter,
  PRODUCT_LCA: productLcaMetricAdapter,
};

export function getMetricSourceAdapter(sourceType: ObjectiveMetricSourceType): MetricSourceAdapter | null {
  return ADAPTERS[sourceType] ?? null;
}

export class MetricAdapterUnavailableError extends Error {}

/**
 * Resolves the observation(s) a metric version's adapter-linked source
 * actually holds, for display only. The period passed to `resolve` is a
 * defensive echo for adapters (corporate-carbon) whose config carries its
 * own exact period — resolve's own config check wins whenever the two
 * disagree; product-LCA ignores the passed period entirely and reads the
 * frozen assessment's own period instead (see product-lca.ts).
 */
export async function resolveMetricVersionObservations(
  context: OrganisationContext,
  version: ObjectiveMetricVersion,
): Promise<MetricObservation[]> {
  const adapter = getMetricSourceAdapter(version.sourceType);
  if (!adapter) {
    throw new MetricAdapterUnavailableError(
      version.sourceType === "MANUAL"
        ? "Manual metrics are recorded directly — there is no adapter reading to resolve."
        : `No read-only adapter is wired up for source type ${version.sourceType} yet.`,
    );
  }

  let periodStart = new Date(0);
  let periodEnd = new Date();
  if (version.sourceType === "CORPORATE_CARBON") {
    const parsed = corporateCarbonMetricConfigSchema.safeParse(version.aggregationConfig);
    if (parsed.success) {
      periodStart = parsed.data.periodStart;
      periodEnd = parsed.data.periodEnd;
    }
  }

  return adapter.resolve(context, version, { periodStart, periodEnd });
}
