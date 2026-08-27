/**
 * Entra client-credentials token provider tests (task SP02). All Graph/Entra
 * calls are mocked — no live tenant, no real credentials, matching the
 * `openrouter.ts` provider test pattern. Covers token caching/expiry, and
 * 400/401/timeout/malformed-response failures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntraClientCredentialsTokenProvider } from "../token-provider";
import { GraphClientError } from "../types";

const CORRELATION_ID = "correlation-sp02-test";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("EntraClientCredentialsTokenProvider", () => {
  const originalClientId = process.env.GRAPH_CLIENT_ID;
  const originalClientSecret = process.env.GRAPH_CLIENT_SECRET;

  beforeEach(() => {
    process.env.GRAPH_CLIENT_ID = "synthetic-client-id";
    process.env.GRAPH_CLIENT_SECRET = "synthetic-client-secret";
  });

  afterEach(() => {
    process.env.GRAPH_CLIENT_ID = originalClientId;
    process.env.GRAPH_CLIENT_SECRET = originalClientSecret;
    vi.useRealTimers();
  });

  it("acquires and returns a token on first call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "synthetic-token-1", expires_in: 3600 }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    const token = await provider.getToken("synthetic-tenant", CORRELATION_ID);

    expect(token.accessToken).toBe("synthetic-token-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("synthetic-tenant");
    expect(String(init?.body)).toContain("synthetic-client-secret");
  });

  it("caches a still-valid token instead of calling Entra again", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: "synthetic-token-1", expires_in: 3600 }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    await provider.getToken("synthetic-tenant", CORRELATION_ID);
    await provider.getToken("synthetic-tenant", CORRELATION_ID);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes a token that is within the expiry skew window", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "synthetic-token-1", expires_in: 30 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "synthetic-token-2", expires_in: 3600 }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    const first = await provider.getToken("synthetic-tenant", CORRELATION_ID);
    const second = await provider.getToken("synthetic-tenant", CORRELATION_ID);

    expect(first.accessToken).toBe("synthetic-token-1");
    expect(second.accessToken).toBe("synthetic-token-2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches tokens per Entra tenant independently", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "token-tenant-a", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "token-tenant-b", expires_in: 3600 }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    const a = await provider.getToken("tenant-a", CORRELATION_ID);
    const b = await provider.getToken("tenant-b", CORRELATION_ID);

    expect(a.accessToken).toBe("token-tenant-a");
    expect(b.accessToken).toBe("token-tenant-b");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws a CONFIGURATION error when app credentials are missing", async () => {
    delete process.env.GRAPH_CLIENT_ID;
    delete process.env.GRAPH_CLIENT_SECRET;
    const fetchImpl = vi.fn();
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    await expect(provider.getToken("synthetic-tenant", CORRELATION_ID)).rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a CONFIGURATION error when no Entra tenant id is supplied", async () => {
    const fetchImpl = vi.fn();
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    await expect(provider.getToken("", CORRELATION_ID)).rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies a 401 as AUTHENTICATION and scrubs the secret from the message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: "invalid_client", error_description: "AADSTS synthetic-client-secret rejected" }),
    );
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    let error: unknown;
    try {
      await provider.getToken("synthetic-tenant", CORRELATION_ID);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(GraphClientError);
    expect((error as GraphClientError).kind).toBe("AUTHENTICATION");
    expect((error as GraphClientError).message).not.toContain("synthetic-client-secret");
  });

  it("classifies a 5xx as retryable SERVER_ERROR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: "server_error" }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    await expect(provider.getToken("synthetic-tenant", CORRELATION_ID)).rejects.toMatchObject({ kind: "SERVER_ERROR", retryable: true });
  });

  it("classifies a malformed (non-JSON) response as MALFORMED_RESPONSE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = new EntraClientCredentialsTokenProvider({ fetchImpl });

    await expect(provider.getToken("synthetic-tenant", CORRELATION_ID)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });

  it("classifies a network failure as NETWORK and a timeout as TIMEOUT", async () => {
    const networkFetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const networkProvider = new EntraClientCredentialsTokenProvider({ fetchImpl: networkFetch });
    await expect(networkProvider.getToken("synthetic-tenant", CORRELATION_ID)).rejects.toMatchObject({ kind: "NETWORK", retryable: true });

    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeoutFetch = vi.fn().mockRejectedValue(abortError);
    const timeoutProvider = new EntraClientCredentialsTokenProvider({ fetchImpl: timeoutFetch });
    await expect(timeoutProvider.getToken("synthetic-tenant", CORRELATION_ID)).rejects.toMatchObject({ kind: "TIMEOUT", retryable: true });
  });
});
