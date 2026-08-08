import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiLoggingLevel } from "@prisma/client";
import { AI_TASK_TYPES, DEFAULT_TASK_MODELS, FREE_ROUTER_MODEL_ID, defaultAiConfig } from "@/lib/ai/config";
import { isDocumentedFreeModelId } from "@/lib/ai/catalog";
import { claimDedupeSlot, dedupeKey, resetDedupeCache } from "@/lib/ai/rate-limit";

/**
 * Configuration defaults and the duplicate-submission guard. The important
 * property here is that a deployment with no AI environment variables set at
 * all still comes up in a safe state: free-only on, auto-accept off.
 */

const AI_ENV_KEYS = [
  "AI_ENABLED",
  "AI_OPENROUTER_ENABLED",
  "AI_FREE_ONLY",
  "AI_ALLOW_FREE_ROUTER",
  "AI_AUTO_ACCEPT_EXTRACTION",
  "AI_MIN_CONFIDENCE",
  "AI_LOGGING_LEVEL",
  "AI_RATE_LIMIT_PER_MINUTE",
  "AI_RATE_LIMIT_PER_DAY",
  "AI_REQUEST_TIMEOUT_MS",
  "AI_MAX_DOCUMENT_BYTES",
  "AI_MODEL_FALLBACK",
  "AI_MODEL_GENERAL_CHAT",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(AI_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of AI_ENV_KEYS) delete process.env[key];
  resetDedupeCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("defaultAiConfig", () => {
  it("comes up safe with no AI environment variables set", () => {
    const config = defaultAiConfig();
    expect(config.freeOnly).toBe(true);
    expect(config.autoAcceptExtraction).toBe(false);
    expect(config.aiEnabled).toBe(true);
    expect(config.loggingLevel).toBe(AiLoggingLevel.STANDARD);
    expect(config.minConfidence).toBeGreaterThan(0);
    expect(config.minConfidence).toBeLessThanOrEqual(1);
  });

  it("ships a free default model for every task, so free-only mode works out of the box", () => {
    const config = defaultAiConfig();
    for (const task of AI_TASK_TYPES) {
      expect(config.taskModels[task].modelId, task).toBeTruthy();
      expect(isDocumentedFreeModelId(config.taskModels[task].modelId), task).toBe(true);
    }
  });

  it("defaults the fallback to the free-model router, which survives a model being retired", () => {
    const config = defaultAiConfig();
    const fallbacks = AI_TASK_TYPES.map((t) => config.taskModels[t].fallbackModelId).filter(Boolean);
    expect(fallbacks.every((f) => f === FREE_ROUTER_MODEL_ID)).toBe(true);
  });

  it("lets the environment override a task's model without a code change", () => {
    process.env.AI_MODEL_GENERAL_CHAT = "vendor/other:free";
    expect(defaultAiConfig().taskModels.GENERAL_CHAT.modelId).toBe("vendor/other:free");
  });

  it("does not set a task's own model as its fallback", () => {
    process.env.AI_MODEL_FALLBACK = DEFAULT_TASK_MODELS.CARBON_REASONING;
    expect(defaultAiConfig().taskModels.CARBON_REASONING.fallbackModelId).toBeNull();
  });

  it("reads boolean and numeric settings from the environment", () => {
    process.env.AI_FREE_ONLY = "false";
    process.env.AI_ENABLED = "0";
    process.env.AI_RATE_LIMIT_PER_MINUTE = "3";
    const config = defaultAiConfig();
    expect(config.freeOnly).toBe(false);
    expect(config.aiEnabled).toBe(false);
    expect(config.requestsPerMinute).toBe(3);
  });

  it("ignores a nonsensical value rather than adopting it", () => {
    process.env.AI_MIN_CONFIDENCE = "seventeen";
    process.env.AI_RATE_LIMIT_PER_MINUTE = "-5";
    const config = defaultAiConfig();
    expect(config.minConfidence).toBe(0.7);
    expect(config.requestsPerMinute).toBe(12);
  });
});

describe("duplicate-submission guard", () => {
  it("accepts the first request and rejects an identical immediate repeat", () => {
    const key = dedupeKey("user-1", "carbon-chat", { question: "Why did emissions rise?" });
    expect(claimDedupeSlot(key)).toBe(true);
    expect(claimDedupeSlot(key)).toBe(false);
  });

  it("treats a different question, user or feature as a different request", () => {
    const base = { question: "Why did emissions rise?" };
    expect(claimDedupeSlot(dedupeKey("user-1", "carbon-chat", base))).toBe(true);
    expect(claimDedupeSlot(dedupeKey("user-2", "carbon-chat", base))).toBe(true);
    expect(claimDedupeSlot(dedupeKey("user-1", "lca-copilot", base))).toBe(true);
    expect(claimDedupeSlot(dedupeKey("user-1", "carbon-chat", { question: "Something else" }))).toBe(true);
  });

  it("produces a stable key for the same payload and leaks nothing of its content", () => {
    const a = dedupeKey("user-1", "carbon-chat", { question: "Secret supplier name" });
    const b = dedupeKey("user-1", "carbon-chat", { question: "Secret supplier name" });
    expect(a).toBe(b);
    expect(a).not.toContain("Secret");
  });
});
