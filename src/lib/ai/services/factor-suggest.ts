/**
 * Emission factor mapping.
 *
 * The pipeline, and why it is shaped this way:
 *
 *   activity/document → AI interprets what the activity *is*
 *                     → THIS APPLICATION queries its own factor database
 *                     → AI ranks the candidates we retrieved
 *                     → a person (or a rule) picks one
 *                     → the deterministic engine calculates
 *
 * The model never sees a factor value and never returns one. It is given a
 * shortlist of candidate rows from our catalogue — id, category, subtype,
 * unit, region, source, vintage — and asked which best fits. Any id in its
 * reply that is not in the shortlist we sent is discarded before use, so a
 * hallucinated identifier can never reach a calculation. If nothing fits, the
 * honest answer is NO FACTOR FOUND, and the platform's existing
 * AWAITING_FACTOR behaviour takes over.
 */

import { AiTaskType, FactorBasis, Prisma, Scope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AiActor } from "../authorization";
import { emissionFactorSuggestionSchema, EmissionFactorSuggestion } from "../schemas";
import { runStructuredTask } from "../run";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { fenceUntrusted, newFenceNonce, untrustedContentRules } from "../untrusted";
import { AiRunMetadata } from "../types";

export interface FactorCandidate {
  id: string;
  scope: Scope;
  category: string;
  subtypeKey: string | null;
  basis: FactorBasis;
  region: string;
  unit: string;
  /** Shown to the reviewer, never sent to the model. */
  co2eFactor: string;
  factorSetName: string;
  publisher: string;
  vintageYear: number;
  sourceType: string;
  sourceUrl: string | null;
  isPlaceholder: boolean;
  notes: string | null;
}

export interface FactorSuggestionInput {
  description: string;
  /** Restrict candidates when the platform already knows the category. */
  factorCategory?: string | null;
  scope?: Scope | null;
  unit?: string | null;
  /** The activity period — candidates are limited to factor sets effective then. */
  asOfDate?: Date | null;
  siteId?: string | null;
}

export interface FactorSuggestionOutcome {
  candidates: FactorCandidate[];
  suggestedFactorId: string | null;
  alternativeFactorIds: string[];
  noFactorFound: boolean;
  reason: string;
  confidence: number;
  state: string;
  requiresReview: boolean;
  missingInformation: string[];
  /** Ids the model returned that weren't in the shortlist we supplied. */
  discardedIds: string[];
  meta: AiRunMetadata | null;
}

const MAX_CANDIDATES = 25;

/**
 * Retrieves candidate factors from our own catalogue. This is a plain
 * database query — the shortlist is ours, not the model's.
 */
export async function findFactorCandidates(input: FactorSuggestionInput): Promise<FactorCandidate[]> {
  const asOf = input.asOfDate ?? new Date();

  const setFilter: Prisma.EmissionFactorSetWhereInput = {
    effectiveFrom: { lte: asOf },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
  };

  const where: Prisma.EmissionFactorWhereInput = { factorSet: setFilter };
  if (input.factorCategory) where.category = input.factorCategory;
  if (input.scope) where.scope = input.scope;
  if (input.unit) where.unit = input.unit;

  let rows = await prisma.emissionFactor.findMany({
    where,
    include: { factorSet: true },
    take: MAX_CANDIDATES,
    orderBy: [{ category: "asc" }, { subtypeKey: "asc" }],
  });

  // With no category hint, fall back to a keyword sweep over category and
  // subtype keys so there is still a real shortlist to rank.
  if (rows.length === 0 && !input.factorCategory) {
    const terms = input.description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3)
      .slice(0, 6);

    if (terms.length > 0) {
      rows = await prisma.emissionFactor.findMany({
        where: {
          factorSet: setFilter,
          OR: terms.flatMap((term) => [
            { category: { contains: term, mode: "insensitive" as const } },
            { subtypeKey: { contains: term, mode: "insensitive" as const } },
            { notes: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        include: { factorSet: true },
        take: MAX_CANDIDATES,
      });
    }
  }

  return rows.map((f) => ({
    id: f.id,
    scope: f.scope,
    category: f.category,
    subtypeKey: f.subtypeKey,
    basis: f.basis,
    region: f.region,
    unit: f.unit,
    co2eFactor: String(f.co2eFactor),
    factorSetName: f.factorSet.name,
    publisher: f.factorSet.publisher,
    vintageYear: f.factorSet.vintageYear,
    sourceType: f.factorSet.sourceType,
    sourceUrl: f.factorSet.sourceUrl,
    isPlaceholder: f.factorSet.isPlaceholder,
    notes: f.notes,
  }));
}

/**
 * The candidate list as the model sees it: identity and applicability only.
 * The factor *values* are withheld deliberately — the model has no legitimate
 * use for them, and not having them makes it impossible for one to be quoted
 * back as if the model had produced it.
 */
function renderCandidatesForPrompt(candidates: FactorCandidate[]): string {
  return candidates
    .map(
      (c) =>
        `- id=${c.id} | category=${c.category} | subtype=${c.subtypeKey ?? "(none)"} | unit=${c.unit} | basis=${c.basis} | region=${c.region} | source=${c.publisher} ${c.vintageYear} (${c.sourceType})${c.notes ? ` | notes: ${c.notes.slice(0, 200)}` : ""}`,
    )
    .join("\n");
}

export async function suggestEmissionFactor(
  actor: AiActor,
  input: FactorSuggestionInput,
): Promise<FactorSuggestionOutcome> {
  const candidates = await findFactorCandidates(input);

  if (candidates.length === 0) {
    return {
      candidates: [],
      suggestedFactorId: null,
      alternativeFactorIds: [],
      noFactorFound: true,
      reason:
        "NO FACTOR FOUND — this platform's emission factor catalogue holds no factor for that activity in the period requested. Import one via Admin → Emission factors; until then the entry is held as awaiting an emission factor.",
      confidence: 1,
      state: "CONFIRMED",
      requiresReview: true,
      missingInformation: [],
      discardedIds: [],
      meta: null,
    };
  }

  const nonce = newFenceNonce();
  const systemPrompt = buildSystemPrompt({
    role: [
      "Your task is to pick which of the supplied emission factor rows best matches an activity.",
      "You may only return ids that appear in the candidate list. Never invent an id, and never state or estimate a factor's numeric value — you have not been given the values and must not guess at them.",
      "Match on what the factor is *for*: its category, its subtype, its unit and its region must all be applicable to the activity. If none of the candidates genuinely applies, set noFactorFound to true and explain what would be needed.",
    ].join(" "),
    context: `CANDIDATE EMISSION FACTORS FROM THIS PLATFORM'S OWN CATALOGUE:\n${renderCandidatesForPrompt(candidates)}`,
    outputContract: JSON_ONLY_CONTRACT,
    untrustedRules: untrustedContentRules(nonce),
  });

  const activityBlock = [
    `Activity: ${input.description}`,
    input.unit ? `Unit the activity is measured in: ${input.unit}` : null,
    input.factorCategory ? `Platform factor category: ${input.factorCategory}` : null,
    input.asOfDate ? `Activity period date: ${input.asOfDate.toISOString().slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const run = await runStructuredTask<EmissionFactorSuggestion>({
    task: AiTaskType.EMISSION_CLASSIFICATION,
    feature: "factor-suggestion",
    systemPrompt,
    schema: emissionFactorSuggestionSchema,
    schemaName: "emission_factor_suggestion",
    temperature: 0,
    maxOutputTokens: 900,
    requirements: { prefersStructuredOutputs: true },
    messages: [
      { role: "user", content: `Which candidate factor fits?\n\n${fenceUntrusted("ACTIVITY", activityBlock, nonce)}` },
    ],
    audit: {
      userId: actor.userId,
      siteId: input.siteId ?? null,
      relatedType: "FACTOR_SUGGESTION",
      relatedId: null,
    },
  });

  const validIds = new Set(candidates.map((c) => c.id));
  const discardedIds: string[] = [];

  const suggested = run.data.suggestedFactorId && validIds.has(run.data.suggestedFactorId)
    ? run.data.suggestedFactorId
    : null;
  if (run.data.suggestedFactorId && !suggested) discardedIds.push(run.data.suggestedFactorId);

  const alternatives = run.data.alternativeFactorIds.filter((id) => {
    if (validIds.has(id) && id !== suggested) return true;
    if (!validIds.has(id)) discardedIds.push(id);
    return false;
  });

  const noFactorFound = run.data.noFactorFound || suggested === null;

  return {
    candidates,
    suggestedFactorId: suggested,
    alternativeFactorIds: alternatives,
    noFactorFound,
    reason: noFactorFound && suggested === null && !run.data.noFactorFound
      ? `${run.data.reason} (The suggested id was not one of the candidates supplied by this platform and has been discarded.)`
      : run.data.reason,
    confidence: run.data.overall.confidence,
    state: run.data.overall.state,
    requiresReview: true,
    missingInformation: run.data.missingInformation,
    discardedIds,
    meta: run.meta,
  };
}
