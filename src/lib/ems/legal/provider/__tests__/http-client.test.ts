/**
 * Tests for the shared HTTP policy (T41, spec §4 client requirements).
 * Every request goes through an injected `fetchImpl`; nothing here reaches
 * a real network.
 */

import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, fetchWithPolicy } from "@/lib/ems/legal/provider/http-client";
import { LegalContentProviderError } from "@/lib/ems/legal/provider/types";

function xmlResponse(body: string, status = 200, contentType = "application/atom+xml"): Response {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

const OPTS = { userAgent: "test-agent/1.0 (+contact: test@example.invalid)" };

describe("fetchWithPolicy", () => {
  it("sends the configured user agent and returns the body on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse("<feed/>"));
    const text = await fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(text).toBe("<feed/>");
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(OPTS.userAgent);
  });

  it("retries a retryable status and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse("", 503))
      .mockResolvedValueOnce(xmlResponse("<feed/>"));
    const text = await fetchWithPolicy("https://example.test/feed", {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 2,
    });
    expect(text).toBe("<feed/>");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a non-retryable HTTP_ERROR immediately without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse("not found", 404));
    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 3 }),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", retryable: false, status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out via AbortController and reports TIMEOUT", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    await expect(
      fetchWithPolicy("https://example.test/feed", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 5,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("rejects an unexpected content type without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse("<html>oops</html>", 200, "text/html"));
    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE", retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response over the configured size limit", async () => {
    const big = "a".repeat(1000);
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse(big));
    await expect(
      fetchWithPolicy("https://example.test/feed", {
        ...OPTS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        maxResponseBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", retryable: false });
  });

  it("exhausts retries on repeated 429 and throws RATE_LIMITED rather than returning anything", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse("", 429));
    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 1 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("opens the circuit after repeated failures and short-circuits without calling fetchImpl", async () => {
    const circuit = new CircuitBreaker(2);
    const fetchImpl = vi.fn().mockResolvedValue(xmlResponse("", 500));

    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 0 }, circuit),
    ).rejects.toBeInstanceOf(LegalContentProviderError);
    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 0 }, circuit),
    ).rejects.toBeInstanceOf(LegalContentProviderError);

    expect(circuit.status).toBe("OPEN");
    const callsBeforeOpenCheck = fetchImpl.mock.calls.length;

    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch }, circuit),
    ).rejects.toMatchObject({ code: "CIRCUIT_OPEN" });
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeOpenCheck);
  });

  it("resets the circuit on a subsequent success", async () => {
    const circuit = new CircuitBreaker(1);
    const fetchImpl = vi.fn().mockResolvedValueOnce(xmlResponse("", 500)).mockResolvedValueOnce(xmlResponse("<feed/>"));

    await expect(
      fetchWithPolicy("https://example.test/feed", { ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch, maxRetries: 0 }, circuit),
    ).rejects.toBeInstanceOf(LegalContentProviderError);
    expect(circuit.status).toBe("OPEN");

    circuit.recordSuccess();
    expect(circuit.status).toBe("CLOSED");
  });
});
