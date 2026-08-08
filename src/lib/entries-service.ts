import { prisma } from "@/lib/prisma";
import {
  DataOrigin,
  DataQualityTier,
  EmissionFactor,
  EmissionFactorSet,
  EntryStatus,
  FactorBasis,
  FactorSourceType,
  Scope,
  TariffType,
} from "@prisma/client";
import { toCanonicalUnit } from "@/lib/units";
import { calculateEmission, calculateScope2Dual, selectMarketBasis, FactorRow } from "@/lib/calc-engine";
import { checkPlausibility } from "@/lib/plausibility";
import { computeCommutingMiles } from "@/lib/commuting";
import { SCOPE3_CAT3_LABEL, wttMappingFor } from "@/lib/scope3-derived";

/** Real activity data with no matching EmissionFactor (yet) — never crashes
 * a save; the entry is stored and surfaced as "awaiting emission factor"
 * (see EntryStatus.AWAITING_FACTOR) instead. */
export class FactorNotFoundError extends Error {}

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
): Promise<EmissionFactorSet | null> {
  return prisma.emissionFactorSet.findFirst({
    where: {
      sourceType,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findSupplierFactorSet(supplierName: string, asOfDate: Date): Promise<EmissionFactorSet | null> {
  return prisma.emissionFactorSet.findFirst({
    where: {
      sourceType: FactorSourceType.SUPPLIER_SPECIFIC,
      supplierName,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

async function findFactorInSet(
  factorSetId: string,
  category: string,
  subtypeKey: string | null,
  basis: FactorBasis,
): Promise<EmissionFactor | null> {
  return prisma.emissionFactor.findFirst({ where: { factorSetId, category, subtypeKey, basis } });
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
  supplierName?: string | null,
): Promise<ResolvedFactor | null> {
  if (supplierName) {
    const supplierSet = await findSupplierFactorSet(supplierName, asOfDate);
    if (supplierSet) {
      const factor =
        (await findFactorInSet(supplierSet.id, category, subtypeKey, basis)) ??
        (await findFactorInSet(supplierSet.id, category, null, basis));
      if (factor) return { factor, factorSet: supplierSet, tierOverride: DataQualityTier.TIER_1 };
    }
  }

  const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, asOfDate);
  if (officialSet) {
    const factor = await findFactorInSet(officialSet.id, category, subtypeKey, basis);
    if (factor) return { factor, factorSet: officialSet, tierOverride: null };
  }

  const eeioSet = await findFactorSet(FactorSourceType.EEIO_SPEND_BASED, asOfDate);
  if (eeioSet) {
    const factor = await findFactorInSet(eeioSet.id, category, subtypeKey, basis);
    if (factor) return { factor, factorSet: eeioSet, tierOverride: null };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Factor resolution preflight
// ---------------------------------------------------------------------------

export interface ResolvedFactorPreview {
  id: string;
  label: string;
  unit: string;
  basis: FactorBasis;
  co2eFactor: number;
  factorSetName: string;
  publisher: string;
  vintageYear: number;
  isPlaceholder: boolean;
}

export interface FactorResolutionPreview {
  /** At least one factor resolved through the normal resolution order. */
  resolved: boolean;
  /**
   * More than one factor could apply and nothing in the entry chooses between
   * them — a sub-type is needed. Distinct from "not resolved": the platform
   * has factors, it just can't tell which one this activity is.
   */
  ambiguous: boolean;
  /** The factor's unit matches the canonical unit this entry would be stored in. */
  unitCompatible: boolean;
  canonicalUnit: string | null;
  reason: string | null;
  /** Everything that would be applied — two rows for Scope 2's dual reporting. */
  factors: ResolvedFactorPreview[];
  /** Sub-types available when the answer is ambiguous, for the question to ask. */
  candidateSubtypeKeys: string[];
}

function toPreview(factor: EmissionFactor, factorSet: EmissionFactorSet): ResolvedFactorPreview {
  return {
    id: factor.id,
    label: `${factorSet.name} — ${factor.category}${factor.subtypeKey ? ` / ${factor.subtypeKey}` : ""} (${factor.basis})`,
    unit: factor.unit,
    basis: factor.basis,
    co2eFactor: Number(factor.co2eFactor),
    factorSetName: factorSet.name,
    publisher: factorSet.publisher,
    vintageYear: factorSet.vintageYear,
    isPlaceholder: factorSet.isPlaceholder,
  };
}

const NOT_RESOLVED = (reason: string): FactorResolutionPreview => ({
  resolved: false,
  ambiguous: false,
  unitCompatible: false,
  canonicalUnit: null,
  reason,
  factors: [],
  candidateSubtypeKeys: [],
});

/**
 * Answers "would this entry calculate?" without creating anything.
 *
 * It walks the *same* resolution order `runCalculationsForEntry` walks —
 * supplier-specific, then official, then EEIO; both bases for Scope 2 — so an
 * automatic entry is only ever created when the real calculation is already
 * known to succeed. Anything else would leave AWAITING_FACTOR rows behind that
 * nobody asked for.
 *
 * It is also where "several plausible factors" is detected: a category holding
 * factors under more than one sub-type, with no sub-type chosen, is ambiguous
 * rather than resolvable, and the auto-log engine treats it as a question to
 * ask rather than a choice to make.
 */
export async function previewFactorResolution(input: {
  factorCategory: string;
  scope: Scope;
  subtypeKey: string | null;
  rawValue: number;
  rawUnit: string;
  periodStart: Date;
  siteId: string;
  supplierName?: string | null;
}): Promise<FactorResolutionPreview> {
  let canonicalUnit: string;
  try {
    canonicalUnit = toCanonicalUnit(input.factorCategory, input.rawValue, input.rawUnit).unit;
  } catch {
    return NOT_RESOLVED(`"${input.rawUnit}" can't be converted to the unit this platform stores for ${input.factorCategory}.`);
  }

  const finish = (factors: ResolvedFactorPreview[], reason: string | null): FactorResolutionPreview => ({
    resolved: factors.length > 0,
    ambiguous: false,
    unitCompatible: factors.length > 0 && factors.every((f) => f.unit === canonicalUnit),
    canonicalUnit,
    reason,
    factors,
    candidateSubtypeKeys: [],
  });

  if (input.scope === Scope.SCOPE_2 && input.factorCategory === "grid_electricity") {
    const contract = await findActiveEnergyContract(input.siteId, input.periodStart);
    const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, input.periodStart);
    if (!officialSet) {
      return NOT_RESOLVED("No official DEFRA/DESNZ factor set is effective for this period.");
    }
    const locationFactor = await findFactorInSet(officialSet.id, input.factorCategory, null, FactorBasis.LOCATION_BASED);
    const marketBasisType = selectMarketBasis(
      contract ? { regoBacked: contract.regoBacked, tariffType: contract.tariffType } : null,
    );
    const marketFactor = await findFactorInSet(
      officialSet.id,
      input.factorCategory,
      null,
      marketBasisType === "MARKET_BASED" ? FactorBasis.MARKET_BASED : FactorBasis.RESIDUAL_MIX,
    );
    if (!locationFactor || !marketFactor) {
      return NOT_RESOLVED(
        "Scope 2 needs both a location-based and a market-based/residual-mix factor, and one of them is missing for this period.",
      );
    }
    return finish(
      [toPreview(locationFactor, officialSet), toPreview(marketFactor, officialSet)],
      "Scope 2 is reported on both bases, so both factors were resolved.",
    );
  }

  const basis = FactorBasis.STANDARD;
  const resolved =
    input.scope === Scope.SCOPE_3
      ? await resolveFactorMultiSource(input.factorCategory, input.subtypeKey, basis, input.periodStart, input.supplierName)
      : await (async () => {
          const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, input.periodStart);
          if (!officialSet) return null;
          const factor = await findFactorInSet(officialSet.id, input.factorCategory, input.subtypeKey, basis);
          return factor ? { factor, factorSet: officialSet, tierOverride: null } : null;
        })();

  if (!resolved) {
    // Nothing matched. If the category holds factors under sub-types and this
    // entry names none, that is ambiguity, not absence — and the honest answer
    // is a question rather than "no factor available".
    const subtyped = await prisma.emissionFactor.findMany({
      where: {
        category: input.factorCategory,
        subtypeKey: { not: null },
        factorSet: {
          effectiveFrom: { lte: input.periodStart },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.periodStart } }],
        },
      },
      select: { subtypeKey: true },
      distinct: ["subtypeKey"],
      take: 12,
    });

    const keys = subtyped.map((s) => s.subtypeKey).filter((k): k is string => Boolean(k));
    if (!input.subtypeKey && keys.length > 1) {
      return {
        resolved: false,
        ambiguous: true,
        unitCompatible: false,
        canonicalUnit,
        reason: `More than one factor could apply for "${input.factorCategory}" and no type was determined.`,
        factors: [],
        candidateSubtypeKeys: keys,
      };
    }

    return NOT_RESOLVED(
      `No emission factor is available for "${input.factorCategory}"${input.subtypeKey ? ` / "${input.subtypeKey}"` : ""} in a factor set effective for this period.`,
    );
  }

  return finish([toPreview(resolved.factor, resolved.factorSet)], null);
}

async function findActiveEnergyContract(siteId: string, asOfDate: Date) {
  return prisma.siteEnergyContract.findFirst({
    where: {
      siteId,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

/**
 * Where a row came from, written *with* the row rather than patched on
 * afterwards.
 *
 * `aiIdempotencyKey` in particular has to be part of the insert: it is backed
 * by a unique constraint, and a key applied in a second statement leaves a
 * window in which two concurrent requests both create an entry before either
 * claims the key. Everything else here travels with it so a row is never
 * briefly visible without its provenance.
 */
export interface EntryProvenanceInput {
  dataOrigin?: DataOrigin;
  sourceDocumentId?: string | null;
  acceptedFromExtractionId?: string | null;
  /** True only when the platform's own auto-log checks cleared this write. */
  autoLogged?: boolean;
  aiIdempotencyKey?: string | null;
  aiInteractionId?: string | null;
}

export interface CreateEntryInput extends EntryProvenanceInput {
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

export async function createActivityEntryWithCalculations(input: CreateEntryInput) {
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
    where: {
      activityDataPointId: dataPoint.id,
      siteId: input.siteId,
      factorOptionId: factorOption?.id ?? null,
      periodStart: { lt: input.periodStart },
    },
    orderBy: { periodStart: "desc" },
  });

  const plausibility = checkPlausibility(canonicalValue, previous ? Number(previous.canonicalValue) : null);

  const entry = await prisma.activityEntry.create({
    data: {
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
      dataOrigin: input.dataOrigin ?? DataOrigin.USER_ENTERED,
      sourceDocumentId: input.sourceDocumentId ?? null,
      acceptedFromExtractionId: input.acceptedFromExtractionId ?? null,
      autoLogged: input.autoLogged ?? false,
      aiIdempotencyKey: input.aiIdempotencyKey ?? null,
      aiInteractionId: input.aiInteractionId ?? null,
    },
  });

  const calculations = await runCalculationsForEntry(entry.id);

  return { entry, calculations, plausibility };
}

export async function runCalculationsForEntry(entryId: string) {
  const entry = await prisma.activityEntry.findUniqueOrThrow({
    where: { id: entryId },
    include: { activityDataPoint: true, factorOption: true, site: true },
  });

  const dataPoint = entry.activityDataPoint;
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
      const contract = await findActiveEnergyContract(entry.siteId, entry.periodStart);
      const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, entry.periodStart);
      if (!officialSet) {
        throw new FactorNotFoundError("No official DEFRA/DESNZ factor set is effective for this period.");
      }
      const locationFactor = await findFactorInSet(officialSet.id, dataPoint.factorCategory, null, FactorBasis.LOCATION_BASED);
      const marketBasisType = selectMarketBasis(
        contract ? { regoBacked: contract.regoBacked, tariffType: contract.tariffType } : null,
      );
      const marketFactor = await findFactorInSet(
        officialSet.id,
        dataPoint.factorCategory,
        null,
        marketBasisType === "MARKET_BASED" ? FactorBasis.MARKET_BASED : FactorBasis.RESIDUAL_MIX,
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
        entry.supplierName,
      );
      if (!resolved) {
        throw new FactorNotFoundError(
          `No emission factor available yet for "${dataPoint.factorCategory}" — import one via Admin → Emission factors.`,
        );
      }
      const result = calculateEmission(inputValue, inputUnit, toFactorRow(resolved.factor, resolved.factorSet));
      results = [{ basis: FactorBasis.STANDARD, result, tierOverride: resolved.tierOverride }];
    } else {
      const officialSet = await findFactorSet(FactorSourceType.OFFICIAL_DEFRA_DESNZ, entry.periodStart);
      if (!officialSet) {
        throw new FactorNotFoundError("No official DEFRA/DESNZ factor set is effective for this period.");
      }
      const factor = await findFactorInSet(
        officialSet.id,
        dataPoint.factorCategory,
        entry.factorOption?.subtypeKey ?? null,
        FactorBasis.STANDARD,
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
        await prisma.activityEntry.update({ where: { id: entry.id }, data: { status: EntryStatus.AWAITING_FACTOR } });
      }
      return [];
    }
    throw err;
  }

  const calculations = await Promise.all(
    results.map(({ basis, result, tierOverride }) =>
      prisma.calculation.create({
        data: {
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
      }),
    ),
  );

  if (entry.status === EntryStatus.AWAITING_FACTOR) {
    await prisma.activityEntry.update({
      where: { id: entry.id },
      data: { status: entry.plausibilityFlagged ? EntryStatus.FLAGGED : EntryStatus.SUBMITTED },
    });
  }

  return calculations;
}

/**
 * Re-runs calculation for every entry stuck at AWAITING_FACTOR — call this
 * right after a new EmissionFactorSet is imported so any Scope 3 data
 * collected before the factor existed gets its figure the moment it's
 * available, with no separate manual step.
 */
export async function recalculatePendingEntries() {
  const pending = await prisma.activityEntry.findMany({ where: { status: EntryStatus.AWAITING_FACTOR } });
  let recalculated = 0;
  for (const entry of pending) {
    const calculations = await runCalculationsForEntry(entry.id);
    if (calculations.length > 0) recalculated++;
  }
  return { checked: pending.length, recalculated };
}

/**
 * Cat 3 (data map row S3-03) — "auto-calculated ... from Scope 1 and
 * Scope 2 activity data (well-to-tank, T&D losses)". Idempotent: the
 * unique Calculation.derivedFromCalculationId constraint means re-running
 * this for the same period never creates duplicate Cat 3 rows, so it's
 * safe to call every time a report is generated.
 */
export async function deriveCategory3Calculations(periodStart: Date, periodEnd: Date) {
  const sourceCalculations = await prisma.calculation.findMany({
    where: {
      activityEntry: { periodStart: { gte: periodStart, lte: periodEnd } },
      scope: { in: [Scope.SCOPE_1, Scope.SCOPE_2] },
      basis: { in: [FactorBasis.STANDARD, FactorBasis.LOCATION_BASED] },
      derivedCategory3Row: { is: null },
    },
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
      null,
    );

    if (!resolved) {
      skippedNoFactor++;
      continue;
    }

    const result = calculateEmission(Number(source.inputValue), source.inputUnit, toFactorRow(resolved.factor, resolved.factorSet));

    await prisma.calculation.create({
      data: {
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
export async function createCommutingSurvey(input: CreateCommutingSurveyInput) {
  const dataPoint = await prisma.activityDataPoint.findUniqueOrThrow({ where: { code: "S3-07" } });

  const survey = await prisma.commutingSurvey.create({
    data: {
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

    await runCalculationsForEntry(entry.id);
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

export async function upsertSiteEnergyContract(input: UpsertContractInput) {
  return prisma.siteEnergyContract.create({
    data: {
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
