/**
 * The methodology register, as structured configuration rather than prose.
 *
 * Every methodological choice that changes a number — how multi-output
 * processes are split, how recycled content and recovery are treated, which
 * electricity figure is used, whether biogenic carbon is in or out of the
 * headline, what happens to offsets, where the cut-off sits, and which factor
 * source wins — is a field the engine reads, not a paragraph someone has to
 * remember to apply. The prose fields sit alongside for the report, but they
 * never drive arithmetic on their own.
 */

import {
  LcaAllocationMethod,
  LcaBiogenicTreatment,
  LcaBoundary,
  LcaElectricityApproach,
  LcaMethodologyProfile,
  LcaOffsetTreatment,
  LcaRecyclingMethod,
} from "@prisma/client";
import { D, Decimal } from "./decimal";

/** Plain, serialisable methodology configuration handed to the engine. */
export interface MethodologyConfig {
  name: string;
  version: string;
  defaultBoundary: LcaBoundary;
  gwpBasis: string;
  defaultAllocationMethod: LcaAllocationMethod;
  allocationRules: string | null;
  recyclingMethod: LcaRecyclingMethod;
  recyclingRules: string | null;
  electricityApproach: LcaElectricityApproach;
  electricityRules: string | null;
  biogenicTreatment: LcaBiogenicTreatment;
  biogenicRules: string | null;
  removalsRules: string | null;
  offsetTreatment: LcaOffsetTreatment;
  offsetRules: string | null;
  cutOffRules: string | null;
  cutOffThresholdPercent: number | null;
  factorHierarchy: string[];
  dataQualityRequirements: string | null;
  minimumDataQualityScore: number | null;
  requireEvidenceForPrimary: boolean;
  standardsReferenced: string[];
  notes: string | null;
}

/**
 * Used when an assessment has no methodology profile attached yet. Chosen to
 * be the most conservative reading available: no allocation credit, cut-off
 * recycling (no end-of-life credits), biogenic carbon kept out of the headline
 * and offsets never netted off.
 */
export const FALLBACK_METHODOLOGY: MethodologyConfig = {
  name: "No methodology profile selected",
  version: "—",
  defaultBoundary: LcaBoundary.CRADLE_TO_GATE,
  gwpBasis: "Not stated",
  defaultAllocationMethod: LcaAllocationMethod.NONE,
  allocationRules: null,
  recyclingMethod: LcaRecyclingMethod.CUT_OFF,
  recyclingRules: null,
  electricityApproach: LcaElectricityApproach.LOCATION_BASED,
  electricityRules: null,
  biogenicTreatment: LcaBiogenicTreatment.REPORTED_SEPARATELY,
  biogenicRules: null,
  removalsRules: null,
  offsetTreatment: LcaOffsetTreatment.DISCLOSED_SEPARATELY,
  offsetRules: null,
  cutOffRules: null,
  cutOffThresholdPercent: null,
  factorHierarchy: DEFAULT_FACTOR_HIERARCHY(),
  dataQualityRequirements: null,
  minimumDataQualityScore: null,
  requireEvidenceForPrimary: false,
  standardsReferenced: [],
  notes: null,
};

/**
 * Preference order the factor resolver and the validation engine both read.
 * Strings rather than an enum so an organisation can express its own house
 * hierarchy without a schema change.
 */
export function DEFAULT_FACTOR_HIERARCHY(): string[] {
  return [
    "Supplier-specific PCF (verified)",
    "Supplier-specific PCF (unverified)",
    "Primary measured data with a sourced factor",
    "Licensed life-cycle inventory database",
    "Government / official published factors",
    "Spend-based (EEIO) screening factors",
  ];
}

export function toMethodologyConfig(profile: LcaMethodologyProfile | null | undefined): MethodologyConfig {
  if (!profile) return { ...FALLBACK_METHODOLOGY };
  return {
    name: profile.name,
    version: profile.version,
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
    cutOffThresholdPercent: profile.cutOffThresholdPercent ? Number(profile.cutOffThresholdPercent) : null,
    factorHierarchy: profile.factorHierarchy.length > 0 ? profile.factorHierarchy : DEFAULT_FACTOR_HIERARCHY(),
    dataQualityRequirements: profile.dataQualityRequirements,
    minimumDataQualityScore: profile.minimumDataQualityScore ? Number(profile.minimumDataQualityScore) : null,
    requireEvidenceForPrimary: profile.requireEvidenceForPrimary,
    standardsReferenced: profile.standardsReferenced,
    notes: profile.notes,
  };
}

/** Does this methodology allow end-of-life recovery to generate a credit? */
export function allowsAvoidedBurden(config: MethodologyConfig): boolean {
  return (
    config.recyclingMethod === LcaRecyclingMethod.AVOIDED_BURDEN ||
    config.recyclingMethod === LcaRecyclingMethod.CIRCULAR_FOOTPRINT_FORMULA
  );
}

/** Is biogenic carbon part of the headline figure, or a separate disclosure? */
export function biogenicInHeadline(config: MethodologyConfig): boolean {
  return config.biogenicTreatment === LcaBiogenicTreatment.INCLUDED_IN_TOTAL;
}

export function biogenicTracked(config: MethodologyConfig): boolean {
  return config.biogenicTreatment !== LcaBiogenicTreatment.EXCLUDED;
}

export function cutOffThreshold(config: MethodologyConfig): Decimal | null {
  return config.cutOffThresholdPercent === null ? null : D(config.cutOffThresholdPercent);
}

/**
 * Seed content for a starter methodology profile. Deliberately made of
 * *choices*, not numbers: nothing here can change an emission figure except
 * by expressing a methodological decision a human has to confirm.
 */
export const STARTER_METHODOLOGY_PROFILE = {
  name: "Group product carbon footprint methodology",
  version: "1.0 (draft)",
  summary:
    "Starter configuration for product-level assessments. Review every field with the assessment owner before an assessment built on it is issued for verification.",
  defaultBoundary: LcaBoundary.CRADLE_TO_GATE,
  gwpBasis: "IPCC AR6 (2021), GWP100, excluding climate-carbon feedbacks",
  defaultAllocationMethod: LcaAllocationMethod.MASS,
  allocationRules:
    "Where a process yields more than one saleable output, split by mass unless a physical relationship better reflects the driver of the emissions. Economic allocation is used only where outputs differ so greatly in value that a physical split would be misleading, and the rationale is recorded on the process.",
  recyclingMethod: LcaRecyclingMethod.CUT_OFF,
  recyclingRules:
    "Cut-off: recycled inputs enter the model free of the burden of their first life, and material sent for recycling at end of life earns no credit. Collection, sorting and reprocessing are still counted where they fall inside the boundary.",
  electricityApproach: LcaElectricityApproach.LOCATION_BASED,
  electricityRules:
    "Location-based grid factors for the country of manufacture are the default. A market-based figure is used only where a contractual instrument covering the production volume is held and evidenced.",
  biogenicTreatment: LcaBiogenicTreatment.REPORTED_SEPARATELY,
  biogenicRules:
    "Biogenic emissions, biogenic removals and carbon stored in the product are tracked and reported as separate lines. They are not netted against fossil emissions in the headline figure.",
  removalsRules:
    "Technological removals are recorded only where permanence and monitoring evidence is held, and are always reported separately from gross emissions.",
  offsetTreatment: LcaOffsetTreatment.DISCLOSED_SEPARATELY,
  offsetRules:
    "Purchased offsets and credits never reduce the reported product footprint. They are disclosed as a separate line with the instrument's registry reference.",
  cutOffRules:
    "An input may be excluded where it contributes less than the threshold below by both mass and estimated emissions, provided total exclusions stay under 5% of the estimated footprint. Every exclusion is entered in the exclusions register with its estimated relevance.",
  cutOffThresholdPercent: 1,
  factorHierarchy: DEFAULT_FACTOR_HIERARCHY(),
  dataQualityRequirements:
    "Primary data for the manufacturing stage. Supplier-specific footprints for inputs that make up the largest contributions, working down the hotspot ranking. Every input scored on all five data-quality dimensions before an assessment leaves internal review.",
  minimumDataQualityScore: 3,
  requireEvidenceForPrimary: true,
  standardsReferenced: [
    "ISO 14040:2006 / ISO 14044:2006 — principles and requirements for life cycle assessment",
    "ISO 14067:2018 — carbon footprint of products",
    "GHG Protocol Product Life Cycle Accounting and Reporting Standard",
  ],
  notes:
    "This profile records the choices this organisation has made. Referencing a standard here describes the approach followed; it is not a claim of conformity or certification, which only an independent verifier can give.",
  isDefault: true,
} as const;
