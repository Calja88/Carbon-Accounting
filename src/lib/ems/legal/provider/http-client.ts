/**
 * Shared outbound-HTTP policy for legal content providers (spec §4 client
 * requirements: "timeout, bounded retry, user agent/contact, response-size
 * limit, content-type validation, pagination ceiling, circuit status,
 * structured errors and no secrets in logs"). `legislation-gov-uk.ts` is the
 * only caller today; kept separate from that file because none of this is
 * legislation.gov.uk-specific — a second provider reuses it directly, same
 * reasoning as `AiProviderError` being shared across AI providers rather
 * than redefined per-provider.
 *
 * No provider covered here needs credentials (legislation.gov.uk is a
 * public feed), so there is nothing to redact in practice — but every error
 * path below builds its message from the status/URL only, never the
 * response body, so that stays true even if a future provider adds auth.
 */

import { LegalContentProviderError } from "./types";

/** HTTP statuses worth retrying — same set `openrouter.ts` uses, minus 429 which gets its own handling (see `fetchWithPolicy`). */
const RETRYABLE_STATUSES = new Set([408, 409, 425, 500, 502, 503, 504]);

export interface HttpClientOptions {
  /** Injectable for tests — defaults to global fetch, same pattern as `OpenRouterProviderOptions.fetchImpl`. */
  fetchImpl?: typeof fetch;
  /** Sent as `User-Agent`, and required to be identifying/contactable — legislation.gov.uk's usage policy asks bulk/automated clients to identify themselves. */
  userAgent: string;
  timeoutMs?: number;
  /** Attempts after the first, i.e. `maxRetries: 2` means up to 3 total attempts. */
  maxRetries?: number;
  maxResponseBytes?: number;
  /** Accepted `Content-Type` prefixes; a response outside this list fails as `INVALID_CONTENT_TYPE` before parsing is attempted. */
  allowedContentTypePrefixes?: string[];
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxRetries: 2,
  maxResponseBytes: 5_000_000,
  allowedContentTypePrefixes: ["application/atom+xml", "application/xml", "text/xml"],
};

/**
 * Consecutive-failure circuit breaker. Deliberately in-memory/per-instance —
 * a provider instance is expected to live for the duration of one sync run
 * (T42), not to persist circuit state across process restarts.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;

  constructor(private readonly openThreshold = 5) {}

  get status(): "CLOSED" | "OPEN" {
    return this.consecutiveFailures >= this.openThreshold ? "OPEN" : "CLOSED";
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(200 * 2 ** attempt, 2_000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function contentTypeAllowed(header: string | null, allowedPrefixes: string[]): boolean {
  if (!header) return false;
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return allowedPrefixes.some((prefix) => type.startsWith(prefix));
}

/**
 * Fetches `url` as text under the full T41 client policy: timeout, bounded
 * retry (with backoff, on transport errors and retryable statuses), a
 * pagination-ceiling-independent response-size cap, content-type
 * validation, and circuit-breaker gating. Throws `LegalContentProviderError`
 * for every failure mode — callers never see a raw `fetch` rejection or an
 * unvalidated response.
 *
 * A 429 is retried like any other retryable status, but if every attempt is
 * still rate-limited, this throws `RATE_LIMITED` rather than returning
 * anything — the caller then has no page/cursor to advance past, which is
 * how the T41 acceptance criterion "rate limiting does not advance cursor"
 * holds without the cursor logic itself needing to know about rate limits.
 */
export async function fetchWithPolicy(
  url: string,
  options: HttpClientOptions,
  circuit?: CircuitBreaker,
): Promise<string> {
  if (circuit && circuit.status === "OPEN") {
    throw new LegalContentProviderError(`Circuit open for ${new URL(url).host}; refusing to call out.`, "CIRCUIT_OPEN", true);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  const allowedContentTypePrefixes = options.allowedContentTypePrefixes ?? DEFAULTS.allowedContentTypePrefixes;

  let lastError: LegalContentProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs(attempt - 1));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { "User-Agent": options.userAgent, Accept: allowedContentTypePrefixes.join(", ") },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const aborted = err instanceof Error && err.name === "AbortError";
      lastError = aborted
        ? new LegalContentProviderError(`Request to ${new URL(url).host} timed out after ${timeoutMs}ms.`, "TIMEOUT", true)
        : new LegalContentProviderError(`Could not reach ${new URL(url).host}.`, "NETWORK_ERROR", true);
      circuit?.recordFailure();
      continue;
    }
    clearTimeout(timeout);

    if (response.status === 429) {
      lastError = new LegalContentProviderError("Provider rate limit exceeded.", "RATE_LIMITED", true, 429);
      circuit?.recordFailure();
      continue;
    }

    if (!response.ok) {
      const retryable = RETRYABLE_STATUSES.has(response.status);
      lastError = new LegalContentProviderError(`Provider returned HTTP ${response.status}.`, "HTTP_ERROR", retryable, response.status);
      circuit?.recordFailure();
      if (!retryable) throw lastError;
      continue;
    }

    if (!contentTypeAllowed(response.headers.get("content-type"), allowedContentTypePrefixes)) {
      circuit?.recordFailure();
      throw new LegalContentProviderError(
        `Provider returned an unexpected content type "${response.headers.get("content-type") ?? "(none)"}".`,
        "INVALID_CONTENT_TYPE",
        false,
        response.status,
      );
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxResponseBytes) {
      circuit?.recordFailure();
      throw new LegalContentProviderError(`Provider response exceeds the ${maxResponseBytes}-byte limit.`, "RESPONSE_TOO_LARGE", false, response.status);
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      circuit?.recordFailure();
      throw new LegalContentProviderError(`Provider response exceeds the ${maxResponseBytes}-byte limit.`, "RESPONSE_TOO_LARGE", false, response.status);
    }

    circuit?.recordSuccess();
    return text;
  }

  throw lastError ?? new LegalContentProviderError("Request failed for an unknown reason.", "NETWORK_ERROR", true);
}
