/**
 * Structured-output contracts for every machine-to-machine AI operation.
 *
 * Two rules this file exists to enforce:
 *
 *  1. We never ask a model for prose and then regex it. Each operation has a
 *     Zod schema, converted to JSON Schema and sent as OpenRouter's
 *     `response_format: { type: "json_schema", ... }`.
 *  2. We never trust what comes back. The provider's structured-output
 *     support is a *hint*; the Zod parse is the gate. Anything that fails
 *     validation is retried, then falls back, then returns a controlled
 *     "needs manual review" result — it is never partially used.
 *
 * Every field a model might not know is `.nullable()`, never `.optional()`:
 * an unknown value must come back as an explicit `null` that the review UI
 * can show as "missing", not as a silently absent key. That also keeps the
 * generated JSON Schema compatible with strict structured-output modes,
 * which require every property to be listed in `required`.
 */

import { z } from "zod";
import { AI_CONFIDENCE_STATES } from "./types";

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export const confidenceStateSchema = z.enum(AI_CONFIDENCE_STATES);

/** 0–1. Models are asked for a calibrated figure; the value is clamped on read. */
export const confidenceSchema = z.number().min(0).max(1);

/**
 * A short, quoted span from the source material that supports a value, so a
 * reviewer can check the claim against the document instead of taking it on
 * trust. Document text is untrusted content — it is rendered as text, never
 * as markup.
 */
export const evidenceItemSchema = z.object({
  field: z.string().max(120),
  sourceText: z.string().max(500).nullable(),
  note: z.string().max(500).nullable(),
});
export type AiEvidenceItem = z.infer<typeof evidenceItemSchema>;

export const aiConfidenceResultSchema = z.object({
  state: confidenceStateSchema,
  confidence: confidenceSchema,
  reasoningSummary: z.string().max(1000),
  requiresReview: z.boolean(),
  evidence: z.array(evidenceItemSchema).max(30),
});
export type AiConfidenceResult = z.infer<typeof aiConfidenceResultSchema>;

// ---------------------------------------------------------------------------
// Document extraction
// ---------------------------------------------------------------------------

export const documentKindSchema = z.enum([
  "ELECTRICITY_INVOICE",
  "GAS_INVOICE",
  "WATER_INVOICE",
  "FUEL_INVOICE",
  "WASTE_TRANSFER_NOTE",
  "WASTE_INVOICE",
  "TRANSPORT_RECORD",
  "SUPPLIER_DOCUMENT",
  "METER_STATEMENT",
  "OTHER",
  "UNKNOWN",
]);

const documentMetadataSchema = z.object({
  supplier: z.string().max(200).nullable(),
  accountReference: z.string().max(120).nullable(),
  invoiceNumber: z.string().max(120).nullable(),
  /** ISO date (YYYY-MM-DD) as printed on the document, or null. */
  invoiceDate: z.string().max(40).nullable(),
  billingPeriodStart: z.string().max(40).nullable(),
  billingPeriodEnd: z.string().max(40).nullable(),
  siteNameOnDocument: z.string().max(200).nullable(),
  addressOnDocument: z.string().max(400).nullable(),
});

const energySchema = z.object({
  electricityKwh: z.number().nullable(),
  /**
   * Day/night (or peak/off-peak) rates, when the bill splits them out. They
   * are transcribed separately and combined by a platform rule, not by the
   * model: this platform's grid electricity factor doesn't vary by time of
   * use, so the two lines are one entry — but only after the application has
   * checked they agree with any printed total (see document-proposals.ts).
   */
  electricityDayKwh: z.number().nullable(),
  electricityNightKwh: z.number().nullable(),
  gasKwh: z.number().nullable(),
  gasVolumeM3: z.number().nullable(),
  fuelLitres: z.number().nullable(),
  fuelType: z.string().max(120).nullable(),
  meterNumber: z.string().max(120).nullable(),
  meterReadingPrevious: z.number().nullable(),
  meterReadingCurrent: z.number().nullable(),
  /**
   * Only when the document itself states it. A "green tariff" claim that
   * isn't printed on the document must come back null — the Scope 2
   * market-based figure depends on this.
   */
  renewableTariffStated: z.boolean().nullable(),
  renewableTariffDetail: z.string().max(300).nullable(),
});

const waterSchema = z.object({
  waterConsumption: z.number().nullable(),
  waterUnit: z.string().max(40).nullable(),
  wastewaterVolume: z.number().nullable(),
  wastewaterUnit: z.string().max(40).nullable(),
});

const wasteLineSchema = z.object({
  description: z.string().max(300).nullable(),
  /** European Waste Catalogue code exactly as printed. Never inferred. */
  ewcCode: z.string().max(40).nullable(),
  weight: z.number().nullable(),
  weightUnit: z.string().max(40).nullable(),
  treatmentMethod: z.string().max(200).nullable(),
  disposalOrRecovery: z.string().max(200).nullable(),
});

const wasteSchema = z.object({
  lines: z.array(wasteLineSchema).max(50),
  carrierName: z.string().max(200).nullable(),
  carrierRegistrationNumber: z.string().max(120).nullable(),
  destinationSite: z.string().max(300).nullable(),
  transferDate: z.string().max(40).nullable(),
  wtnReference: z.string().max(120).nullable(),
});

const transportSchema = z.object({
  mode: z.string().max(120).nullable(),
  vehicleType: z.string().max(120).nullable(),
  fuelType: z.string().max(120).nullable(),
  distance: z.number().nullable(),
  distanceUnit: z.string().max(40).nullable(),
  weight: z.number().nullable(),
  weightUnit: z.string().max(40).nullable(),
  tonneKm: z.number().nullable(),
});

/**
 * What one extraction run produced. Note what is *not* here: no emission
 * factor, no kgCO2e, no scope decision that bypasses the platform's own
 * rules. Extraction transcribes a document; the deterministic engine does
 * the arithmetic afterwards, from an approved factor.
 */
export const documentExtractionResultSchema = z.object({
  documentKind: documentKindSchema,
  metadata: documentMetadataSchema,
  energy: energySchema,
  water: waterSchema,
  waste: wasteSchema,
  transport: transportSchema,
  /** Fields the document genuinely does not contain. */
  missingFields: z.array(z.string().max(120)).max(60),
  /** Anything a reviewer should look at — ambiguity, unreadable text, oddities. */
  warnings: z.array(z.string().max(400)).max(30),
  /** True when the document appears to contain instructions aimed at the AI. */
  containsSuspiciousInstructions: z.boolean(),
  overall: aiConfidenceResultSchema,
});
export type DocumentExtractionResult = z.infer<typeof documentExtractionResultSchema>;

// ---------------------------------------------------------------------------
// Assistant action planning
// ---------------------------------------------------------------------------

/**
 * What the assistant would like the application to do.
 *
 * `argumentsJson` is a *string*, not an object, and that is deliberate: every
 * tool has its own argument schema, and forcing one union type through a
 * provider's strict structured-output mode would either flatten the schemas
 * into something permissive or fail on providers that don't support unions.
 * Keeping it a string means the strict validation happens where it belongs —
 * in the tool's own Zod schema, server-side, before anything runs (see
 * src/lib/ai/tools/registry.ts).
 *
 * Nothing in this schema is an instruction. It is a request the application is
 * free to refuse, and routinely does.
 */
export const assistantActionSchema = z.object({
  tool: z.string().max(60),
  argumentsJson: z.string().max(4000),
  /** One line, for the audit trail: why this action was requested. */
  reason: z.string().max(300),
});
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const assistantPlanSchema = z.object({
  /** A first reply, used only if no action runs. */
  reply: z.string().max(4000),
  actions: z.array(assistantActionSchema).max(6),
  /** The one thing to ask when the request can't be completed as it stands. */
  clarifyingQuestion: z.string().max(500).nullable(),
});
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;

// ---------------------------------------------------------------------------
// Emission classification
// ---------------------------------------------------------------------------

export const ghgScopeSchema = z.enum(["SCOPE_1", "SCOPE_2", "SCOPE_3", "OUT_OF_SCOPE", "UNKNOWN"]);

export const emissionCategorySchema = z.enum([
  "SCOPE_1_STATIONARY_COMBUSTION",
  "SCOPE_1_MOBILE_COMBUSTION",
  "SCOPE_1_FUGITIVE",
  "SCOPE_2_PURCHASED_ELECTRICITY",
  "SCOPE_2_PURCHASED_HEAT_STEAM_COOLING",
  "SCOPE_3_CAT_1_PURCHASED_GOODS_SERVICES",
  "SCOPE_3_CAT_2_CAPITAL_GOODS",
  "SCOPE_3_CAT_3_FUEL_AND_ENERGY_RELATED",
  "SCOPE_3_CAT_4_UPSTREAM_TRANSPORT",
  "SCOPE_3_CAT_5_WASTE_GENERATED_IN_OPERATIONS",
  "SCOPE_3_CAT_6_BUSINESS_TRAVEL",
  "SCOPE_3_CAT_7_EMPLOYEE_COMMUTING",
  "SCOPE_3_CAT_8_UPSTREAM_LEASED_ASSETS",
  "SCOPE_3_CAT_9_DOWNSTREAM_TRANSPORT",
  "SCOPE_3_CAT_10_PROCESSING_OF_SOLD_PRODUCTS",
  "SCOPE_3_CAT_11_USE_OF_SOLD_PRODUCTS",
  "SCOPE_3_CAT_12_END_OF_LIFE_OF_SOLD_PRODUCTS",
  "SCOPE_3_CAT_13_DOWNSTREAM_LEASED_ASSETS",
  "SCOPE_3_CAT_14_FRANCHISES",
  "SCOPE_3_CAT_15_INVESTMENTS",
  "UNKNOWN",
]);

export const emissionClassificationResultSchema = z.object({
  scope: ghgScopeSchema,
  category: emissionCategorySchema,
  /** An ActivityDataPoint.code from the platform's own catalogue, when one clearly fits. */
  suggestedDataPointCode: z.string().max(40).nullable(),
  /** A FactorOption.subtypeKey from the catalogue offered for that data point. */
  suggestedSubtypeKey: z.string().max(80).nullable(),
  suggestedUnit: z.string().max(40).nullable(),
  alternativeCategories: z.array(emissionCategorySchema).max(5),
  missingInformation: z.array(z.string().max(300)).max(15),
  overall: aiConfidenceResultSchema,
});
export type EmissionClassificationResult = z.infer<typeof emissionClassificationResultSchema>;

// ---------------------------------------------------------------------------
// Emission factor mapping
// ---------------------------------------------------------------------------

/**
 * The model ranks candidates *we* supplied from *our* factor catalogue and
 * returns their internal IDs. It cannot invent a factor: any id not present
 * in the candidate list is discarded by the service layer before use, and a
 * factor's value is always read from the database, never from the model.
 */
export const emissionFactorSuggestionSchema = z.object({
  suggestedFactorId: z.string().max(80).nullable(),
  alternativeFactorIds: z.array(z.string().max(80)).max(5),
  /** Set when none of the supplied candidates is a defensible match. */
  noFactorFound: z.boolean(),
  reason: z.string().max(800),
  missingInformation: z.array(z.string().max(300)).max(15),
  overall: aiConfidenceResultSchema,
});
export type EmissionFactorSuggestion = z.infer<typeof emissionFactorSuggestionSchema>;

// ---------------------------------------------------------------------------
// Data quality, anomalies and missing data
// ---------------------------------------------------------------------------

export const dataQualityFindingSchema = z.object({
  kind: z.enum(["DATA_QUALITY", "MISSING_DATA", "ANOMALY", "METHODOLOGY"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  title: z.string().max(200),
  detail: z.string().max(1200),
  /** What a person should do next. Never an instruction to change a number. */
  suggestedAction: z.string().max(600).nullable(),
  /** Identifiers from the context we supplied, so a finding is traceable. */
  relatesTo: z.array(z.string().max(120)).max(20),
  confidence: confidenceSchema,
});
export type DataQualityFinding = z.infer<typeof dataQualityFindingSchema>;

export const dataQualityReviewSchema = z.object({
  findings: z.array(dataQualityFindingSchema).max(25),
  summary: z.string().max(1500),
  overall: aiConfidenceResultSchema,
});
export type DataQualityReview = z.infer<typeof dataQualityReviewSchema>;

/**
 * An anomaly the AI *proposes*. The magnitude of any change quoted back to
 * the user comes from deterministic aggregation, not from the model —
 * `observedChangePercent` is echoed from the context we supplied so the UI
 * can check the model didn't drift, and is ignored if it doesn't match.
 */
export const carbonAnomalySchema = z.object({
  subject: z.string().max(200),
  periodLabel: z.string().max(80).nullable(),
  observedChangePercent: z.number().nullable(),
  likelyExplanations: z.array(z.string().max(400)).max(6),
  checksToPerform: z.array(z.string().max(400)).max(8),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  confidence: confidenceSchema,
});
export type CarbonAnomaly = z.infer<typeof carbonAnomalySchema>;

// ---------------------------------------------------------------------------
// LCA
// ---------------------------------------------------------------------------

export const lcaRecommendationSchema = z.object({
  area: z.enum([
    "GOAL",
    "SCOPE",
    "FUNCTIONAL_UNIT",
    "REFERENCE_FLOW",
    "SYSTEM_BOUNDARY",
    "CUT_OFF",
    "ALLOCATION",
    "INVENTORY",
    "DATA_QUALITY",
    "IMPACT_ASSESSMENT",
    "INTERPRETATION",
    "SENSITIVITY",
    "REPORTING",
    "REVIEW",
  ]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
  title: z.string().max(200),
  detail: z.string().max(1500),
  /** Phrased as a question or proposal for the user to confirm — never applied automatically. */
  suggestedAction: z.string().max(800).nullable(),
  relatesTo: z.array(z.string().max(120)).max(20),
  confidence: confidenceSchema,
});
export type LcaRecommendation = z.infer<typeof lcaRecommendationSchema>;

export const lcaReviewResultSchema = z.object({
  recommendations: z.array(lcaRecommendationSchema).max(25),
  summary: z.string().max(2000),
  overall: aiConfidenceResultSchema,
});
export type LcaReviewResult = z.infer<typeof lcaReviewResultSchema>;

// ---------------------------------------------------------------------------
// JSON Schema conversion
// ---------------------------------------------------------------------------

type JsonSchemaNode = Record<string, unknown>;

/**
 * Zod renders `.nullable()` as `anyOf: [{type: T}, {type: "null"}]`. Several
 * providers' strict structured-output modes accept only the `type: [T, "null"]`
 * spelling, so collapse that specific shape. Anything more complex is left
 * exactly as Zod produced it.
 */
function collapseNullableUnions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(collapseNullableUnions);
  if (!node || typeof node !== "object") return node;

  const obj = { ...(node as JsonSchemaNode) };

  const anyOf = obj.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2) {
    const nullBranch = anyOf.find((b) => (b as JsonSchemaNode)?.type === "null");
    const valueBranch = anyOf.find((b) => (b as JsonSchemaNode)?.type !== "null") as JsonSchemaNode | undefined;
    if (nullBranch && valueBranch && typeof valueBranch.type === "string") {
      delete obj.anyOf;
      Object.assign(obj, valueBranch, { type: [valueBranch.type, "null"] });
    }
  }

  for (const [key, value] of Object.entries(obj)) {
    obj[key] = collapseNullableUnions(value);
  }
  return obj;
}

/** Converts a Zod schema into the JSON Schema body a provider expects. */
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as JsonSchemaNode;
  delete raw.$schema;
  return collapseNullableUnions(raw) as Record<string, unknown>;
}
