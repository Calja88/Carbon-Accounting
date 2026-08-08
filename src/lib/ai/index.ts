/**
 * The application-facing AI surface.
 *
 * Application code imports `carbonAI` and nothing else from this directory.
 * That keeps one seam between "what the product needs" and "how a model is
 * called": swapping OpenRouter for another provider, or moving a task to a
 * different model, changes files under `src/lib/ai/` and nothing else.
 *
 * The capabilities below are the platform's domain operations, not a vendor's
 * API. Each one is deterministic-first where a deterministic answer exists
 * (classification consults the platform's own rules before any model;
 * explanations are built from stored calculations; hotspots and scenario
 * deltas are computed by the LCA engine and only *interpreted* here).
 */

export { AiUnavailableError } from "./types";
export type { AiRunMetadata, AiRunResult, AiConfidenceState, AiModelInfo, ModelCostClass } from "./types";
export { getAiAvailability } from "./run";
export { resolveAiActor, AiAuthorizationError } from "./authorization";
export type { AiActor } from "./authorization";
export { getAiConfig, AI_TASK_TYPES, AI_TASK_LABELS } from "./config";

import { askCarbonAssistant } from "./services/chat";
import { classifyEmission } from "./services/classify";
import { suggestEmissionFactor, findFactorCandidates } from "./services/factor-suggest";
import { extractDocument } from "./services/extract";
import { explainCalculationInPlainEnglish } from "./services/explain";
import { analyseCarbonData } from "./services/data-quality";
import { assistLca, reviewLcaProject, interpretScenario } from "./services/lca-copilot";

/**
 * The AI provider abstraction as the rest of the application sees it.
 *
 * Deliberately *not* a class with a constructor taking a provider: the
 * provider is resolved per call from configuration (see provider-registry),
 * so an administrator changing a setting takes effect on the next request
 * without anything being re-wired or re-instantiated.
 */
export const carbonAI = {
  /** Free-text carbon assistant, grounded in the organisation's own data. */
  chat: askCarbonAssistant,
  /** Reads an uploaded invoice / Waste Transfer Note / meter statement into a reviewable structure. */
  extractDocument,
  /** Suggests scope and category — platform rules first, model only when genuinely ambiguous. */
  classifyEmission,
  /** Ranks candidate factors from *our* catalogue. Never invents one. */
  suggestEmissionFactor,
  /** The candidate shortlist itself, retrieved by ordinary database query. */
  findFactorCandidates,
  /** Restates a completed deterministic calculation in plain English. */
  explainCalculation: explainCalculationInPlainEnglish,
  /** Interprets and prioritises the deterministic data-quality scan. */
  analyseCarbonData,
  /** Contextual assistant inside one LCA project. */
  assistLCA: assistLca,
  /** Structured completeness/consistency review of an LCA study. */
  reviewLCA: reviewLcaProject,
  /** Explains a scenario result the LCA engine calculated. */
  interpretScenario,
} as const;

export type CarbonAI = typeof carbonAI;
