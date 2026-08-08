/**
 * The adapter boundary between this platform's internal model and the
 * PACT-aligned exchange format.
 *
 * Both directions are pure functions over plain data, so both are testable
 * without a database and neither leaks the exchange format into the schema.
 */

import { LcaBoundary, LcaPcfVerificationStatus } from "@prisma/client";
import { D, Decimal, ZERO, toNumber } from "../decimal";
import { canonicalUnitSymbol, convertQuantity, IncompatibleUnitError, UnknownUnitError } from "../units";
import {
  ADAPTER_SPEC_VERSION,
  CONFORMANCE_NOTICE,
  PACT_TO_UNIT,
  UNIT_TO_PACT,
  pactProductFootprintSchema,
  type PactDeclaredUnit,
  type PactProductFootprint,
} from "./types";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportSourceAssessment {
  id: string;
  reference: string;
  title: string;
  companyName: string;
  companyIds: string[];
  productName: string;
  productDescription: string;
  productIds: string[];
  productCategoryCpc: string | null;
  version: number;
  createdAt: Date;
  issuedAt: Date | null;
  boundary: LcaBoundary;
  boundaryNotes: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  geographyCountry: string | null;
  gwpBasis: string;
  allocationRules: string | null;
  biogenicRules: string | null;
  standardsReferenced: string[];
  uncertaintyDescription: string | null;
  exemptedEmissionsPercent: number | null;
  exemptedEmissionsDescription: string | null;
  packagingIncluded: boolean;
  packagingKgCo2e: number | null;
  primaryDataSharePercent: number | null;
  dataQuality: {
    coveragePercent?: number;
    technological?: number;
    temporal?: number;
    geographical?: number;
    completeness?: number;
    reliability?: number;
  };
  verification: {
    verified: boolean;
    providerName: string | null;
    level: string | null;
    coverage: string | null;
    boundary: string | null;
    completedAt: Date | null;
    standardName: string | null;
    comments: string | null;
  } | null;
  functionalUnitQuantity: Decimal;
  functionalUnitUnit: string | null;
  results: {
    fossilKgCo2ePerFunctionalUnit: Decimal;
    biogenicEmissionsKgCo2ePerFunctionalUnit: Decimal;
    biogenicRemovalsKgCo2ePerFunctionalUnit: Decimal;
  };
  secondaryFactorSources: string[];
}

export interface PactExportOutcome {
  document: PactProductFootprint;
  /** Anything the receiving side should know that the format cannot carry. */
  notes: string[];
}

export class PactAdapterError extends Error {}

/**
 * PACT expresses everything per one declared unit from a fixed list. Where the
 * assessment's own unit is convertible into one of those, the figures are
 * converted; where it isn't (a count of items, for instance), the export fails
 * with an explanation rather than silently relabelling the unit.
 */
function resolveDeclaredUnit(unit: string | null): { declaredUnit: PactDeclaredUnit; conversion: Decimal; note: string | null } {
  if (!unit) {
    throw new PactAdapterError(
      "This assessment has no functional or declared unit, so it cannot be expressed in the exchange format.",
    );
  }
  const canonical = canonicalUnitSymbol(unit) ?? unit;

  const direct = UNIT_TO_PACT[canonical];
  if (direct) return { declaredUnit: direct, conversion: D(1), note: null };

  // Try converting into each allowed unit — e.g. a model in tonnes exports in
  // kilograms, with the figures scaled to match.
  for (const [symbol, pactUnit] of Object.entries(UNIT_TO_PACT)) {
    try {
      const factor = convertQuantity(D(1), canonical, symbol);
      return {
        declaredUnit: pactUnit,
        conversion: factor,
        note: `The assessment's unit (${canonical}) is not one the exchange format allows, so figures have been converted to ${symbol} (1 ${canonical} = ${factor.toString()} ${symbol}).`,
      };
    } catch (err) {
      if (err instanceof IncompatibleUnitError || err instanceof UnknownUnitError) continue;
      throw err;
    }
  }

  throw new PactAdapterError(
    `The exchange format only allows declared units of ${Object.values(UNIT_TO_PACT).join(", ")}. This assessment's unit is "${unit}", which cannot be converted to any of them. Export the structured JSON instead, or restate the assessment against a mass, volume, energy, area or freight unit.`,
  );
}

export function toPactFootprint(source: ExportSourceAssessment): PactExportOutcome {
  const notes: string[] = [CONFORMANCE_NOTICE];

  const { declaredUnit, conversion, note } = resolveDeclaredUnit(source.functionalUnitUnit);
  if (note) notes.push(note);

  // Emissions are per one of the assessment's own units; dividing by the
  // conversion factor restates them per one PACT declared unit.
  const scale = conversion.isZero() ? D(1) : D(1).div(conversion);
  const fossil = source.results.fossilKgCo2ePerFunctionalUnit.times(scale);
  const biogenicEmissions = source.results.biogenicEmissionsKgCo2ePerFunctionalUnit.times(scale);
  const biogenicRemovals = source.results.biogenicRemovalsKgCo2ePerFunctionalUnit.times(scale);
  const includingBiogenic = fossil.plus(biogenicEmissions).plus(biogenicRemovals);

  if (source.boundary !== LcaBoundary.CRADLE_TO_GATE) {
    notes.push(
      `This assessment's boundary is ${source.boundary.replace(/_/g, " ").toLowerCase()}. The exchange format is designed around cradle-to-gate product footprints, so the receiving system may assume a narrower boundary than the figure covers. The boundary is stated in boundaryProcessesDescription.`,
    );
  }
  if (!source.productCategoryCpc) {
    notes.push("No UN CPC product category code is recorded, so a placeholder of '0' has been sent. Record the correct code before sharing this externally.");
  }

  const document: PactProductFootprint = {
    id: source.id,
    specVersion: ADAPTER_SPEC_VERSION,
    version: source.version,
    created: (source.issuedAt ?? source.createdAt).toISOString(),
    status: "Active",
    companyName: source.companyName,
    companyIds: source.companyIds.length > 0 ? source.companyIds : [`urn:pathfinder:company:internal:${source.companyName.replace(/\s+/g, "-").toLowerCase()}`],
    productDescription: source.productDescription,
    productIds: source.productIds.length > 0 ? source.productIds : [`urn:pathfinder:product:internal:${source.reference}`],
    productCategoryCpc: source.productCategoryCpc ?? "0",
    productNameCompany: source.productName,
    comment: [source.title, source.boundaryNotes].filter(Boolean).join(" — ") || undefined,
    validityPeriodStart: source.periodStart?.toISOString(),
    validityPeriodEnd: source.periodEnd?.toISOString(),
    pcf: {
      declaredUnit,
      unitaryProductAmount: source.functionalUnitQuantity.toString(),
      pCfExcludingBiogenic: fossil.toString(),
      pCfIncludingBiogenic: includingBiogenic.toString(),
      fossilGhgEmissions: fossil.toString(),
      biogenicCarbonWithdrawal: biogenicRemovals.isZero() ? undefined : biogenicRemovals.toString(),
      otherBiogenicGhgEmissions: biogenicEmissions.isZero() ? undefined : biogenicEmissions.toString(),
      characterizationFactors: source.gwpBasis,
      crossSectoralStandardsUsed: source.standardsReferenced,
      biogenicAccountingMethodology: source.biogenicRules ?? undefined,
      boundaryProcessesDescription: [
        `Boundary: ${source.boundary.replace(/_/g, " ").toLowerCase()}.`,
        source.boundaryNotes,
      ]
        .filter(Boolean)
        .join(" "),
      referencePeriodStart: source.periodStart?.toISOString(),
      referencePeriodEnd: source.periodEnd?.toISOString(),
      geographyCountry: source.geographyCountry ?? undefined,
      secondaryEmissionFactorSources: source.secondaryFactorSources.length > 0 ? source.secondaryFactorSources : undefined,
      exemptedEmissionsPercent: source.exemptedEmissionsPercent ?? 0,
      exemptedEmissionsDescription: source.exemptedEmissionsDescription ?? undefined,
      packagingEmissionsIncluded: source.packagingIncluded,
      packagingGhgEmissions:
        source.packagingKgCo2e !== null ? D(source.packagingKgCo2e).times(scale).toString() : undefined,
      allocationRulesDescription: source.allocationRules ?? undefined,
      uncertaintyAssessmentDescription: source.uncertaintyDescription ?? undefined,
      primaryDataShare: source.primaryDataSharePercent ?? undefined,
      dqi: {
        coveragePercent: source.dataQuality.coveragePercent,
        technologicalDQR: source.dataQuality.technological,
        temporalDQR: source.dataQuality.temporal,
        geographicalDQR: source.dataQuality.geographical,
        completenessDQR: source.dataQuality.completeness,
        reliabilityDQR: source.dataQuality.reliability,
      },
      assurance: source.verification
        ? {
            assurance: source.verification.verified,
            providerName: source.verification.providerName ?? "Not stated",
            level: source.verification.level ?? undefined,
            coverage: source.verification.coverage ?? undefined,
            boundary: source.verification.boundary ?? undefined,
            completedAt: source.verification.completedAt?.toISOString(),
            standardName: source.verification.standardName ?? undefined,
            comments: source.verification.comments ?? undefined,
          }
        : undefined,
    },
  };

  return { document, notes };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedSupplierPcf {
  productName: string;
  productIdentifier: string | null;
  productCategory: string | null;
  pcfValue: string;
  pcfBiogenicValue: string | null;
  declaredUnitQuantity: string;
  declaredUnitUnit: string;
  declaredUnitDescription: string;
  boundary: LcaBoundary;
  boundaryNotes: string | null;
  methodology: string | null;
  methodologyVersion: string | null;
  gwpBasis: string | null;
  reportingPeriodStart: Date | null;
  reportingPeriodEnd: Date | null;
  geography: string | null;
  verificationStatus: LcaPcfVerificationStatus;
  verifierName: string | null;
  verificationDate: Date | null;
  primaryDataSharePercent: number | null;
  temporalScore: number | null;
  geographicalScore: number | null;
  technologicalScore: number | null;
  completenessScore: number | null;
  reliabilityScore: number | null;
  companyName: string;
  notes: string | null;
}

export interface PactImportResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  pcf: ImportedSupplierPcf | null;
  /** The document exactly as received, kept for audit. */
  raw: unknown;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Rounds a data-quality rating into the 1..5 pedigree scale this platform uses. */
function toPedigreeScore(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 5) return 5;
  return rounded;
}

export function fromPactFootprint(input: unknown): PactImportResult {
  const parsed = pactProductFootprintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "document"}: ${i.message}`),
      warnings: [],
      pcf: null,
      raw: input,
    };
  }

  const doc = parsed.data;
  const warnings: string[] = [];
  const errors: string[] = [];

  const unit = PACT_TO_UNIT[doc.pcf.declaredUnit];
  if (!unit) {
    errors.push(`Declared unit "${doc.pcf.declaredUnit}" is not one this platform can work with.`);
  }

  const pcfValue = doc.pcf.pCfExcludingBiogenic;
  if (!Number.isFinite(Number(pcfValue))) {
    errors.push(`pCfExcludingBiogenic ("${pcfValue}") is not a number.`);
  }

  if (doc.specVersion !== ADAPTER_SPEC_VERSION) {
    warnings.push(
      `The document declares specification version ${doc.specVersion}; this adapter was written against ${ADAPTER_SPEC_VERSION}. Fields this adapter does not recognise have been kept on the record but not interpreted.`,
    );
  }
  if (doc.status === "Deprecated") {
    warnings.push("The supplier has marked this footprint as deprecated. Check whether a newer version exists before relying on it.");
  }
  if (doc.pcf.exemptedEmissionsPercent && doc.pcf.exemptedEmissionsPercent > 5) {
    warnings.push(
      `The supplier reports ${doc.pcf.exemptedEmissionsPercent}% of emissions as exempted, which is a material exclusion. Record it as an assumption before relying on this figure.`,
    );
  }
  if (!doc.pcf.boundaryProcessesDescription) {
    warnings.push("The document does not describe what the boundary covers, so the figure's scope is unclear.");
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings, pcf: null, raw: input };
  }

  const assurance = doc.pcf.assurance;
  const verificationStatus = assurance?.assurance
    ? LcaPcfVerificationStatus.THIRD_PARTY_VERIFIED
    : LcaPcfVerificationStatus.SELF_DECLARED;

  const biogenicWithdrawal = doc.pcf.biogenicCarbonWithdrawal ? D(doc.pcf.biogenicCarbonWithdrawal) : ZERO;
  const otherBiogenic = doc.pcf.otherBiogenicGhgEmissions ? D(doc.pcf.otherBiogenicGhgEmissions) : ZERO;
  const biogenicTotal = biogenicWithdrawal.plus(otherBiogenic);

  return {
    ok: true,
    errors: [],
    warnings,
    pcf: {
      productName: doc.productNameCompany,
      productIdentifier: doc.productIds[0] ?? null,
      productCategory: doc.productCategoryCpc === "0" ? null : doc.productCategoryCpc,
      pcfValue: doc.pcf.pCfExcludingBiogenic,
      pcfBiogenicValue: biogenicTotal.isZero() ? null : biogenicTotal.toString(),
      declaredUnitQuantity: doc.pcf.unitaryProductAmount,
      declaredUnitUnit: unit,
      declaredUnitDescription: `${doc.pcf.unitaryProductAmount} ${doc.pcf.declaredUnit}`,
      // The exchange format is built for cradle-to-gate footprints; anything
      // else has to be read out of the boundary description, so it is recorded
      // as custom rather than assumed.
      boundary: doc.pcf.boundaryProcessesDescription?.toLowerCase().includes("grave")
        ? LcaBoundary.CUSTOM
        : LcaBoundary.CRADLE_TO_GATE,
      boundaryNotes: doc.pcf.boundaryProcessesDescription ?? null,
      methodology: doc.pcf.crossSectoralStandardsUsed?.join(", ") ?? null,
      methodologyVersion: doc.specVersion,
      gwpBasis: doc.pcf.characterizationFactors ?? null,
      reportingPeriodStart: toDate(doc.pcf.referencePeriodStart ?? doc.validityPeriodStart),
      reportingPeriodEnd: toDate(doc.pcf.referencePeriodEnd ?? doc.validityPeriodEnd),
      geography: doc.pcf.geographyCountry ?? doc.pcf.geographyRegionOrSubregion ?? null,
      verificationStatus,
      verifierName: assurance?.providerName ?? null,
      verificationDate: toDate(assurance?.completedAt),
      primaryDataSharePercent: doc.pcf.primaryDataShare ?? null,
      temporalScore: toPedigreeScore(doc.pcf.dqi?.temporalDQR),
      geographicalScore: toPedigreeScore(doc.pcf.dqi?.geographicalDQR),
      technologicalScore: toPedigreeScore(doc.pcf.dqi?.technologicalDQR),
      completenessScore: toPedigreeScore(doc.pcf.dqi?.completenessDQR),
      reliabilityScore: toPedigreeScore(doc.pcf.dqi?.reliabilityDQR),
      companyName: doc.companyName,
      notes: [doc.comment, doc.pcf.exemptedEmissionsDescription, doc.pcf.allocationRulesDescription]
        .filter(Boolean)
        .join("\n\n") || null,
    },
    raw: input,
  };
}

/** Numeric view of a document's headline figure, for previews. */
export function pactHeadlineKgCo2e(doc: PactProductFootprint): number {
  return toNumber(D(doc.pcf.pCfExcludingBiogenic));
}
