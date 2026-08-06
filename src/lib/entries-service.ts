import { prisma } from "@/lib/prisma";
import { DataQualityTier, EmissionFactor, EmissionFactorSet, FactorBasis, Scope, TariffType } from "@prisma/client";
import { toCanonicalUnit } from "@/lib/units";
import { calculateEmission, calculateScope2Dual, selectMarketBasis, FactorRow } from "@/lib/calc-engine";
import { checkPlausibility } from "@/lib/plausibility";

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
 * The factor set in effect for the activity *period being reported*, not
 * the moment the calculation runs — this is what keeps historical reports
 * reproducible after DEFRA/UK Gov factors update annually (brief 3.2 /
 * methodology Section 7).
 */
async function findActiveFactorSet(asOfDate: Date): Promise<EmissionFactorSet> {
  const set = await prisma.emissionFactorSet.findFirst({
    where: {
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!set) throw new Error(`No emission factor set is effective for ${asOfDate.toISOString()}`);
  return set;
}

async function findFactor(
  factorSetId: string,
  category: string,
  subtypeKey: string | null,
  basis: FactorBasis,
): Promise<EmissionFactor> {
  const factor = await prisma.emissionFactor.findFirst({
    where: { factorSetId, category, subtypeKey, basis },
  });
  if (!factor) {
    throw new Error(
      `No emission factor found for category="${category}" subtype="${subtypeKey ?? "none"}" basis=${basis} in factor set ${factorSetId}`,
    );
  }
  return factor;
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

export interface CreateEntryInput {
  activityDataPointId: string;
  siteId: string;
  periodStart: Date;
  periodEnd: Date;
  rawValue: number;
  rawUnit: string;
  factorOptionId?: string | null;
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
    throw new Error(`${dataPoint.code} is a contract-info data point, not a quantity entry`);
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
      dataQualityTier: input.dataQualityTier ?? dataPoint.defaultTier,
      status: plausibility.flagged ? "FLAGGED" : "SUBMITTED",
      plausibilityFlagged: plausibility.flagged,
      plausibilityReason: plausibility.reason,
      notes: input.notes,
      enteredByUserId: input.enteredByUserId,
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

  const factorSet = await findActiveFactorSet(entry.periodStart);
  const dataPoint = entry.activityDataPoint;
  const inputValue = Number(entry.canonicalValue);
  const inputUnit = entry.canonicalUnit;
  const results: { basis: FactorBasis; result: ReturnType<typeof calculateEmission> }[] = [];

  if (dataPoint.scope === Scope.SCOPE_2 && dataPoint.factorCategory === "grid_electricity") {
    const contract = await findActiveEnergyContract(entry.siteId, entry.periodStart);
    const locationFactor = toFactorRow(
      await findFactor(factorSet.id, dataPoint.factorCategory, null, FactorBasis.LOCATION_BASED),
      factorSet,
    );
    const marketBasisType = selectMarketBasis(
      contract ? { regoBacked: contract.regoBacked, tariffType: contract.tariffType } : null,
    );
    const marketFactor = toFactorRow(
      await findFactor(
        factorSet.id,
        dataPoint.factorCategory,
        null,
        marketBasisType === "MARKET_BASED" ? FactorBasis.MARKET_BASED : FactorBasis.RESIDUAL_MIX,
      ),
      factorSet,
    );
    const dual = calculateScope2Dual(inputValue, locationFactor, marketFactor);
    results.push({ basis: FactorBasis.LOCATION_BASED, result: dual.locationBased });
    results.push({ basis: marketFactor.basis, result: dual.marketBased });
  } else {
    const factor = toFactorRow(
      await findFactor(factorSet.id, dataPoint.factorCategory, entry.factorOption?.subtypeKey ?? null, FactorBasis.STANDARD),
      factorSet,
    );
    const result = calculateEmission(inputValue, inputUnit, factor);
    results.push({ basis: FactorBasis.STANDARD, result });
  }

  const calculations = await Promise.all(
    results.map(({ result }) =>
      prisma.calculation.create({
        data: {
          activityEntryId: entry.id,
          emissionFactorId: result.emissionFactorId,
          scope: dataPoint.scope,
          basis: result.basis,
          inputValue: result.inputValue,
          inputUnit: result.inputUnit,
          factorValueSnapshot: result.factorValueSnapshot,
          factorUnitSnapshot: result.factorUnitSnapshot,
          factorSourceSnapshot: result.factorSourceSnapshot,
          factorVintageSnapshot: result.factorVintageSnapshot,
          formulaApplied: result.formulaApplied,
          resultKgCo2e: result.resultKgCo2e,
          dataQualityTier: entry.dataQualityTier,
          calculatedByUserId: entry.enteredByUserId,
        },
      }),
    ),
  );

  return calculations;
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
