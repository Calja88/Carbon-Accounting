import { describe, expect, it } from "vitest";
import {
  classifyModelCost,
  isAllowedUnderFreeOnly,
  isDocumentedFreeModelId,
  parseCatalog,
  toModelInfo,
} from "@/lib/ai/catalog";

/**
 * The free/paid classification is the safeguard that stops a "free models
 * only" deployment quietly spending money, so it is tested against the exact
 * pricing shapes OpenRouter's catalogue actually returns — including the ones
 * where the honest answer is "we can't tell".
 */
describe("classifyModelCost", () => {
  it("classifies zero prompt and completion pricing as FREE", () => {
    expect(classifyModelCost({ prompt: "0", completion: "0" })).toBe("FREE");
  });

  it("classifies any non-zero chargeable price as PAID", () => {
    expect(classifyModelCost({ prompt: "0.00001", completion: "0.00005" })).toBe("PAID");
    expect(classifyModelCost({ prompt: "0", completion: "0", image: "0.001" })).toBe("PAID");
    expect(classifyModelCost({ prompt: "0", completion: "0", request: "0.0001" })).toBe("PAID");
  });

  it("ignores price components this application never incurs", () => {
    // Web search and prompt caching are never enabled, so a price on them
    // does not make the model cost anything on our traffic.
    expect(classifyModelCost({ prompt: "0", completion: "0", web_search: "0.01", input_cache_read: "0.000001" })).toBe(
      "FREE",
    );
  });

  it("returns UNKNOWN rather than guessing when pricing is missing or unreadable", () => {
    expect(classifyModelCost(null)).toBe("UNKNOWN");
    expect(classifyModelCost(undefined)).toBe("UNKNOWN");
    expect(classifyModelCost({})).toBe("UNKNOWN");
    expect(classifyModelCost({ prompt: "free" })).toBe("UNKNOWN");
    // Completion price absent — not enough to call it free.
    expect(classifyModelCost({ prompt: "0" })).toBe("UNKNOWN");
  });
});

describe("toModelInfo", () => {
  const raw = {
    id: "vendor/model:free",
    name: "Vendor: Model (free)",
    context_length: 128000,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["structured_outputs", "tools", "response_format"],
  };

  it("maps only capabilities the provider's own metadata confirms", () => {
    const info = toModelInfo(raw);
    expect(info).not.toBeNull();
    expect(info!.cost).toBe("FREE");
    expect(info!.supportsImages).toBe(true);
    expect(info!.supportsFiles).toBe(false);
    expect(info!.supportsStructuredOutputs).toBe(true);
    expect(info!.supportsTools).toBe(true);
    expect(info!.contextLength).toBe(128000);
    expect(info!.provider).toBe("vendor");
  });

  it("reports no capability when the metadata says nothing", () => {
    const info = toModelInfo({ id: "vendor/bare" });
    expect(info!.supportsImages).toBe(false);
    expect(info!.supportsStructuredOutputs).toBe(false);
    expect(info!.cost).toBe("UNKNOWN");
    expect(info!.contextLength).toBeNull();
  });

  it("discards an entry with no usable id", () => {
    expect(toModelInfo({ name: "no id" })).toBeNull();
  });
});

describe("parseCatalog", () => {
  it("reads the provider's list shape and drops unusable rows", () => {
    const models = parseCatalog({
      data: [{ id: "a/b", pricing: { prompt: "0", completion: "0" } }, { name: "broken" }],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("a/b");
  });

  it("returns an empty catalogue rather than throwing on a malformed payload", () => {
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog({ data: "nope" })).toEqual([]);
  });
});

describe("free-only safeguard", () => {
  it("accepts only the documented free-model conventions when there is no catalogue entry", () => {
    expect(isDocumentedFreeModelId("vendor/model:free")).toBe(true);
    expect(isDocumentedFreeModelId("openrouter/free")).toBe(true);
    expect(isDocumentedFreeModelId("anthropic/claude-sonnet-4")).toBe(false);
  });

  it("trusts a catalogue entry over the naming convention", () => {
    const paidButNamedFree = toModelInfo({
      id: "vendor/model:free",
      pricing: { prompt: "0.001", completion: "0.002" },
    })!;
    expect(isAllowedUnderFreeOnly("vendor/model:free", paidButNamedFree)).toBe(false);
  });

  it("refuses a model whose price the catalogue cannot determine", () => {
    const unknown = toModelInfo({ id: "vendor/mystery", pricing: {} })!;
    expect(isAllowedUnderFreeOnly("vendor/mystery", unknown)).toBe(false);
  });

  it("allows a catalogue-confirmed free model", () => {
    const free = toModelInfo({ id: "vendor/model", pricing: { prompt: "0", completion: "0" } })!;
    expect(isAllowedUnderFreeOnly("vendor/model", free)).toBe(true);
  });

  it("falls back to the naming convention only when the model is absent from the catalogue", () => {
    expect(isAllowedUnderFreeOnly("vendor/model:free", undefined)).toBe(true);
    expect(isAllowedUnderFreeOnly("vendor/paid-model", undefined)).toBe(false);
  });
});
