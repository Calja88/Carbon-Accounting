/**
 * Seed content for the product LCA / PCF module.
 *
 * Two kinds of thing are seeded here, and the difference matters:
 *
 *  1. The starter methodology profile. This is *configuration* — a set of
 *     methodological choices, no numbers that can change an emission figure.
 *     It is genuinely useful as delivered, though every field should be
 *     reviewed and confirmed before an assessment built on it is issued.
 *
 *  2. A placeholder life-cycle factor set, following the same pattern the
 *     corporate seed already uses (see prisma/seed/emission-factors.ts): no
 *     licensed LCI database was supplied with this build, so the platform
 *     ships representative magnitudes flagged `isPlaceholder` purely so the
 *     engine, provenance, results and reports can be exercised end to end.
 *
 * The second kind cannot leak into a reported figure. Every calculation
 * result carries the placeholder flag through to the register export and the
 * report, and the validation engine raises a hard ERROR on any assessment
 * that uses one — which blocks it from ever reaching "ready for verification".
 * Replace them by importing a real, licensed factor set through
 * Admin -> Emission factors, then reassign the affected inventory lines.
 */

import {
  FactorBasis,
  FactorSourceType,
  LcaFactorBoundary,
  PrismaClient,
  Scope,
} from "@prisma/client";
import { STARTER_METHODOLOGY_PROFILE } from "../../src/lib/lca/methodology";

const PLACEHOLDER_LCA_SET_ID = "seed-lca-factor-set-placeholder";

const PLACEHOLDER_NOTE =
  "ILLUSTRATIVE PLACEHOLDER — not a published figure and not fit for reporting. Replace with a licensed life-cycle inventory dataset or a supplier-specific footprint before use.";

interface SeedLcaFactor {
  category: string;
  subtypeKey: string | null;
  unit: string;
  co2eFactor: string;
  region: string;
  boundary: LcaFactorBoundary;
  referenceYear: number;
}

/**
 * Deliberately a short list covering one factor per category the engine
 * exercises — enough to model a product end to end, small enough that nobody
 * mistakes it for a dataset.
 */
const PLACEHOLDER_LCA_FACTORS: SeedLcaFactor[] = [
  { category: "lca_material_metal", subtypeKey: "steel_primary", unit: "kg", co2eFactor: "2.5", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_metal", subtypeKey: "aluminium_primary", unit: "kg", co2eFactor: "12", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_recycled", subtypeKey: "steel_recycled", unit: "kg", co2eFactor: "0.9", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_plastic", subtypeKey: "abs", unit: "kg", co2eFactor: "3.8", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_plastic", subtypeKey: "pet", unit: "kg", co2eFactor: "2.9", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_paper_board", subtypeKey: "corrugated_board", unit: "kg", co2eFactor: "0.8", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_material_electronics", subtypeKey: "pcb_assembled", unit: "kg", co2eFactor: "45", region: "GLO", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_packaging_material", subtypeKey: "ldpe_film", unit: "kg", co2eFactor: "2.1", region: "EU", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
  { category: "lca_electricity", subtypeKey: "grid_gb_location", unit: "kWh", co2eFactor: "0.207", region: "GB", boundary: LcaFactorBoundary.GATE_TO_GATE, referenceYear: 2024 },
  { category: "lca_electricity_upstream", subtypeKey: "grid_gb_wtt_td", unit: "kWh", co2eFactor: "0.045", region: "GB", boundary: LcaFactorBoundary.UPSTREAM, referenceYear: 2024 },
  { category: "lca_fuel_combustion", subtypeKey: "natural_gas", unit: "kWh", co2eFactor: "0.183", region: "GB", boundary: LcaFactorBoundary.COMBUSTION_ONLY, referenceYear: 2024 },
  { category: "lca_manufacturing_process", subtypeKey: "injection_moulding", unit: "kg", co2eFactor: "0.65", region: "EU", boundary: LcaFactorBoundary.GATE_TO_GATE, referenceYear: 2024 },
  { category: "lca_freight_road", subtypeKey: "hgv_average", unit: "t.km", co2eFactor: "0.107", region: "EU", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024 },
  { category: "lca_freight_rail", subtypeKey: "rail_freight", unit: "t.km", co2eFactor: "0.028", region: "EU", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024 },
  { category: "lca_freight_sea", subtypeKey: "container_ship", unit: "t.km", co2eFactor: "0.016", region: "GLO", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024 },
  { category: "lca_freight_air", subtypeKey: "air_freight_long_haul", unit: "t.km", co2eFactor: "0.6", region: "GLO", boundary: LcaFactorBoundary.WELL_TO_WHEEL, referenceYear: 2024 },
  { category: "lca_eol_landfill", subtypeKey: "mixed_waste", unit: "kg", co2eFactor: "0.45", region: "GB", boundary: LcaFactorBoundary.END_OF_LIFE, referenceYear: 2024 },
  { category: "lca_eol_recycling", subtypeKey: "mixed_recycling", unit: "kg", co2eFactor: "0.021", region: "GB", boundary: LcaFactorBoundary.END_OF_LIFE, referenceYear: 2024 },
  { category: "lca_eol_incineration", subtypeKey: "energy_from_waste", unit: "kg", co2eFactor: "0.9", region: "GB", boundary: LcaFactorBoundary.END_OF_LIFE, referenceYear: 2024 },
  { category: "lca_water_supply", subtypeKey: "mains_water", unit: "m3", co2eFactor: "0.149", region: "GB", boundary: LcaFactorBoundary.CRADLE_TO_GATE, referenceYear: 2024 },
];

export async function seedLcaMethodology(prisma: PrismaClient) {
  const profile = STARTER_METHODOLOGY_PROFILE;
  await prisma.lcaMethodologyProfile.upsert({
    where: { name_version: { name: profile.name, version: profile.version } },
    update: {},
    create: {
      name: profile.name,
      version: profile.version,
      summary: profile.summary,
      defaultBoundary: profile.defaultBoundary,
      gwpBasis: profile.gwpBasis,
      defaultAllocationMethod: profile.defaultAllocationMethod,
      allocationRules: profile.allocationRules,
      recyclingMethod: profile.recyclingMethod,
      recyclingRules: profile.recyclingRules,
      electricityApproach: profile.electricityApproach,
      electricityRules: profile.electricityRules,
      biogenicTreatment: profile.biogenicTreatment,
      biogenicRules: profile.biogenicRules,
      removalsRules: profile.removalsRules,
      offsetTreatment: profile.offsetTreatment,
      offsetRules: profile.offsetRules,
      cutOffRules: profile.cutOffRules,
      cutOffThresholdPercent: String(profile.cutOffThresholdPercent),
      factorHierarchy: [...profile.factorHierarchy],
      dataQualityRequirements: profile.dataQualityRequirements,
      minimumDataQualityScore: String(profile.minimumDataQualityScore),
      requireEvidenceForPrimary: profile.requireEvidenceForPrimary,
      standardsReferenced: [...profile.standardsReferenced],
      notes: profile.notes,
      isDefault: profile.isDefault,
    },
  });
}

export async function seedLcaPlaceholderFactors(prisma: PrismaClient) {
  const set = await prisma.emissionFactorSet.upsert({
    where: { id: PLACEHOLDER_LCA_SET_ID },
    update: {},
    create: {
      id: PLACEHOLDER_LCA_SET_ID,
      name: "Illustrative life-cycle inventory factors (PLACEHOLDER — replace with licensed data)",
      publisher: "None — placeholder values seeded with the build",
      sourceType: FactorSourceType.LCA_SECONDARY,
      vintageYear: 2024,
      effectiveFrom: new Date("2024-01-01T00:00:00.000Z"),
      isPlaceholder: true,
      notes: PLACEHOLDER_NOTE,
    },
  });

  for (const factor of PLACEHOLDER_LCA_FACTORS) {
    await prisma.emissionFactor.upsert({
      where: {
        factorSetId_category_subtypeKey_basis: {
          factorSetId: set.id,
          category: factor.category,
          subtypeKey: factor.subtypeKey ?? "",
          basis: FactorBasis.STANDARD,
        },
      },
      update: {
        unit: factor.unit,
        co2eFactor: factor.co2eFactor,
        region: factor.region,
        boundary: factor.boundary,
        referenceYear: factor.referenceYear,
        notes: PLACEHOLDER_NOTE,
      },
      create: {
        factorSetId: set.id,
        // Product life-cycle inputs are, from the assessing organisation's own
        // corporate perspective, upstream value-chain emissions.
        scope: Scope.SCOPE_3,
        category: factor.category,
        subtypeKey: factor.subtypeKey,
        basis: FactorBasis.STANDARD,
        region: factor.region,
        unit: factor.unit,
        co2eFactor: factor.co2eFactor,
        boundary: factor.boundary,
        gwpBasis: "IPCC AR6 (2021), GWP100",
        referenceYear: factor.referenceYear,
        lcaDataSource: "Placeholder — no dataset",
        notes: PLACEHOLDER_NOTE,
      },
    });
  }

  return set.id;
}

export async function seedLca(prisma: PrismaClient) {
  await seedLcaMethodology(prisma);
  await seedLcaPlaceholderFactors(prisma);
}
