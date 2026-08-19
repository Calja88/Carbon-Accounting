/**
 * Corporate carbon metric adapter (task T51,
 * Docs/PHASE5_OBJECTIVES_ACTIONS_SPEC.md §4, "P5-03 Corporate carbon adapter
 * and regression tests"). Reads an issued, frozen `ReportSnapshot` (T16) —
 * never a live re-aggregation — so the figure an objective's progress reads
 * is exactly the one already published in a report, with the report's own
 * provenance (snapshot id/version, generation time, the calculation ids it
 * was built from) carried onto the observation.
 *
 * The adapter never recomputes a total: it selects one already-frozen slice
 * of `ReportSnapshot.payload` (scope, Scope 2 basis, optional category or
 * site boundary) named by the metric version's `aggregationConfig`. An
 * unrecognised or missing slice is a resolution error, not a silent zero.
 */

import { z } from "zod";
import { Prisma, type ObjectiveMetricVersion } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext, findTenantReportSnapshot } from "@/lib/repositories/carbon-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { ReportPayload } from "@/lib/report-service";
import {
  parseAggregationConfig,
  MetricAdapterResolutionError,
  type MetricObservation,
  type MetricPeriod,
  type MetricSourceAdapter,
  type ValidationResult,
} from "./types";

export const corporateCarbonMetricConfigSchema = z.object({
  /** The exact frozen report this metric reads. Never a live aggregation — spec §4 "requires exact report period". */
  reportSnapshotId: z.string().trim().min(1),
  /** Defensive echo of the snapshot's own period, checked against the loaded snapshot at resolve time so a config edited to point at a different period is caught even though the id itself still resolves. */
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  scope: z.enum(["SCOPE_1", "SCOPE_2", "SCOPE_3"]),
  /** Required for SCOPE_2 — location-based and market-based are never averaged or summed together (report-service.ts keeps them as separate totals). */
  basis: z.enum(["LOCATION_BASED", "MARKET_BASED"]).optional(),
  /** Narrows to one `byCategory`/`bySite` entry when set; the organisation-wide scope/basis total otherwise. Mutually exclusive on purpose — the report payload doesn't cross a category and a site into one figure. */
  category: z.string().trim().min(1).optional(),
  siteId: z.string().trim().min(1).optional(),
})
  .refine((c) => c.scope !== "SCOPE_2" || c.basis !== undefined, {
    message: "basis (LOCATION_BASED or MARKET_BASED) is required when scope is SCOPE_2.",
    path: ["basis"],
  })
  .refine((c) => !(c.category && c.siteId), {
    message: "category and siteId boundaries are mutually exclusive.",
    path: ["siteId"],
  });

export type CorporateCarbonMetricConfig = z.infer<typeof corporateCarbonMetricConfigSchema>;

function resolveSlice(payload: ReportPayload, config: CorporateCarbonMetricConfig): number {
  if (config.siteId) {
    const site = payload.bySite?.find((s) => s.siteId === config.siteId);
    if (!site) throw new MetricAdapterResolutionError(`Report snapshot has no site '${config.siteId}' in its site breakdown.`);
    if (config.scope === "SCOPE_1") return site.scope1;
    if (config.scope === "SCOPE_2") return config.basis === "MARKET_BASED" ? site.scope2Market : site.scope2Location;
    return site.scope3;
  }

  if (config.category) {
    if (config.scope === "SCOPE_1") {
      const entry = payload.scope1.byCategory.find((c) => c.category === config.category);
      if (!entry) throw new MetricAdapterResolutionError(`Report snapshot has no Scope 1 category '${config.category}'.`);
      return entry.kgCo2e;
    }
    if (config.scope === "SCOPE_2") {
      const entry = payload.scope2.byCategory.find((c) => c.category === config.category);
      if (!entry) throw new MetricAdapterResolutionError(`Report snapshot has no Scope 2 category '${config.category}'.`);
      return config.basis === "MARKET_BASED" ? entry.marketKgCo2e : entry.locationKgCo2e;
    }
    const entry = payload.scope3.byCategory.find((c) => c.category === config.category);
    if (!entry) throw new MetricAdapterResolutionError(`Report snapshot has no Scope 3 category '${config.category}'.`);
    return entry.kgCo2e;
  }

  if (config.scope === "SCOPE_1") return payload.scope1.totalKgCo2e;
  if (config.scope === "SCOPE_2") return config.basis === "MARKET_BASED" ? payload.scope2.marketBasedTotalKgCo2e : payload.scope2.locationBasedTotalKgCo2e;
  return payload.scope3.totalKgCo2e;
}

async function resolveCorporateCarbonObservations(
  context: OrganisationContext,
  version: ObjectiveMetricVersion,
  period: MetricPeriod,
): Promise<MetricObservation[]> {
  const config = parseAggregationConfig(corporateCarbonMetricConfigSchema, version.aggregationConfig, "CORPORATE_CARBON");
  const ctx = toTenantRepositoryContext(context);

  const snapshot = await findTenantReportSnapshot(ctx, config.reportSnapshotId);
  if (!snapshot) throw new TenantOwnershipError();

  if (snapshot.periodStart.getTime() !== config.periodStart.getTime() || snapshot.periodEnd.getTime() !== config.periodEnd.getTime()) {
    throw new MetricAdapterResolutionError("Report snapshot period no longer matches the metric definition's configured period.");
  }
  if (snapshot.periodStart.getTime() !== period.periodStart.getTime() || snapshot.periodEnd.getTime() !== period.periodEnd.getTime()) {
    throw new MetricAdapterResolutionError("Requested observation period does not match this report snapshot's period.");
  }

  const payload = snapshot.payload as unknown as ReportPayload;
  const kgCo2e = resolveSlice(payload, config);

  const observation: MetricObservation = {
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    value: new Prisma.Decimal(kgCo2e),
    unit: "kgCO2e",
    magnitudeKind: "ABSOLUTE",
    provenance: {
      sourceType: "CORPORATE_CARBON",
      recordId: snapshot.id,
      recordVersion: snapshot.version,
      reportSnapshotId: snapshot.id,
      reportVersion: snapshot.version,
      generatedAt: snapshot.generatedAt.toISOString(),
      generatedByUserId: snapshot.generatedByUserId,
      calculationIds: payload.calculationIds,
      scope: config.scope,
      basis: config.basis ?? null,
      category: config.category ?? null,
      siteId: config.siteId ?? null,
    },
  };

  return [observation];
}

async function validateCorporateCarbonDefinition(context: OrganisationContext, config: unknown): Promise<ValidationResult> {
  const parsed = corporateCarbonMetricConfigSchema.safeParse(config);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const ctx = toTenantRepositoryContext(context);
  const snapshot = await findTenantReportSnapshot(ctx, parsed.data.reportSnapshotId);
  if (!snapshot) {
    return { valid: false, errors: ["reportSnapshotId does not resolve to a report snapshot owned by this organisation."] };
  }
  if (snapshot.periodStart.getTime() !== parsed.data.periodStart.getTime() || snapshot.periodEnd.getTime() !== parsed.data.periodEnd.getTime()) {
    return { valid: false, errors: ["periodStart/periodEnd do not match the referenced report snapshot's period."] };
  }
  return { valid: true, errors: [] };
}

export const corporateCarbonMetricAdapter: MetricSourceAdapter = {
  type: "CORPORATE_CARBON",
  validateDefinition: validateCorporateCarbonDefinition,
  resolve: resolveCorporateCarbonObservations,
};
