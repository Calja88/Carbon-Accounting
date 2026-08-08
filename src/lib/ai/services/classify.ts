/**
 * Scope 1 / 2 / 3 classification assistance.
 *
 * Deterministic first, always. `classifyDeterministically` gets the
 * description before any model does; when the platform's own rules resolve it
 * unambiguously, that is the answer and no AI call is made. The model is for
 * the ambiguous remainder, and even then it may only choose from the data
 * points and subtype keys this platform actually collects — its reply is
 * checked against the live catalogue and any invented code is discarded.
 */

import { AiTaskType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyDeterministically } from "@/lib/classification-rules";
import { AiActor } from "../authorization";
import { buildCatalogueContext } from "../carbon-context";
import { emissionClassificationResultSchema, EmissionClassificationResult } from "../schemas";
import { runStructuredTask } from "../run";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { fenceUntrusted, newFenceNonce, truncateForPrompt, untrustedContentRules } from "../untrusted";
import { formatMethodologyNotes, retrieveMethodologyNotes } from "../methodology";
import { AiConfidenceState, AiRunMetadata } from "../types";
import { AiEvidenceItem } from "../schemas";

export interface ClassifyEmissionInput {
  description: string;
  quantity?: number | null;
  unit?: string | null;
  supplierName?: string | null;
  /** Extra context, e.g. text read off an invoice. Always untrusted. */
  documentContext?: string | null;
  siteId?: string | null;
}

export interface ClassificationOutcome {
  /** Which authority produced this — a platform rule, or the AI. */
  source: "platform-rule" | "ai";
  scope: string;
  categoryLabel: string;
  dataPointCode: string | null;
  dataPointName: string | null;
  subtypeKey: string | null;
  subtypeLabel: string | null;
  suggestedUnit: string | null;
  state: AiConfidenceState;
  confidence: number;
  reasoningSummary: string;
  requiresReview: boolean;
  evidence: AiEvidenceItem[];
  alternatives: string[];
  missingInformation: string[];
  /** Codes the model returned that don't exist here — dropped, but disclosed. */
  discarded: string[];
  meta: AiRunMetadata | null;
}

/**
 * Resolves a suggested code/subtype against the live catalogue. Anything the
 * platform doesn't have is dropped: a model naming a data point that doesn't
 * exist must never reach the review screen as if it did.
 */
async function resolveAgainstCatalogue(code: string | null, subtypeKey: string | null) {
  if (!code) return { dataPoint: null, option: null, discarded: [] as string[] };

  const dataPoint = await prisma.activityDataPoint.findUnique({
    where: { code },
    include: { factorOptions: true },
  });

  if (!dataPoint) return { dataPoint: null, option: null, discarded: [code] };

  const option = subtypeKey ? dataPoint.factorOptions.find((o) => o.subtypeKey === subtypeKey) ?? null : null;
  const discarded = subtypeKey && !option ? [subtypeKey] : [];
  return { dataPoint, option, discarded };
}

export async function classifyEmission(
  actor: AiActor,
  input: ClassifyEmissionInput,
): Promise<ClassificationOutcome> {
  const combined = [input.description, input.supplierName, input.unit].filter(Boolean).join(" ");
  const deterministic = classifyDeterministically(combined);

  if (deterministic.matched) {
    const { dataPoint, option } = await resolveAgainstCatalogue(deterministic.dataPointCode, deterministic.subtypeKey);
    return {
      source: "platform-rule",
      scope: deterministic.scope,
      categoryLabel: deterministic.categoryLabel,
      dataPointCode: deterministic.dataPointCode,
      dataPointName: dataPoint?.dataPointName ?? null,
      subtypeKey: deterministic.subtypeKey,
      subtypeLabel: option?.label ?? null,
      suggestedUnit: option?.unit ?? dataPoint?.unitOptions[0] ?? null,
      state: "CONFIRMED",
      confidence: 1,
      reasoningSummary: deterministic.explanation,
      // A rule match is the platform's own answer, so it doesn't need AI
      // review — but the person entering the data still confirms it on screen.
      requiresReview: false,
      evidence: [{ field: "description", sourceText: input.description.slice(0, 300), note: "Matched a platform classification rule." }],
      alternatives: [],
      missingInformation: [],
      discarded: [],
      meta: null,
    };
  }

  const nonce = newFenceNonce();
  const catalogue = await buildCatalogueContext();
  const notes = formatMethodologyNotes(retrieveMethodologyNotes(`${combined} scope classification`, 4));

  const systemPrompt = buildSystemPrompt({
    role: [
      "Your task is to suggest which GHG Protocol scope and which of this platform's activity data points an activity belongs to.",
      "You may only choose a data point code and subtype key that appear in the catalogue below. If nothing fits, return UNKNOWN and say what is missing — do not invent a code, a category or a subtype.",
      deterministic.ambiguousBetween.length > 0
        ? `The platform's own rules matched more than one possibility (${deterministic.ambiguousBetween.join(", ")}), which is why you are being asked.`
        : "The platform's own rules did not match this description, which is why you are being asked.",
    ].join(" "),
    context: `${catalogue}\n\nRELEVANT METHODOLOGY RULES:\n${notes}`,
    outputContract: JSON_ONLY_CONTRACT,
    untrustedRules: untrustedContentRules(nonce),
  });

  const activityBlock = [
    `Description: ${input.description}`,
    input.quantity != null ? `Quantity: ${input.quantity}` : null,
    input.unit ? `Unit: ${input.unit}` : null,
    input.supplierName ? `Supplier: ${input.supplierName}` : null,
    input.documentContext ? `Additional document text:\n${truncateForPrompt(input.documentContext, 4000)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const run = await runStructuredTask<EmissionClassificationResult>({
    task: AiTaskType.EMISSION_CLASSIFICATION,
    feature: "emission-classification",
    systemPrompt,
    schema: emissionClassificationResultSchema,
    schemaName: "emission_classification_result",
    temperature: 0,
    maxOutputTokens: 1200,
    requirements: { prefersStructuredOutputs: true },
    messages: [
      {
        role: "user",
        content: `Classify this activity.\n\n${fenceUntrusted("ACTIVITY", activityBlock, nonce)}`,
      },
    ],
    audit: {
      userId: actor.userId,
      siteId: input.siteId ?? null,
      relatedType: "CLASSIFICATION",
      relatedId: null,
    },
  });

  const result = run.data;
  const { dataPoint, option, discarded } = await resolveAgainstCatalogue(
    result.suggestedDataPointCode,
    result.suggestedSubtypeKey,
  );

  return {
    source: "ai",
    scope: result.scope,
    categoryLabel: result.category,
    dataPointCode: dataPoint?.code ?? null,
    dataPointName: dataPoint?.dataPointName ?? null,
    subtypeKey: option?.subtypeKey ?? null,
    subtypeLabel: option?.label ?? null,
    suggestedUnit: option?.unit ?? dataPoint?.unitOptions[0] ?? result.suggestedUnit,
    state: result.overall.state,
    confidence: result.overall.confidence,
    reasoningSummary: result.overall.reasoningSummary,
    // AI classification is always a suggestion — nothing here is authoritative.
    requiresReview: true,
    evidence: result.overall.evidence,
    alternatives: result.alternativeCategories,
    missingInformation: result.missingInformation,
    discarded,
    meta: run.meta,
  };
}
