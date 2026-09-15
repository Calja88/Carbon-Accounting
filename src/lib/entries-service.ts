import { prisma } from "@/lib/prisma";
import { lockActivityEntry } from "@/lib/repositories/row-locks";
import { assertCompletePrimaryCalculations } from "@/lib/calculation-integrity";
import {
  Prisma,
  DataQualityTier,
  EmissionFactor,
  EmissionFactorSet,
  EntryStatus,
  FactorBasis,
  FactorSourceType,
  FactorVisibility,
  Scope,
  TariffType,
} from "@prisma/client";
import { toCanonicalUnit } from "@/lib/units";
import { calculateEmission, calculateScope2Dual, selectMarketBasis, FactorRow } from "@/lib/calc-engine";
import { checkPlausibility } from "@/lib/plausibility";
import { computeCommutingMiles } from "@/lib/commuting";
import { SCOPE3_CAT3_LABEL, wttMappingFor } from "@/lib/scope3-derived";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { assertOwned, tenantWhere } from "@/lib/repositories/tenant-scope";
import { auditActorFor, systemTenantRepositoryContext, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";

/** Real activity data with no matching EmissionFactor (yet) — never crashes
 * a save; the entry is stored and surfaced as "awaiting emission factor"
 * (see EntryStatus.AWAITING_FACTOR) instead. */
export class FactorNotFoundError extends Error {}

/**
 * Phase 1 tenancy (T18): a SUPPLIER_SPECIFIC set is ORGANISATION-visibility,
 * owned by the importing tenant only — without this filter, two
 * organisations naming the same supplier would resolve each other's
 * supplier-specific factors. Mirrors `visibleFactorSetFilter` in
 * factor-sets-service.ts / lca/factor-library.ts.
 */
function visibleFactorSetFilter(organisationId: string): Prisma.EmissionFactorSetWhereInput {
  return {
    OR: [
      { visibility: FactorVisibility.PLATFORM },
      { visibility: FactorVisibility.ORGANISATION, ownerOrganisationId: organisationId },
    ],
  };
}

/**
 * Phase 4-i audit helpers. Audit rows carry the period as ISO dates plus a
 * short human label — enough to locate the accounting window without
 * copying an entry or calculation snapshot into the event JSON, which the
 * durable relational rows already hold (Docs/CARBON_PHASE4_I_NUMERIC_AUDIT.md).
 */
/**
 * Formatting here is total, never throwing: Phase 4-i is observational, and
 * an audit row must never be able to abort the calculation transaction it
 * merely describes. `periodStart`/`periodEnd` are NOT NULL columns, so
 * `null` here means a caller passed something unexpected — recorded as
 * unknown rather than raised as an error that would roll back a figure.
 */
function isoDate(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function periodFields(periodStart: Date, periodEnd: Date) {
  return { periodStart: isoDate(periodStart), periodEnd: isoDate(periodEnd) };
}

function periodLabel(periodStart: Date, periodEnd: Date): string {
  return `${isoDate(periodStart)?.slice(0, 10) ?? "unknown"} to ${isoDate(periodEnd)?.slice(0, 10) ?? "unknown"}`;
}

function toFactorRow(factor: EmissionFactor, factorSet: EmissionFactorSet): FactorRow {
  return {
    id: factor.id,
    basis: factor.basis,
    unit: factor.unit,
    co2eFactor: Number(factor.co2eFactor),
    factorSetName: factorSet.name,
    vintageYear: factorSet.vintageYear,
    isPlaceholder: factorSet.isPlaceholder,
  };
}

/**
 * The factor set of a given source type in effect for the activity
 * *period being reported*, not the moment the calculation runs — this is
 * what keeps historical reports reproducible after DEFRA/UK Gov factors
 * update annually (brief 3.2 / methodology Section 7).
 */
async function findFactorSet(
  sourceType: Exclude<FactorSourceType, "SUPPLIER_SPECIFIC">,
  asOfDate: Date,
  organisationId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<EmissionFactorSet | null> {
  return db.emissionFactorSet.findFirst({
    where: {
      sourceType,
      effectiveFrom: { lte: asOfDate },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
        visibleFactorSetFilter(organisationId),
      ],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findSupplierFactorSet(
  supplierName: string,
  asOfDate: Date,
  organisationId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<EmissionFactorSet | null> {
  return db.emissionFactorSet.findFirst({
    where: {
      sourceType: FactorSourceType.SUPPLIER_SPECIFIC,
      supplierName,
      effectiveFrom: { lte: asOfDate },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }] },
        visibleFactorSetFilter(organisationId),
      ],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findFactorInSet(
  factorSetId: string,
  category: string,
  subtypeKey: string | null,
  basis: FactorBasis,
  db: Prisma.TransactionClient = prisma,
): Promise<EmissionFactor | null> {
  return db.emissionFactor.findFirst({ where: { factorSetId, category, subtypeKey, basis } });
}

interface ResolvedFactor {
  factor: EmissionFactor;
  factorSet: EmissionFactorSet;
  /** TIER_1 when resolved from a SUPPLIER_SPECIFIC set (methodology Section 7: highest data-quality tier); null otherwise, meaning "use the entry's own tier". */
  tierOverride: DataQualityTier | null;
}

/**
 * Multi-source factor resolution (methodology Section 7 / brief item 8):
 * a supplier-specific override (if the entry names a supplier) beats the
 * primary DEFRA/DESNZ official set, which beats the EEIO spend-based
 * fallback used for Cat 1/2. Returns null — never throws — when nothing
 * matches in any source, so the caller can save the entry as "awaiting
 * emission factor" rather than fail the whole submission.
 */
async function resolveFactorMultiSource(
  category: string,
  subtypeKey: string | null,
  basis: FactorBasis,
  asOfDate: Date,
  organisationId: string,
  supplierName?: string | null,
  db: Prisma.TransactionClient = prisma,
): Promise<ResolvedFactor | null> {
  if (supplierName) {
    const supplierSet = await findSupplierFactorSet(supplierName, asOfDate, organisationId, db);
    if (supplierSet) {
      const factor =
        (await findFactorInSet(supplierSet.id, category, subtypeKey, basis, db)) ??
        (await findFactorInSet(supplierSet.id, category, null, basis, db));
      if (factor) return { factor, factorSet: supplierSet, tierOverride: DataQualityTier.TIER_1 };
    }
  }

  const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, asOfDate, organisationId, db);
  if (officialSet) {
    const factor = await findFactorInSet(officialSet.id, category, subtypeKey, basis, db);
    if (factor) return { factor, factorSet: officialSet, tierOverride: null };
  }

  const eeioSet = await findFactorSet(FactorSourceType.EEIO_SPEND_BASED, asOfDate, organisationId, db);
  if (eeioSet) {
    const factor = await findFactorInSet(eeioSet.id, category, subtypeKey, basis, db);
    if (factor) return { factor, factorSet: eeioSet, tierOverride: null };
  }

  return null;
}

async function findActiveEnergyContract(siteId: string, asOfDate: Date, db: Prisma.TransactionClient = prisma) {
  return db.siteEnergyContract.findFirst({
    where: {
      siteId,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

export interface CreateEntryInput {
  activityDataPointId: string;
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  rawValue: number;
  rawUnit: string;
  factorOptionId?: string | null;
  /** Cat 1 only — matched against a SUPPLIER_SPECIFIC EmissionFactorSet. */
  supplierName?: string | null;
  enteredByUserId: string;
  dataQualityTier?: DataQualityTier;
  notes?: string;
}

export async function createActivityEntryWithCalculations(ctx: TenantRepositoryContext, input: CreateEntryInput) {
  const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: input.siteId }) });
  assertOwned(ctx, site);

  const dataPoint = await prisma.activityDataPoint.findUniqueOrThrow({
    where: { id: input.activityDataPointId },
    include: { factorOptions: true },
  });

  if (dataPoint.formType !== "QUANTITY") {
    throw new Error(`${dataPoint.code} is not a quantity-entry data point`);
  }

  if (dataPoint.factorOptions.length > 0 && !input.factorOptionId) {
    throw new Error(`${dataPoint.code} requires a type selection before it can be saved`);
  }

  const factorOption = input.factorOptionId
    ? dataPoint.factorOptions.find((o) => o.id === input.factorOptionId)
    : null;
  if (input.factorOptionId && !factorOption) {
    throw new Error("Selected type option does not belong to this data point");
  }

  const { value: canonicalValue, unit: canonicalUnit } = toCanonicalUnit(
    dataPoint.factorCategory,
    input.rawValue,
    input.rawUnit,
  );

  const previous = await prisma.activityEntry.findFirst({
    where: tenantWhere(ctx, {
      activityDataPointId: dataPoint.id,
      siteId: input.siteId,
      factorOptionId: factorOption?.id ?? null,
      periodStart: { lt: input.periodStart },
    }),
    orderBy: { periodStart: "desc" },
  });

  const plausibility = checkPlausibility(canonicalValue, previous ? Number(previous.canonicalValue) : null);

  // Phase 4-i: the entry and its audit row commit together, so an activity
  // record can never exist without the event that records its arrival. The
  // calculation run keeps its own separate transaction, exactly as before.
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.activityEntry.create({
      data: {
        organisationId: ctx.organisationId,
        activityDataPointId: dataPoint.id,
        siteId: input.siteId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        rawValue: input.rawValue,
        rawUnit: input.rawUnit,
        canonicalValue,
        canonicalUnit,
        factorOptionId: factorOption?.id ?? null,
        supplierName: input.supplierName || null,
        dataQualityTier: input.dataQualityTier ?? dataPoint.defaultTier,
        status: plausibility.flagged ? "FLAGGED" : "SUBMITTED",
        plausibilityFlagged: plausibility.flagged,
        plausibilityReason: plausibility.reason,
        notes: input.notes,
        enteredByUserId: input.enteredByUserId,
      },
    });

    await recordAuditEvent(tx, ctx, {
      eventType: "activity_entry.created",
      resourceType: "activity_entry",
      resourceId: created.id,
      summary: `Activity entry recorded for ${dataPoint.code} at site ${input.siteId} (${periodLabel(input.periodStart, input.periodEnd)})`,
      ...auditActorFor(ctx),
      correlationId: ctx.correlationId,
      after: {
        activityDataPointCode: dataPoint.code,
        siteId: input.siteId,
        ...periodFields(input.periodStart, input.periodEnd),
        canonicalValue: canonicalValue.toString(),
        canonicalUnit,
        factorOptionId: factorOption?.id ?? null,
        status: plausibility.flagged ? "FLAGGED" : "SUBMITTED",
        plausibilityFlagged: plausibility.flagged,
        dataQualityTier: input.dataQualityTier ?? dataPoint.defaultTier,
      },
    });

    return created;
  });

  const calculations = await runCalculationsForEntry(ctx, entry.id);

  return { entry, calculations, plausibility };
}

export async function runCalculationsForEntry(ctx: TenantRepositoryContext, entryId: string) {
  return prisma.$transaction(async (tx) => {
  await lockActivityEntry(tx, ctx, entryId);
  const found = await tx.activityEntry.findFirst({
    where: tenantWhere(ctx, { id: entryId }),
    include: { activityDataPoint: true, factorOption: true, site: true },
  });
  const entry = assertOwned(ctx, found);

  const dataPoint = entry.activityDataPoint;
  // The parent lock serializes first writes as well as retries. Derived Cat 3
  // companions are separate accounting rows and never primary replay results.
  const existing = await tx.calculation.findMany({
    where: { organisationId: ctx.organisationId, activityEntryId: entry.id, derivedFromCalculationId: null },
    orderBy: [{ basis: "asc" }, { id: "asc" }],
  });
  assertCompletePrimaryCalculations(existing, dataPoint.scope, dataPoint.factorCategory);
  if (existing.length) return existing;
  const inputValue = Number(entry.canonicalValue);
  const inputUnit = entry.canonicalUnit;

  type ResultRow = {
    basis: FactorBasis;
    result: ReturnType<typeof calculateEmission>;
    tierOverride: DataQualityTier | null;
  };
  let results: ResultRow[];

  try {
    if (dataPoint.scope === Scope.SCOPE_2 && dataPoint.factorCategory === "grid_electricity") {
      const contract = await findActiveEnergyContract(entry.siteId, entry.periodStart, tx);
      const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, entry.periodStart, ctx.organisationId, tx);
      if (!officialSet) {
        throw new FactorNotFoundError("No official DEFRA/DESNZ factor set is effective for this period.");
      }
      const locationFactor = await findFactorInSet(officialSet.id, dataPoint.factorCategory, null, FactorBasis.LOCATION_BASED, tx);
      const marketBasisType = selectMarketBasis(
        contract ? { regoBacked: contract.regoBacked, tariffType: contract.tariffType } : null,
      );
      const marketFactor = await findFactorInSet(
        officialSet.id,
        dataPoint.factorCategory,
        null,
        marketBasisType === "MARKET_BASED" ? FactorBasis.MARKET_BASED : FactorBasis.RESIDUAL_MIX,
        tx,
      );
      if (!locationFactor || !marketFactor) {
        // Scope 2 must always produce both figures side by side — if either
        // is missing, treat the whole entry as awaiting a factor rather
        // than publish just one of the two required bases.
        throw new FactorNotFoundError("Scope 2 requires both a location-based and a market-based/residual-mix factor.");
      }
      const dual = calculateScope2Dual(inputValue, toFactorRow(locationFactor, officialSet), toFactorRow(marketFactor, officialSet));
      results = [
        { basis: FactorBasis.LOCATION_BASED, result: dual.locationBased, tierOverride: null },
        { basis: marketFactor.basis, result: dual.marketBased, tierOverride: null },
      ];
    } else if (dataPoint.scope === Scope.SCOPE_3) {
      const resolved = await resolveFactorMultiSource(
        dataPoint.factorCategory,
        entry.factorOption?.subtypeKey ?? null,
        FactorBasis.STANDARD,
        entry.periodStart,
        ctx.organisationId,
        entry.supplierName,
        tx,
      );
      if (!resolved) {
        throw new FactorNotFoundError(
          `No emission factor available yet for "${dataPoint.factorCategory}" — import one via Admin → Emission factors.`,
        );
      }
      const result = calculateEmission(inputValue, inputUnit, toFactorRow(resolved.factor, resolved.factorSet));
      results = [{ basis: FactorBasis.STANDARD, result, tierOverride: resolved.tierOverride }];
    } else {
      const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, entry.periodStart, ctx.organisationId, tx);
      if (!officialSet) {
        throw new FactorNotFoundError("No official DEFRA/DESNZ factor set is effective for this period.");
      }
      const factor = await findFactorInSet(
        officialSet.id,
        dataPoint.factorCategory,
        entry.factorOption?.subtypeKey ?? null,
        FactorBasis.STANDARD,
        tx,
      );
      if (!factor) {
        throw new FactorNotFoundError(`No emission factor found for category="${dataPoint.factorCategory}".`);
      }
      const result = calculateEmission(inputValue, inputUnit, toFactorRow(factor, officialSet));
      results = [{ basis: FactorBasis.STANDARD, result, tierOverride: null }];
    }
  } catch (err) {
    if (err instanceof FactorNotFoundError) {
      // Flagged (plausibility) entries stay flagged — review takes
      // precedence over the "awaiting factor" state, which is otherwise
      // only relevant to SUBMITTED entries.
      if (entry.status === EntryStatus.SUBMITTED) {
        await tx.activityEntry.update({
          where: { id: entry.id, organisationId: ctx.organisationId },
          data: { status: EntryStatus.AWAITING_FACTOR },
        });
      }
      // Phase 4-i: "no figure was produced, and why" is an accounting fact
      // in its own right — recorded even when the status does not move,
      // so a FLAGGED entry with no factor is just as visible as a
      // SUBMITTED one. Missing data is never zero, and never silent.
      await recordAuditEvent(tx, ctx, {
        eventType: "calculation.awaiting_factor",
        resourceType: "activity_entry",
        resourceId: entry.id,
        summary: `No emission factor available for ${dataPoint.code} (${periodLabel(entry.periodStart, entry.periodEnd)}) — entry produces no figure yet`,
        ...auditActorFor(ctx),
        correlationId: ctx.correlationId,
        before: { status: entry.status },
        after: {
          status: entry.status === EntryStatus.SUBMITTED ? EntryStatus.AWAITING_FACTOR : entry.status,
          activityDataPointCode: dataPoint.code,
          factorCategory: dataPoint.factorCategory,
          scope: dataPoint.scope,
          siteId: entry.siteId,
          ...periodFields(entry.periodStart, entry.periodEnd),
          reason: err.message,
        },
      });
      return [];
    }
    throw err;
  }

    const calculations = [];
    for (const { basis, result, tierOverride } of results) {
      const calculation = await tx.calculation.create({
        data: {
          organisationId: ctx.organisationId,
          activityEntryId: entry.id,
          emissionFactorId: result.emissionFactorId,
          scope: dataPoint.scope,
          basis,
          scope3Category: dataPoint.scope3Category ?? null,
          inputValue: result.inputValue,
          inputUnit: result.inputUnit,
          factorValueSnapshot: result.factorValueSnapshot,
          factorUnitSnapshot: result.factorUnitSnapshot,
          factorSourceSnapshot: result.factorSourceSnapshot,
          factorVintageSnapshot: result.factorVintageSnapshot,
          formulaApplied: result.formulaApplied,
          resultKgCo2e: result.resultKgCo2e,
          dataQualityTier: tierOverride ?? entry.dataQualityTier,
          calculatedByUserId: entry.enteredByUserId,
        },
      });
      calculations.push(calculation);

      // Phase 4-i: one event per emission figure. A Scope 2 electricity
      // entry produces two (location and market/residual), so each basis
      // is separately traceable. The figure itself is identified, not
      // re-snapshotted: the Calculation row already holds the full factor
      // snapshot durably.
      await recordAuditEvent(tx, ctx, {
        eventType: "calculation.created",
        resourceType: "calculation",
        resourceId: calculation.id,
        summary: `Calculated ${dataPoint.scope}/${basis} for ${dataPoint.code} (${periodLabel(entry.periodStart, entry.periodEnd)})`,
        ...auditActorFor(ctx),
        correlationId: ctx.correlationId,
        after: {
          activityEntryId: entry.id,
          activityDataPointCode: dataPoint.code,
          siteId: entry.siteId,
          ...periodFields(entry.periodStart, entry.periodEnd),
          scope: dataPoint.scope,
          basis,
          scope3Category: dataPoint.scope3Category ?? null,
          emissionFactorId: result.emissionFactorId,
          factorSourceSnapshot: result.factorSourceSnapshot,
          factorVintageSnapshot: result.factorVintageSnapshot,
          resultKgCo2e: result.resultKgCo2e.toString(),
          dataQualityTier: tierOverride ?? entry.dataQualityTier,
        },
      });
    }

    if (entry.status === EntryStatus.AWAITING_FACTOR) {
      const recoveredStatus = entry.plausibilityFlagged ? EntryStatus.FLAGGED : EntryStatus.SUBMITTED;
      await tx.activityEntry.update({
        where: { id: entry.id, organisationId: ctx.organisationId },
        data: { status: recoveredStatus },
      });
      await recordAuditEvent(tx, ctx, {
        eventType: "activity_entry.status_changed",
        resourceType: "activity_entry",
        resourceId: entry.id,
        summary: `Entry left AWAITING_FACTOR for ${recoveredStatus} — an emission factor is now available for ${dataPoint.code}`,
        ...auditActorFor(ctx),
        correlationId: ctx.correlationId,
        before: { status: EntryStatus.AWAITING_FACTOR },
        after: { status: recoveredStatus, reason: "emission_factor_available" },
      });
    }

    return calculations;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
}

/**
 * Runs the FIRST calculation for every entry stuck at AWAITING_FACTOR,
 * scoped to a single organisation — call this right after that organisation
 * imports a new EmissionFactorSet, so any Scope 3 data collected before the
 * factor existed gets its figure the moment it's available, with no separate
 * manual step. Phase 0: one organisation's factor import must not trigger
 * recalculation of another organisation's entries, so this only ever scans
 * the importing organisation's own AWAITING_FACTOR entries — never a
 * cross-tenant fan-out. An entry not yet backfilled with an organisationId
 * (T12) is skipped, not guessed at.
 *
 * NOT a recalculation, despite the name: `runCalculationsForEntry` returns
 * early for any entry that already has primary calculations, so an existing
 * figure is never recomputed or replaced here. The name is misleading and
 * Docs/PHASE4_PREFLIGHT.md §4 records it as the root of risk R1's
 * misreading.
 *
 * ponytail: name left as `recalculatePendingEntries` in Phase 4-i — two
 * Phase 3-vi guard tests under src/lib/factors/import/__tests__/ mock this
 * export by name and are outside this phase's write boundary, so renaming
 * would silently defuse them. Rename to `backfillAwaitingFactorEntries`
 * once Phase 3-vi lands and those files can be updated in the same change.
 *
 * Phase 4-i: not period-aware. A closed-period barrier belongs to Phase
 * 4-ii; until then this remains free to give a historical entry its first
 * figure, and the batch event below is what makes that visible.
 */
export async function recalculatePendingEntries(organisationId: string) {
  const pending = await prisma.activityEntry.findMany({
    where: { status: EntryStatus.AWAITING_FACTOR, organisationId },
  });
  // One system context for the whole run, so the batch event below and
  // every per-entry event it produced share a correlationId and can be
  // read back as a single operation.
  const ctx = systemTenantRepositoryContext(organisationId, "factor-import-backfill");
  let recalculated = 0;
  let checked = 0;
  for (const entry of pending) {
    if (!entry.organisationId) continue;
    checked++;
    const calculations = await runCalculationsForEntry(ctx, entry.id);
    if (calculations.length > 0) recalculated++;
  }

  if (checked > 0) {
    await prisma.$transaction(async (tx) => {
      await recordAuditEvent(tx, ctx, {
        eventType: "calculation.backfilled",
        resourceType: "calculation",
        resourceId: null,
        summary: `Factor import backfill: ${recalculated} of ${checked} awaiting-factor entr${checked === 1 ? "y" : "ies"} produced a figure`,
        ...auditActorFor(ctx),
        correlationId: ctx.correlationId,
        // Counts only. The per-entry calculation.created and
        // calculation.awaiting_factor events on this same correlationId
        // carry every id and figure, so the batch row stays O(1) however
        // many entries the import touched.
        after: {
          trigger: "factor_set_import",
          checked,
          backfilled: recalculated,
          stillAwaitingFactor: checked - recalculated,
        },
      });
    });
  }

  return { checked, recalculated };
}

/**
 * Cat 3 (data map row S3-03) — "auto-calculated ... from Scope 1 and
 * Scope 2 activity data (well-to-tank, T&D losses)". Idempotent: the
 * unique Calculation.derivedFromCalculationId constraint means re-running
 * this for the same period never creates duplicate Cat 3 rows, so it's
 * safe to call every time a report is generated.
 */
/**
 * BD08/Checkpoint-A carried-forward fix: the explicit "Prepare reporting
 * data" step. `generateReportAction` used to call `deriveCategory3Calculations`
 * as an undisclosed side effect of building a report snapshot — generating a
 * report also silently mutated the organisation's live Scope 3 total. This
 * is now the only entry point that derives Category 3 rows; it requires the
 * same write permission/scope as report generation, and its result
 * (`skippedNoFactor`) is returned so the caller can disclose any source rows
 * that could not be derived for lack of a matching factor, rather than
 * silently omitting them. Report generation itself reads whatever Category 3
 * rows already exist and never derives new ones (see `buildReportPayload`).
 */
export async function prepareReportingData(context: OrganisationContext, periodStart: Date, periodEnd: Date) {
  requirePermission(context, "carbon.report.generate");
  const ctx = toTenantRepositoryContext(context);
  const result = await deriveCategory3Calculations(ctx, periodStart, periodEnd);

  // Phase 4-i: `skippedNoFactor` is an accounting disclosure — source rows
  // that could not be derived for lack of a factor — and is not
  // reconstructible from the per-row events, so the summary is recorded in
  // its own right.
  await prisma.$transaction(async (tx) => {
    await recordAuditEvent(tx, ctx, {
      eventType: "report_data.prepared",
      resourceType: "calculation",
      resourceId: null,
      summary: `Prepared reporting data for ${periodLabel(periodStart, periodEnd)}: ${result.created} Category 3 row(s) derived, ${result.skippedNoFactor} skipped for want of a factor`,
      ...auditActorFor(ctx),
      correlationId: ctx.correlationId,
      after: { ...periodFields(periodStart, periodEnd), ...result },
    });
  });

  return result;
}

export async function deriveCategory3Calculations(ctx: TenantRepositoryContext, periodStart: Date, periodEnd: Date) {
  const sourceCalculations = await prisma.calculation.findMany({
    where: tenantWhere(ctx, {
      activityEntry: { periodStart: { gte: periodStart, lte: periodEnd } },
      scope: { in: [Scope.SCOPE_1, Scope.SCOPE_2] },
      basis: { in: [FactorBasis.STANDARD, FactorBasis.LOCATION_BASED] },
      derivedCategory3Row: { is: null },
    }),
    include: { activityEntry: { include: { activityDataPoint: true, factorOption: true } } },
  });

  let created = 0;
  let skippedNoFactor = 0;

  for (const source of sourceCalculations) {
    const mapping = wttMappingFor(source.activityEntry.activityDataPoint.factorCategory);
    if (!mapping) continue; // no WTT/T&D companion for this category (e.g. refrigerants, purchased heat)

    const subtypeKey = mapping.keepsSubtypeKey ? (source.activityEntry.factorOption?.subtypeKey ?? null) : null;

    const resolved = await resolveFactorMultiSource(
      mapping.wttFactorCategory,
      subtypeKey,
      FactorBasis.STANDARD,
      source.activityEntry.periodStart,
      ctx.organisationId,
      null,
    );

    if (!resolved) {
      skippedNoFactor++;
      continue;
    }

    const result = calculateEmission(Number(source.inputValue), source.inputUnit, toFactorRow(resolved.factor, resolved.factorSet));

    // Phase 4-i: the derived row and its audit event commit together, per
    // row. One transaction per row keeps the existing failure semantics
    // exactly — partial progress is retained, and the unique
    // derivedFromCalculationId constraint still makes a re-run idempotent.
    await prisma.$transaction(async (tx) => {
      const derived = await tx.calculation.create({
        data: {
          organisationId: ctx.organisationId,
          activityEntryId: source.activityEntryId,
          emissionFactorId: result.emissionFactorId,
          scope: Scope.SCOPE_3,
          basis: FactorBasis.STANDARD,
          scope3Category: SCOPE3_CAT3_LABEL,
          inputValue: result.inputValue,
          inputUnit: result.inputUnit,
          factorValueSnapshot: result.factorValueSnapshot,
          factorUnitSnapshot: result.factorUnitSnapshot,
          factorSourceSnapshot: result.factorSourceSnapshot,
          factorVintageSnapshot: result.factorVintageSnapshot,
          formulaApplied: result.formulaApplied,
          resultKgCo2e: result.resultKgCo2e,
          dataQualityTier: source.dataQualityTier,
          calculatedByUserId: source.calculatedByUserId,
          derivedFromCalculationId: source.id,
        },
      });

      await recordAuditEvent(tx, ctx, {
        eventType: "calculation.created",
        resourceType: "calculation",
        resourceId: derived.id,
        summary: `Derived Category 3 companion for calculation ${source.id} (${periodLabel(source.activityEntry.periodStart, source.activityEntry.periodEnd)})`,
        ...auditActorFor(ctx),
        correlationId: ctx.correlationId,
        after: {
          activityEntryId: source.activityEntryId,
          activityDataPointCode: source.activityEntry.activityDataPoint.code,
          siteId: source.activityEntry.siteId,
          ...periodFields(source.activityEntry.periodStart, source.activityEntry.periodEnd),
          scope: Scope.SCOPE_3,
          basis: FactorBasis.STANDARD,
          scope3Category: SCOPE3_CAT3_LABEL,
          derivedFromCalculationId: source.id,
          emissionFactorId: result.emissionFactorId,
          factorSourceSnapshot: result.factorSourceSnapshot,
          factorVintageSnapshot: result.factorVintageSnapshot,
          resultKgCo2e: result.resultKgCo2e.toString(),
          dataQualityTier: source.dataQualityTier,
        },
      });
    });
    created++;
  }

  return { created, skippedNoFactor };
}

export interface CommutingSurveyResponseInput {
  factorOptionId: string;
  percentOfHeadcount: number;
  avgOneWayDistanceMiles: number;
}

export interface CreateCommutingSurveyInput {
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  headcount: number;
  commutingDaysInPeriod: number;
  enteredByUserId: string;
  responses: CommutingSurveyResponseInput[];
}

/**
 * Cat 7 (data map row S3-07). Each non-zero modal-split response becomes a
 * normal ActivityEntry + Calculation (activity-based: distance x factor),
 * so it goes through the exact same calculation/audit-trail pipeline as
 * every other entry — the survey header just keeps the raw survey inputs
 * (headcount, %, distance, commuting days) traceable in their own right.
 */
export async function createCommutingSurvey(ctx: TenantRepositoryContext, input: CreateCommutingSurveyInput) {
  const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: input.siteId }) });
  assertOwned(ctx, site);

  const dataPoint = await prisma.activityDataPoint.findUniqueOrThrow({ where: { code: "S3-07" } });

  const survey = await prisma.commutingSurvey.create({
    data: {
      organisationId: ctx.organisationId,
      siteId: input.siteId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      headcount: input.headcount,
      commutingDaysInPeriod: input.commutingDaysInPeriod,
      enteredByUserId: input.enteredByUserId,
    },
  });

  const entries = [];
  for (const r of input.responses) {
    if (r.percentOfHeadcount <= 0) continue;

    const miles = computeCommutingMiles({
      headcount: input.headcount,
      percentOfHeadcount: r.percentOfHeadcount,
      avgOneWayDistanceMiles: r.avgOneWayDistanceMiles,
      commutingDaysInPeriod: input.commutingDaysInPeriod,
    });

    const entry = await prisma.activityEntry.create({
      data: {
        organisationId: ctx.organisationId,
        activityDataPointId: dataPoint.id,
        siteId: input.siteId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        rawValue: miles,
        rawUnit: "miles",
        canonicalValue: miles,
        canonicalUnit: "miles",
        factorOptionId: r.factorOptionId,
        dataQualityTier: dataPoint.defaultTier,
        status: EntryStatus.SUBMITTED,
        notes: `From commuting survey: ${r.percentOfHeadcount}% of ${input.headcount} headcount, ${r.avgOneWayDistanceMiles} mi one-way, ${input.commutingDaysInPeriod} commuting days/period.`,
        enteredByUserId: input.enteredByUserId,
      },
    });

    await prisma.commutingSurveyResponse.create({
      data: {
        surveyId: survey.id,
        factorOptionId: r.factorOptionId,
        percentOfHeadcount: r.percentOfHeadcount,
        avgOneWayDistanceMiles: r.avgOneWayDistanceMiles,
        activityEntryId: entry.id,
      },
    });

    await runCalculationsForEntry(ctx, entry.id);
    entries.push(entry);
  }

  return { survey, entries };
}

export interface UpsertContractInput {
  siteId: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  supplierName: string;
  tariffType: TariffType;
  regoBacked: boolean;
  regoVolumeKwh?: number | null;
  source?: string;
  enteredByUserId: string;
}

export async function upsertSiteEnergyContract(ctx: TenantRepositoryContext, input: UpsertContractInput) {
  const site = await prisma.site.findFirst({ where: tenantWhere(ctx, { id: input.siteId }) });
  assertOwned(ctx, site);

  return prisma.siteEnergyContract.create({
    data: {
      organisationId: ctx.organisationId,
      siteId: input.siteId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      supplierName: input.supplierName,
      tariffType: input.tariffType,
      regoBacked: input.regoBacked,
      regoVolumeKwh: input.regoVolumeKwh ?? null,
      source: input.source,
      enteredByUserId: input.enteredByUserId,
    },
  });
}
