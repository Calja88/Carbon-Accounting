/**
 * The model catalogue.
 *
 * Model capabilities and prices are read from the provider's own live
 * metadata (`GET https://openrouter.ai/api/v1/models`), never from a list
 * maintained by hand in this repository — a stale hard-coded list is exactly
 * how a "free-only" deployment ends up quietly calling a paid model, or how a
 * text-only model ends up being handed an invoice image.
 *
 * The classification functions below are pure and take the raw catalogue
 * entry, so they are unit-testable without network or database access.
 */

import { AiModelInfo, ModelCostClass } from "./types";
import { FREE_ROUTER_MODEL_ID } from "./config";

/** The subset of OpenRouter's model entry this application relies on. */
export interface RawCatalogModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: {
    input_modalities?: unknown;
    output_modalities?: unknown;
  } | null;
  pricing?: Record<string, unknown> | null;
  supported_parameters?: unknown;
}

/**
 * Price components that are charged for the way this application uses a
 * model. Cache-read/write and web-search prices are deliberately excluded:
 * we never enable prompt caching or the web-search plugin, so a non-zero
 * price there does not make a model cost anything on our traffic.
 */
const CHARGEABLE_PRICE_KEYS = [
  "prompt",
  "completion",
  "request",
  "image",
  "audio",
  "internal_reasoning",
  "image_output",
  "audio_output",
] as const;

/**
 * FREE / PAID / UNKNOWN from the provider's pricing metadata.
 *
 * UNKNOWN is a real answer, not a shrug: a model whose price cannot be read
 * is never treated as free, so free-only mode refuses it rather than
 * gambling.
 */
export function classifyModelCost(pricing: Record<string, unknown> | null | undefined): ModelCostClass {
  if (!pricing || typeof pricing !== "object") return "UNKNOWN";

  const present = CHARGEABLE_PRICE_KEYS.filter((k) => pricing[k] !== undefined && pricing[k] !== null);
  if (present.length === 0) return "UNKNOWN";

  for (const key of present) {
    const n = Number(pricing[key]);
    if (!Number.isFinite(n)) return "UNKNOWN";
    if (n > 0) return "PAID";
  }
  // "prompt" and "completion" are the two every text model publishes; if
  // neither is present we can't honestly call the model free.
  if (pricing.prompt === undefined || pricing.completion === undefined) return "UNKNOWN";
  return "FREE";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Maps one raw catalogue entry onto the shape the rest of the app uses. */
export function toModelInfo(raw: RawCatalogModel): AiModelInfo | null {
  if (typeof raw?.id !== "string" || raw.id.length === 0) return null;

  const inputModalities = asStringArray(raw.architecture?.input_modalities);
  const params = asStringArray(raw.supported_parameters);
  const contextLength = typeof raw.context_length === "number" ? raw.context_length : null;

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    provider: raw.id.includes("/") ? raw.id.split("/")[0] : "unknown",
    cost: classifyModelCost(raw.pricing),
    contextLength,
    supportsImages: inputModalities.includes("image"),
    supportsFiles: inputModalities.includes("file"),
    supportsStructuredOutputs: params.includes("structured_outputs"),
    supportsTools: params.includes("tools"),
  };
}

export function parseCatalog(payload: unknown): AiModelInfo[] {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.map((m) => toModelInfo(m as RawCatalogModel)).filter((m): m is AiModelInfo => m !== null);
}

/**
 * The one place a model id may be treated as free without catalogue
 * confirmation. Both rules come from OpenRouter's own documentation — the
 * `:free` suffix convention, and the free-model router — not from guesswork
 * about a particular model.
 */
export function isDocumentedFreeModelId(modelId: string): boolean {
  return modelId.endsWith(":free") || modelId === FREE_ROUTER_MODEL_ID;
}

/**
 * Is this model safe to call when free-only mode is on?
 *
 * Catalogue-confirmed FREE wins. With no catalogue entry (catalogue never
 * fetched, or the model is too new to appear), the documented `:free`
 * convention is accepted. A catalogue entry that says PAID or UNKNOWN is
 * always refused — an explicit "we can't tell" must not become "probably fine".
 */
export function isAllowedUnderFreeOnly(modelId: string, info: AiModelInfo | undefined): boolean {
  if (info) return info.cost === "FREE";
  return isDocumentedFreeModelId(modelId);
}

export interface CatalogSnapshot {
  models: AiModelInfo[];
  refreshedAt: Date | null;
  byId: Map<string, AiModelInfo>;
}

export function buildCatalogSnapshot(models: AiModelInfo[], refreshedAt: Date | null): CatalogSnapshot {
  return { models, refreshedAt, byId: new Map(models.map((m) => [m.id, m])) };
}

export const EMPTY_CATALOG: CatalogSnapshot = buildCatalogSnapshot([], null);
