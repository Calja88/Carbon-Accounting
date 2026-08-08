/**
 * Which AiProvider the application uses.
 *
 * One switch, one place. `GeminiProvider`, `AnthropicProvider`,
 * `OpenAIProvider`, `GroqProvider` and `LocalModelProvider` each become a
 * file under `providers/` plus a case here — no call site changes, because
 * nothing outside this directory names a provider.
 */

import { AiProvider } from "./types";
import { OpenRouterProvider } from "./providers/openrouter";

export type AiProviderId = "openrouter";

export interface ProviderOptions {
  /**
   * How PDFs should be parsed when the chosen model can't read files
   * natively. Chosen per call by the router, because the OCR engine is a
   * paid add-on that free-only mode must never select.
   */
  pdfEngine?: "native" | "cloudflare-ai" | "mistral-ocr";
}

export function getAiProvider(options: ProviderOptions = {}): AiProvider {
  const configured = (process.env.AI_PROVIDER?.trim().toLowerCase() ?? "openrouter") as AiProviderId;

  switch (configured) {
    case "openrouter":
    default:
      return new OpenRouterProvider({ pdfEngine: options.pdfEngine });
  }
}

/**
 * Whether AI could run at all, ignoring settings — i.e. "are there
 * credentials?". Used to tell "an administrator turned AI off" apart from
 * "nobody has configured a key yet", which need different messages.
 */
export function isProviderConfigured(): boolean {
  return getAiProvider().isConfigured();
}
