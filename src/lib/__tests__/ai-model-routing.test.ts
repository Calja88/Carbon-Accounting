import { describe, expect, it } from "vitest";
import { AiDataEntryMode, AiLoggingLevel, AiTaskType } from "@prisma/client";
import { buildCatalogSnapshot, toModelInfo } from "@/lib/ai/catalog";
import { resolveModelChain, selectPdfEngine } from "@/lib/ai/model-routing";
import type { AiRuntimeConfig } from "@/lib/ai/config";
import { AiUnavailableError } from "@/lib/ai/types";

/**
 * Routing is where the "never silently use a paid model" promise is either
 * kept or broken, so these tests drive it directly with hand-built configs and
 * catalogues rather than through the orchestrator.
 */

function config(overrides: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  const taskModels = Object.fromEntries(
    Object.values(AiTaskType).map((task) => [task, { modelId: "vendor/primary:free", fallbackModelId: "vendor/backup:free" }]),
  ) as AiRuntimeConfig["taskModels"];

  return {
    aiEnabled: true,
    openRouterEnabled: true,
    freeOnly: true,
    allowFreeRouter: true,
    autoAcceptExtraction: false,
    dataEntryMode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE,
    autoExtractAttachments: true,
    minConfidence: 0.7,
    loggingLevel: AiLoggingLevel.STANDARD,
    requestsPerMinute: 12,
    requestsPerDay: 300,
    timeoutMs: 30000,
    maxDocumentBytes: 1024,
    taskModels,
    ...overrides,
  };
}

function catalogue(entries: Parameters<typeof toModelInfo>[0][]) {
  return buildCatalogSnapshot(
    entries.map((e) => toModelInfo(e)).filter((m): m is NonNullable<typeof m> => m !== null),
    new Date(),
  );
}

const EMPTY = buildCatalogSnapshot([], null);

describe("resolveModelChain", () => {
  it("tries the task's model first, then its fallback, then the free router", () => {
    const decision = resolveModelChain(AiTaskType.GENERAL_CHAT, config(), EMPTY);
    expect(decision.candidates.map((c) => c.modelId)).toEqual([
      "vendor/primary:free",
      "vendor/backup:free",
      "openrouter/free",
    ]);
    expect(decision.candidates[0].isFallback).toBe(false);
    expect(decision.candidates[1].isFallback).toBe(true);
  });

  it("leaves the free router out when it is switched off", () => {
    const decision = resolveModelChain(AiTaskType.GENERAL_CHAT, config({ allowFreeRouter: false }), EMPTY);
    expect(decision.candidates.map((c) => c.modelId)).toEqual(["vendor/primary:free", "vendor/backup:free"]);
  });

  it("never routes to a paid model while free-only mode is on", () => {
    const cfg = config({
      taskModels: {
        ...config().taskModels,
        GENERAL_CHAT: { modelId: "vendor/expensive", fallbackModelId: null },
      },
      allowFreeRouter: false,
    });
    const cat = catalogue([{ id: "vendor/expensive", pricing: { prompt: "0.001", completion: "0.002" } }]);

    expect(() => resolveModelChain(AiTaskType.GENERAL_CHAT, cfg, cat)).toThrowError(AiUnavailableError);
  });

  it("fails closed rather than falling through to a paid fallback", () => {
    const cfg = config({
      taskModels: {
        ...config().taskModels,
        GENERAL_CHAT: { modelId: "vendor/free-one", fallbackModelId: "vendor/paid-one" },
      },
      allowFreeRouter: false,
    });
    const cat = catalogue([
      { id: "vendor/free-one", pricing: { prompt: "0.01", completion: "0.01" } },
      { id: "vendor/paid-one", pricing: { prompt: "0.02", completion: "0.02" } },
    ]);

    try {
      resolveModelChain(AiTaskType.GENERAL_CHAT, cfg, cat);
      throw new Error("expected the router to refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(AiUnavailableError);
      expect((err as AiUnavailableError).reason).toBe("NO_MODEL_AVAILABLE");
    }
  });

  it("allows a paid model once free-only mode is turned off", () => {
    const cfg = config({
      freeOnly: false,
      taskModels: { ...config().taskModels, GENERAL_CHAT: { modelId: "vendor/expensive", fallbackModelId: null } },
      allowFreeRouter: false,
    });
    const cat = catalogue([{ id: "vendor/expensive", pricing: { prompt: "0.001", completion: "0.002" } }]);

    const decision = resolveModelChain(AiTaskType.GENERAL_CHAT, cfg, cat);
    expect(decision.candidates.map((c) => c.modelId)).toEqual(["vendor/expensive"]);
  });

  it("refuses a model for an image request when its capabilities can't be confirmed", () => {
    // Nothing in the catalogue — capability is unknown, so it is not assumed.
    expect(() =>
      resolveModelChain(AiTaskType.DOCUMENT_VISION, config({ allowFreeRouter: false }), EMPTY, { needsImages: true }),
    ).toThrowError(AiUnavailableError);
  });

  it("skips a model the catalogue says cannot read images", () => {
    const cat = catalogue([
      { id: "vendor/primary:free", pricing: { prompt: "0", completion: "0" }, architecture: { input_modalities: ["text"] } },
      {
        id: "vendor/backup:free",
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text", "image"] },
      },
    ]);

    const decision = resolveModelChain(AiTaskType.DOCUMENT_VISION, config({ allowFreeRouter: false }), cat, {
      needsImages: true,
    });
    expect(decision.candidates.map((c) => c.modelId)).toEqual(["vendor/backup:free"]);
    expect(decision.notes.join(" ")).toContain("no image input support");
  });

  it("only claims structured-output support the catalogue confirms", () => {
    const cat = catalogue([
      {
        id: "vendor/primary:free",
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["structured_outputs"],
      },
      { id: "vendor/backup:free", pricing: { prompt: "0", completion: "0" }, supported_parameters: [] },
    ]);

    const decision = resolveModelChain(AiTaskType.EMISSION_CLASSIFICATION, config({ allowFreeRouter: false }), cat, {
      prefersStructuredOutputs: true,
    });
    expect(decision.candidates[0].supportsStructuredOutputs).toBe(true);
    expect(decision.candidates[1].supportsStructuredOutputs).toBe(false);
  });

  it("does not ask for structured output when the caller didn't want it", () => {
    const cat = catalogue([
      {
        id: "vendor/primary:free",
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["structured_outputs"],
      },
    ]);
    const decision = resolveModelChain(AiTaskType.GENERAL_CHAT, config({ allowFreeRouter: false }), cat);
    expect(decision.candidates[0].supportsStructuredOutputs).toBe(false);
  });

  it("deduplicates a model configured as both primary and fallback", () => {
    const cfg = config({
      taskModels: { ...config().taskModels, GENERAL_CHAT: { modelId: "openrouter/free", fallbackModelId: "openrouter/free" } },
    });
    const decision = resolveModelChain(AiTaskType.GENERAL_CHAT, cfg, EMPTY);
    expect(decision.candidates.map((c) => c.modelId)).toEqual(["openrouter/free"]);
  });
});

describe("selectPdfEngine", () => {
  const candidate = (supportsFiles: boolean) => ({
    modelId: "m",
    info: undefined,
    supportsStructuredOutputs: false,
    supportsFiles,
    isFallback: false,
  });

  it("uses the model's own file support when it has it", () => {
    expect(selectPdfEngine(candidate(true), true)).toBe("native");
    expect(selectPdfEngine(candidate(true), false)).toBe("native");
  });

  it("never selects the paid OCR engine while free-only mode is on", () => {
    expect(selectPdfEngine(candidate(false), true)).toBe("cloudflare-ai");
  });

  it("uses the OCR engine only when paid usage has been allowed", () => {
    expect(selectPdfEngine(candidate(false), false)).toBe("mistral-ocr");
  });
});
