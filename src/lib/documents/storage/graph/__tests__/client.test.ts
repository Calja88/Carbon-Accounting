/**
 * Microsoft Graph client tests (task SP02). `fetchImpl` and the token
 * provider are both injected fakes — no live Microsoft Graph call is ever
 * made. Covers metadata reads, upload-session preparation, health check,
 * and Graph error-status normalisation (401/403/404/409/412/429/5xx),
 * timeout, malformed responses, and Retry-After-driven retry.
 */

import { describe, expect, it, vi } from "vitest";
import { MicrosoftGraphClient } from "../client";
import { GraphAccessToken, GraphClientError, GraphSiteTarget, GraphTokenProvider } from "../types";

const CORRELATION_ID = "correlation-sp02-test";

const TARGET: GraphSiteTarget = {
  organisationId: "org-aster-demo",
  entraTenantId: "synthetic-tenant",
  siteId: "synthetic-site",
  driveId: "synthetic-drive",
};

class FakeTokenProvider implements GraphTokenProvider {
  calls = 0;
  async getToken(): Promise<GraphAccessToken> {
    this.calls++;
    return { accessToken: "synthetic-token", expiresAtMs: Date.now() + 3600_000 };
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("MicrosoftGraphClient", () => {
  it("reads drive metadata", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "synthetic-drive", webUrl: "https://contoso.example/drive" }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const drive = await client.getDrive(TARGET, CORRELATION_ID);

    expect(drive).toEqual({ siteId: "synthetic-site", driveId: "synthetic-drive", webUrl: "https://contoso.example/drive" });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-token");
    expect((init.headers as Record<string, string>)["client-request-id"]).toBe(CORRELATION_ID);
  });

  it("reads item metadata including the sha256 hash facet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "item-1",
        name: "evidence.pdf",
        eTag: "\"etag-1\"",
        cTag: "\"ctag-1\"",
        webUrl: "https://contoso.example/item",
        lastModifiedDateTime: "2026-01-01T00:00:00Z",
        size: 1024,
        file: { hashes: { sha256Hash: "deadbeef" } },
      }),
    );
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const item = await client.getItem(TARGET, "item-1", CORRELATION_ID);

    expect(item.sha256).toBe("deadbeef");
    expect(item.size).toBe(1024);
  });

  it("lists versions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { value: [{ id: "1.0", lastModifiedDateTime: "2026-01-01T00:00:00Z" }, { id: "2.0", lastModifiedDateTime: "2026-01-02T00:00:00Z" }] }),
    );
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const versions = await client.listVersions(TARGET, "item-1", CORRELATION_ID);

    expect(versions).toHaveLength(2);
    expect(versions[1].versionId).toBe("2.0");
  });

  it("creates an upload session without retrying on failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { uploadUrl: "https://contoso.example/upload?token=secret", expirationDateTime: "2026-01-01T01:00:00Z" }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const session = await client.createUploadSession(TARGET, "/EMS/Category", "evidence.pdf", CORRELATION_ID);

    expect(session.uploadUrl).toContain("upload");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
  });

  it("does not retry createUploadSession on a 503 (non-idempotent)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: "unavailable" } }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    await expect(client.createUploadSession(TARGET, "/EMS", "evidence.pdf", CORRELATION_ID)).rejects.toMatchObject({ kind: "SERVER_ERROR" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("runs a health check that succeeds when the drive is reachable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: "synthetic-drive" }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const result = await client.checkHealth(TARGET, CORRELATION_ID);

    expect(result.ok).toBe(true);
  });

  it("runs a health check that reports failure without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(403, { error: { message: "denied" } }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const result = await client.checkHealth(TARGET, CORRELATION_ID);

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("denied this operation");
  });

  const statusCases: Array<{ status: number; kind: string }> = [
    { status: 401, kind: "AUTHENTICATION" },
    { status: 403, kind: "PERMISSION_DENIED" },
    { status: 404, kind: "NOT_FOUND" },
    { status: 409, kind: "CONFLICT" },
    { status: 412, kind: "PRECONDITION_FAILED" },
  ];

  for (const { status, kind } of statusCases) {
    it(`normalises HTTP ${status} to ${kind} without exposing the raw Graph body`, async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: { message: "some raw graph detail about a foreign tenant" } }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      let error: unknown;
      try {
        await client.getDrive(TARGET, CORRELATION_ID);
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(GraphClientError);
      expect((error as GraphClientError).kind).toBe(kind);
      expect((error as GraphClientError).message).not.toContain("foreign tenant");
    });
  }

  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: { message: "rate limited" } }, { "Retry-After": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "synthetic-drive" }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    const drive = await client.getDrive(TARGET, CORRELATION_ID);

    expect(drive.driveId).toBe("synthetic-drive");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 up to the attempt cap, then throws SERVER_ERROR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: "unavailable" } }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "SERVER_ERROR", retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a network failure as retryable and eventually throws NETWORK", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "NETWORK" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("classifies an aborted request as TIMEOUT", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider(), timeoutMs: 5 });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("classifies a malformed (non-JSON) success body as MALFORMED_RESPONSE", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "MALFORMED_RESPONSE" });
  });

  it("treats a redirect as an unexpected server error rather than following it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://attacker.example" } }));
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "SERVER_ERROR", retryable: false });
  });

  it("propagates a token-acquisition failure without calling Graph", async () => {
    const fetchImpl = vi.fn();
    const failingTokenProvider: GraphTokenProvider = {
      getToken: vi.fn().mockRejectedValue(new GraphClientError("no credentials", "CONFIGURATION", null, false, CORRELATION_ID)),
    };
    const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: failingTokenProvider });

    await expect(client.getDrive(TARGET, CORRELATION_ID)).rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Byte-level upload/download/delete (task SP03)
  // ---------------------------------------------------------------------

  describe("uploadContent", () => {
    it("uploads a small file with a single authenticated PUT and resolves the newest version id", async () => {
      const uploadResponse = jsonResponse(201, {
        id: "item-42",
        eTag: '"etag-1"',
        webUrl: "https://contoso.example/item-42",
        size: 11,
        file: { hashes: { sha256Hash: "synthetic-hash" } },
      });
      const versionsResponse = jsonResponse(200, { value: [{ id: "2.0" }, { id: "1.0" }] });
      const fetchImpl = vi.fn().mockResolvedValueOnce(uploadResponse).mockResolvedValueOnce(versionsResponse);
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      const result = await client.uploadContent(TARGET, "/EMS/Category", "evidence.pdf", Buffer.from("hello world"), CORRELATION_ID);

      expect(result).toEqual({
        itemId: "item-42",
        versionId: "2.0",
        eTag: '"etag-1"',
        webUrl: "https://contoso.example/item-42",
        sha256: "synthetic-hash",
        size: 11,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const [uploadUrl, uploadInit] = fetchImpl.mock.calls[0];
      expect(String(uploadUrl)).toContain("/content");
      expect(uploadInit.method).toBe("PUT");
      expect((uploadInit.headers as Record<string, string>).Authorization).toBe("Bearer synthetic-token");
    });

    it("uploads a large file via an unauthenticated PUT to the prepared session URL", async () => {
      const sessionResponse = jsonResponse(200, { uploadUrl: "https://contoso.example/upload?token=secret", expirationDateTime: null });
      const uploadResponse = jsonResponse(201, { id: "item-99", eTag: null, webUrl: null, size: 5_000_000 });
      const versionsResponse = jsonResponse(200, { value: [{ id: "1.0" }] });
      const fetchImpl = vi.fn().mockResolvedValueOnce(sessionResponse).mockResolvedValueOnce(uploadResponse).mockResolvedValueOnce(versionsResponse);
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });
      const bytes = Buffer.alloc(5_000_000, 1);

      const result = await client.uploadContent(TARGET, "/EMS", "large.bin", bytes, CORRELATION_ID);

      expect(result.itemId).toBe("item-99");
      expect(result.versionId).toBe("1.0");
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      const [sessionPutUrl, sessionPutInit] = fetchImpl.mock.calls[1];
      expect(sessionPutUrl).toBe("https://contoso.example/upload?token=secret");
      expect((sessionPutInit.headers as Record<string, string>).Authorization).toBeUndefined();
      expect((sessionPutInit.headers as Record<string, string>)["Content-Range"]).toBe("bytes 0-4999999/5000000");
    });

    it("does not retry a failed upload PUT", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: "unavailable" } }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      await expect(client.uploadContent(TARGET, "/EMS", "evidence.pdf", Buffer.from("x"), CORRELATION_ID)).rejects.toMatchObject({
        kind: "SERVER_ERROR",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("downloadContent", () => {
    it("streams the exact pinned item/version content, following Graph's redirect to the blob location", async () => {
      const bytes = new TextEncoder().encode("pinned evidence bytes");
      const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(bytes, { status: 200 }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      const result = await client.downloadContent(TARGET, "item-1", "3.0", CORRELATION_ID);

      expect(result.toString("utf8")).toBe("pinned evidence bytes");
      const [url] = fetchImpl.mock.calls[0];
      expect(String(url)).toContain("/versions/3.0/content");
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.redirect).toBe("follow");
    });

    it("throws NOT_FOUND rather than falling back to another version", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: { message: "not found" } }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      await expect(client.downloadContent(TARGET, "item-1", "3.0", CORRELATION_ID)).rejects.toMatchObject({ kind: "NOT_FOUND" });
    });
  });

  describe("deleteItem", () => {
    it("sends a DELETE for the exact item id", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      await client.deleteItem(TARGET, "item-1", CORRELATION_ID);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(String(url)).toContain("/items/item-1");
      expect(init.method).toBe("DELETE");
    });

    it("does not retry a failed delete", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: { message: "unavailable" } }));
      const client = new MicrosoftGraphClient({ fetchImpl, tokenProvider: new FakeTokenProvider() });

      await expect(client.deleteItem(TARGET, "item-1", CORRELATION_ID)).rejects.toMatchObject({ kind: "SERVER_ERROR" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});
