/**
 * Task → model routing.
 *
 * No model name appears at a call site anywhere in this application. A caller
 * names an *AiTaskType* and the capabilities the call genuinely needs (an
 * image, say); this module turns that into an ordered list of models to try,
 * applying the free-only safeguard and the provider's own capability
 * metadata.
 *
 * Everything here is a pure function of (task, config, catalogue,
 * requirements) so the safety rules — above all "never intentionally route to
 * a paid model when free-only is on" — are unit-testable without a network or
 * a database.
 */

import { AiTaskType } from "@prisma/client";
import { AiRuntimeConfig, FREE_ROUTER_MODEL_ID } from "./config";
import { CatalogSnapshot, isAllowedUnderFreeOnly } from "./catalog";
import { AiModelInfo, AiUnavailableError } from "./types";

export interface ModelRequirements {
  /** The prompt carries an image the model must be able to see. */
  needsImages?: boolean;
  /** The prompt carries a PDF the model should ideally accept natively. */
  needsFiles?: boolean;
  /** The caller wants schema-constrained JSON where the model supports it. */
  prefersStructuredOutputs?: boolean;
}

export interface ModelCandidate {
  modelId: string;
  info: AiModelInfo | undefined;
  /**
   * Only true when the provider's metadata confirms it. When false we still
   * ask for JSON in the prompt and validate the reply with Zod — we just
   * don't claim schema enforcement we can't verify.
   */
  supportsStructuredOutputs: boolean;
  /** True when the model natively accepts file parts (rather than needing OpenRouter to parse them). */
  supportsFiles: boolean;
  isFallback: boolean;
}

export interface RoutingDecision {
  candidates: ModelCandidate[];
  /** Human-readable notes for the admin UI and audit trail. */
  notes: string[];
}

function dedupe(ids: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Builds the ordered try-list for a task.
 *
 * Throws AiUnavailableError("NO_MODEL_AVAILABLE") when nothing survives the
 * filters — which is the correct outcome, not a bug. Free-only mode with no
 * usable free model means the user is told AI is temporarily unavailable and
 * carries on entering data by hand; it never means quietly billing the
 * account for a paid model.
 */
export function resolveModelChain(
  task: AiTaskType,
  config: AiRuntimeConfig,
  catalog: CatalogSnapshot,
  requirements: ModelRequirements = {},
): RoutingDecision {
  const notes: string[] = [];
  const taskConfig = config.taskModels[task];

  const ordered = dedupe([
    taskConfig?.modelId,
    taskConfig?.fallbackModelId,
    config.allowFreeRouter ? FREE_ROUTER_MODEL_ID : null,
  ]);

  const candidates: ModelCandidate[] = [];

  for (const [index, modelId] of ordered.entries()) {
    const info = catalog.byId.get(modelId);

    if (config.freeOnly && !isAllowedUnderFreeOnly(modelId, info)) {
      notes.push(
        info
          ? `${modelId} skipped: free-only mode is on and its pricing is ${info.cost}.`
          : `${modelId} skipped: free-only mode is on and no pricing metadata is available for it.`,
      );
      continue;
    }

    // Capability gates only reject on *confirmed* incapability or on an
    // inability to confirm — we never assume a model can see an image.
    if (requirements.needsImages) {
      if (!info) {
        notes.push(`${modelId} skipped: this request needs image input and the model isn't in the cached catalogue, so its capabilities can't be confirmed.`);
        continue;
      }
      if (!info.supportsImages) {
        notes.push(`${modelId} skipped: the catalogue reports no image input support.`);
        continue;
      }
    }

    candidates.push({
      modelId,
      info,
      supportsStructuredOutputs: Boolean(requirements.prefersStructuredOutputs && info?.supportsStructuredOutputs),
      supportsFiles: Boolean(info?.supportsFiles),
      isFallback: index > 0,
    });
  }

  if (candidates.length === 0) {
    throw new AiUnavailableError(
      "NO_MODEL_AVAILABLE",
      "No suitable model is available for this task right now.",
      notes.join(" ") || `No model is configured for ${task}.`,
    );
  }

  return { candidates, notes };
}

/**
 * Which PDF-parsing engine to ask OpenRouter for.
 *
 * `mistral-ocr` is a paid add-on, so free-only mode must never select it —
 * that would be exactly the silent paid call free-only exists to prevent.
 */
export function selectPdfEngine(candidate: ModelCandidate, freeOnly: boolean): "native" | "cloudflare-ai" | "mistral-ocr" {
  if (candidate.supportsFiles) return "native";
  if (freeOnly) return "cloudflare-ai";
  return "mistral-ocr";
}
