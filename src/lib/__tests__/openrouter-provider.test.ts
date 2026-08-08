import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterProvider, scrubSecrets } from "@/lib/ai/providers/openrouter";
import { AiProviderError } from "@/lib/ai/types";

/**
 * Every request here goes through an injected fetch. Nothing in this suite
 * reaches OpenRouter, so the tests consume no quota and no credit — which is
 * also why the provider takes a `fetchImpl` at all.
 */

const FAKE_KEY = "sk-or-v1-test-not-a-real-key-000000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function completionBody(text: string) {
  return {
    id: "gen-1",
    model: "vendor/model:free",
    choices: [{ message: { content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0 },
  };
}

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("OpenRouterProvider.complete", () => {
  it("sends the key as a bearer header and never in the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(completionBody("hello")));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.complete({
      modelId: "vendor/model:free",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5000,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.body).not.toContain(FAKE_KEY);
  });

  it("returns the text, the model that actually answered, and provider-reported usage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ...completionBody("answer"), model: "vendor/fallback:free" }),
    );
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const response = await provider.complete({
      modelId: "vendor/model:free",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5000,
    });

    expect(response.text).toBe("answer");
    expect(response.modelUsed).toBe("vendor/fallback:free");
    expect(response.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120, costUsd: 0 });
  });

  it("reports no cost rather than inventing one when the provider doesn't give it", async () => {
    const body = completionBody("answer");
    delete (body.usage as { cost?: number }).cost;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const response = await provider.complete({
      modelId: "vendor/model:free",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5000,
    });

    expect(response.usage?.costUsd).toBeNull();
  });

  it("sends a strict json_schema response format when one is supplied", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(completionBody("{}")));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.complete({
      modelId: "vendor/model:free",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5000,
      jsonSchema: { name: "result", schema: { type: "object", properties: {} } },
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("result");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("attaches an image to the last user message as a data URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(completionBody("{}")));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.complete({
      modelId: "vendor/vision:free",
      messages: [{ role: "user", content: "read this" }],
      attachments: [{ kind: "image", filename: "bill.png", mimeType: "image/png", base64: "QUJD" }],
      timeoutMs: 5000,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "read this" });
    expect(body.messages[0].content[1].image_url.url).toBe("data:image/png;base64,QUJD");
    expect(body.plugins).toBeUndefined();
  });

  it("asks for the configured PDF parsing engine, never the paid one by default", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(completionBody("{}")));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await provider.complete({
      modelId: "vendor/model:free",
      messages: [{ role: "user", content: "read this" }],
      attachments: [{ kind: "pdf", filename: "bill.pdf", mimeType: "application/pdf", base64: "QUJD" }],
      timeoutMs: 5000,
    });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }]);
    expect(body.messages[0].content[1].file.filename).toBe("bill.pdf");
  });

  it("marks a 429 as retryable and a 401 as not", async () => {
    const rateLimited = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "Rate limit exceeded" } }, 429));
    const unauthorised = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "Invalid credentials" } }, 401));

    const request = {
      modelId: "vendor/model:free",
      messages: [{ role: "user" as const, content: "hi" }],
      timeoutMs: 5000,
    };

    await expect(
      new OpenRouterProvider({ fetchImpl: rateLimited as unknown as typeof fetch }).complete(request),
    ).rejects.toMatchObject({ status: 429, retryable: true });

    await expect(
      new OpenRouterProvider({ fetchImpl: unauthorised as unknown as typeof fetch }).complete(request),
    ).rejects.toMatchObject({ status: 401, retryable: false });
  });

  it("treats an error carried inside a 200 response as a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: "upstream is down" } }));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      provider.complete({ modelId: "m", messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it("treats an unreachable provider as a retryable transport failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      provider.complete({ modelId: "m", messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("refuses to run at all with no key configured", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const fetchImpl = vi.fn();
    const provider = new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(provider.isConfigured()).toBe(false);
    await expect(
      provider.complete({ modelId: "m", messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("OpenRouterProvider.listModels", () => {
  it("maps the live catalogue into the application's model shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "vendor/model:free",
            name: "Vendor Model",
            context_length: 1000,
            pricing: { prompt: "0", completion: "0" },
            architecture: { input_modalities: ["text", "image"] },
            supported_parameters: ["structured_outputs"],
          },
        ],
      }),
    );

    const models = await new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch }).listModels();

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: "vendor/model:free", cost: "FREE", supportsImages: true });
  });

  it("raises a provider error when the catalogue can't be read", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    await expect(
      new OpenRouterProvider({ fetchImpl: fetchImpl as unknown as typeof fetch }).listModels(),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("scrubSecrets", () => {
  it("removes the configured key from any text that quotes it back", () => {
    expect(scrubSecrets(`Authorization: Bearer ${FAKE_KEY} failed`)).toBe("Authorization: Bearer [redacted] failed");
  });

  it("removes an OpenRouter-shaped key even if it isn't the configured one", () => {
    expect(scrubSecrets("leaked sk-or-v1-someoneelseskey123456 here")).toBe("leaked [redacted] here");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubSecrets("No credentials in this sentence.")).toBe("No credentials in this sentence.");
  });
});
