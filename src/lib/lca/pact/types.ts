/**
 * PACT-aligned product footprint exchange.
 *
 * The Partnership for Carbon Transparency publishes a data model for passing
 * product carbon footprints between companies. This module defines the
 * *internal* shape this platform exchanges in, and the adapter boundary either
 * side of it, so that:
 *
 *   - the core database never has to change to support an exchange format; and
 *   - a future revision of the external specification is a change to one
 *     adapter, not a migration.
 *
 * Honest scope statement, and it belongs in the code rather than only in a
 * release note: the field names and structure below follow the published PACT
 * data model as this implementation understands it, but no conformance testing
 * has been performed against an authoritative schema document, and none of the
 * live PACT network endpoints (authentication, /footprints, event
 * notification) are implemented. Documents produced here are described as
 * "PACT-aligned", never as conformant, and an importer is written defensively:
 * anything it does not recognise is preserved verbatim on the record rather
 * than dropped, and anything required but missing is reported rather than
 * guessed.
 */

import { z } from "zod";

/** Declared units the PACT model allows. */
export const PACT_DECLARED_UNITS = [
  "liter",
  "kilogram",
  "cubic meter",
  "kilowatt hour",
  "megajoule",
  "ton kilometer",
  "square meter",
] as const;

export type PactDeclaredUnit = (typeof PACT_DECLARED_UNITS)[number];

/** Mapping between this platform's unit symbols and PACT's declared units. */
export const UNIT_TO_PACT: Record<string, PactDeclaredUnit> = {
  l: "liter",
  kg: "kilogram",
  m3: "cubic meter",
  kWh: "kilowatt hour",
  MJ: "megajoule",
  "t.km": "ton kilometer",
  m2: "square meter",
};

export const PACT_TO_UNIT: Record<PactDeclaredUnit, string> = {
  liter: "l",
  kilogram: "kg",
  "cubic meter": "m3",
  "kilowatt hour": "kWh",
  megajoule: "MJ",
  "ton kilometer": "t.km",
  "square meter": "m2",
};

export const pactDataQualityIndicatorsSchema = z.object({
  coveragePercent: z.number().optional(),
  technologicalDQR: z.number().optional(),
  temporalDQR: z.number().optional(),
  geographicalDQR: z.number().optional(),
  completenessDQR: z.number().optional(),
  reliabilityDQR: z.number().optional(),
});

export const pactAssuranceSchema = z.object({
  assurance: z.boolean(),
  coverage: z.string().optional(),
  level: z.string().optional(),
  boundary: z.string().optional(),
  providerName: z.string(),
  completedAt: z.string().optional(),
  standardName: z.string().optional(),
  comments: z.string().optional(),
});

export const pactCarbonFootprintSchema = z.object({
  declaredUnit: z.enum(PACT_DECLARED_UNITS),
  unitaryProductAmount: z.string(),
  pCfExcludingBiogenic: z.string(),
  pCfIncludingBiogenic: z.string().optional(),
  fossilGhgEmissions: z.string(),
  fossilCarbonContent: z.string().optional(),
  biogenicCarbonContent: z.string().optional(),
  dLucGhgEmissions: z.string().optional(),
  landManagementGhgEmissions: z.string().optional(),
  otherBiogenicGhgEmissions: z.string().optional(),
  iLucGhgEmissions: z.string().optional(),
  biogenicCarbonWithdrawal: z.string().optional(),
  aircraftGhgEmissions: z.string().optional(),
  characterizationFactors: z.string().optional(),
  crossSectoralStandardsUsed: z.array(z.string()).optional(),
  productOrSectorSpecificRules: z.array(z.unknown()).optional(),
  biogenicAccountingMethodology: z.string().optional(),
  boundaryProcessesDescription: z.string().optional(),
  referencePeriodStart: z.string().optional(),
  referencePeriodEnd: z.string().optional(),
  geographyCountry: z.string().optional(),
  geographyRegionOrSubregion: z.string().optional(),
  secondaryEmissionFactorSources: z.array(z.unknown()).optional(),
  exemptedEmissionsPercent: z.number().optional(),
  exemptedEmissionsDescription: z.string().optional(),
  packagingEmissionsIncluded: z.boolean().optional(),
  packagingGhgEmissions: z.string().optional(),
  allocationRulesDescription: z.string().optional(),
  uncertaintyAssessmentDescription: z.string().optional(),
  primaryDataShare: z.number().optional(),
  dqi: pactDataQualityIndicatorsSchema.optional(),
  assurance: pactAssuranceSchema.optional(),
});

export const pactProductFootprintSchema = z.object({
  id: z.string(),
  specVersion: z.string(),
  precedingPfIds: z.array(z.string()).optional(),
  version: z.number(),
  created: z.string(),
  updated: z.string().optional(),
  status: z.enum(["Active", "Deprecated"]),
  statusComment: z.string().optional(),
  validityPeriodStart: z.string().optional(),
  validityPeriodEnd: z.string().optional(),
  companyName: z.string(),
  companyIds: z.array(z.string()),
  productDescription: z.string(),
  productIds: z.array(z.string()),
  productCategoryCpc: z.string(),
  productNameCompany: z.string(),
  comment: z.string().optional(),
  pcf: pactCarbonFootprintSchema,
  /** Anything the external document carried that this adapter does not model. */
  extensions: z.array(z.unknown()).optional(),
});

export type PactProductFootprint = z.infer<typeof pactProductFootprintSchema>;
export type PactCarbonFootprint = z.infer<typeof pactCarbonFootprintSchema>;

/** The spec version this adapter writes. */
export const ADAPTER_SPEC_VERSION = "2.2.0";

/**
 * Stated on every document produced and shown wherever an exchange document is
 * offered, so nobody downstream mistakes an aligned document for a conformant
 * one.
 */
export const CONFORMANCE_NOTICE =
  "This document follows the PACT product footprint data model as implemented by this platform. It has not been validated against an authoritative PACT schema, and this platform does not implement the PACT network API. Treat it as a structured export for exchange, not as a conformance claim.";
