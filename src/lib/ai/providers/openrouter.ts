/**
 * OpenRouter implementation of the AiProvider boundary.
 *
 * This is the only file in the application that knows OpenRouter exists, and
 * the only one that touches the API key. The key is read from
 * `process.env.OPENROUTER_API_KEY` at call time and used solely as an
 * `Authorization` header: it is never returned, never persisted, never
 * logged, and never interpolated into an error message (`scrubSecrets` below
 * is a belt-and-braces guard for anything that quotes a request back).
 *
 * Adding GeminiProvider / AnthropicProvider / OpenAIProvider / GroqProvider /
 * LocalModelProvider later means writing a sibling file that implements the
 * same interface and registering it — nothing else in the app changes.
 */

import {
  AiAttachment,
  AiCompletionRequest,
  AiCompletionResponse,
  AiModelInfo,
  AiProvider,
  AiProviderError,
} from "../types";
import { parseCatalog } from "../catalog";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** HTTP statuses where trying again (or trying another model) can help. */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function assertServerSide() {
  if (typeof window !== "undefined") {
    throw new Error("The OpenRouter provider is server-only and must never be imported into client code.");
  }
}

/**
 * Defence in depth: if a key ever appears in an upstream error body or a
 * echoed request, it must not travel any further into logs or the UI.
 */
export function scrubSecrets(text: string): string {
  const key = process.env.OPENROUTER_API_KEY;
  let out = text;
  if (key && key.length > 6) out = out.split(key).join("[redacted]");
  // Generic OpenRouter key shape, in case a different key leaks through.
  return out.replace(/sk-or-[A-Za-z0-9._-]{8,}/g, "[redacted]");
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

function attachmentToPart(attachment: AiAttachment): ContentPart {
  const dataUrl = `data:${attachment.mimeType};base64,${attachment.base64}`;
  if (attachment.kind === "image") {
    return { type: "image_url", image_url: { url: dataUrl } };
  }
  return { type: "file", file: { filename: attachment.filename, file_data: dataUrl } };
}

interface OpenRouterChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
  error?: unknown;
}

interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: Record<string, unknown>;
  error?: { message?: unknown; code?: unknown };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * OpenRouter returns text either as a plain string or as an array of content
 * parts, depending on the upstream model. Both shapes have to be handled;
 * anything else yields an empty string, which the caller treats as a failed
 * response rather than silently accepting nothing.
 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

export interface OpenRouterProviderOptions {
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Free-only mode must not select the paid OCR engine for PDF parsing. */
  pdfEngine?: "native" | "cloudflare-ai" | "mistral-ocr";
}

export class OpenRouterProvider implements AiProvider {
  readonly id = "openrouter";
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly pdfEngine: NonNullable<OpenRouterProviderOptions["pdfEngine"]>;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;
    this.pdfEngine = options.pdfEngine ?? "cloudflare-ai";
  }

  isConfigured(): boolean {
    return Boolean(process.env.OPENROUTER_API_KEY?.trim());
  }

  private authHeaders(): Record<string, string> {
    assertServerSide();
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) {
      throw new AiProviderError("OpenRouter is not configured.", null, false);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    // Optional attribution headers, per OpenRouter's docs. Harmless if unset.
    const referer = process.env.OPENROUTER_APP_URL?.trim();
    const title = process.env.OPENROUTER_APP_TITLE?.trim();
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;
    return headers;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    assertServerSide();

    const attachments = request.attachments ?? [];
    const messages = request.messages.map((m, index) => {
      const isLastUser = index === request.messages.length - 1 && m.role === "user";
      if (!isLastUser || attachments.length === 0) {
        return { role: m.role, content: m.content };
      }
      const parts: ContentPart[] = [{ type: "text", text: m.content }, ...attachments.map(attachmentToPart)];
      return { role: m.role, content: parts };
    });

    const body: Record<string, unknown> = {
      model: request.modelId,
      messages,
    };

    if (request.maxOutputTokens) body.max_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    if (request.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          strict: true,
          schema: request.jsonSchema.schema,
        },
      };
    }

    if (attachments.some((a) => a.kind === "pdf")) {
      body.plugins = [{ id: "file-parser", pdf: { engine: this.pdfEngine } }];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    if (request.signal) {
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new AiProviderError(
        aborted ? "The AI request timed out." : `Could not reach the AI provider: ${scrubSecrets(String(err))}`,
        null,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();

    if (!response.ok) {
      let message = `AI provider returned HTTP ${response.status}.`;
      try {
        const parsed = JSON.parse(rawText) as OpenRouterResponse;
        if (parsed?.error?.message) message = `${message} ${String(parsed.error.message)}`;
      } catch {
        // Non-JSON error body — the status alone is the useful signal.
      }
      throw new AiProviderError(scrubSecrets(message), response.status, RETRYABLE_STATUSES.has(response.status));
    }

    let parsed: OpenRouterResponse;
    try {
      parsed = JSON.parse(rawText) as OpenRouterResponse;
    } catch {
      throw new AiProviderError("AI provider returned a response that wasn't valid JSON.", response.status, true);
    }

    // A 200 can still carry an error (streaming-style errors, moderation).
    if (parsed.error?.message) {
      throw new AiProviderError(scrubSecrets(String(parsed.error.message)), 200, true);
    }

    const choice = parsed.choices?.[0];
    const text = extractText(choice?.message?.content);
    const usage = parsed.usage ?? null;

    return {
      text,
      modelUsed: typeof parsed.model === "string" ? parsed.model : request.modelId,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      usage: usage
        ? {
            promptTokens: numberOrNull(usage.prompt_tokens),
            completionTokens: numberOrNull(usage.completion_tokens),
            totalTokens: numberOrNull(usage.total_tokens),
            // Only ever what OpenRouter itself reported — never estimated here.
            costUsd: numberOrNull(usage.cost),
          }
        : null,
    };
  }

  async listModels(): Promise<AiModelInfo[]> {
    assertServerSide();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.authHeaders(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AiProviderError(
          `Could not load the model catalogue (HTTP ${response.status}).`,
          response.status,
          RETRYABLE_STATUSES.has(response.status),
        );
      }
      return parseCatalog(await response.json());
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiProviderError(`Could not load the model catalogue: ${scrubSecrets(String(err))}`, null, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
