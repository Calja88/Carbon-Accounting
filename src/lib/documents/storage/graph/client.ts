/**
 * Microsoft Graph client boundary implementation (task SP02,
 * Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §§4,6,9,11). This is the only
 * file in the application that constructs a Microsoft Graph HTTP request.
 * It never uploads or downloads file bytes (that is SP03's
 * `SharePointEvidenceStorageProvider`) — only metadata reads, version
 * listing, upload-session *preparation*, and a health check.
 *
 * Mirrors `src/lib/ai/providers/openrouter.ts`'s shape: server-only guard,
 * injectable `fetch`, `AbortController` timeout, bounded retry on
 * transient failures, and a scrub function so a secret or session URL never
 * reaches a log line or thrown error.
 */

import { GraphAccessToken, GraphClient, GraphClientError, GraphDownloadMetadata, GraphDriveMetadata, GraphErrorKind, GraphHealthCheckResult, GraphItemMetadata, GraphSiteTarget, GraphTokenProvider, GraphUploadSession, GraphVersionMetadata } from "./types";
import { scrubGraphSecrets } from "./token-provider";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

/** Graph statuses where retrying the same idempotent GET can help. Mutating calls (createUploadSession) are never retried automatically here — a caller decides whether to re-issue one. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Hard cap so a persistent outage fails fast rather than looping — SP02 "bounded retry/backoff for safe idempotent calls". */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

function assertServerSide() {
  if (typeof window !== "undefined") {
    throw new Error("The Graph client is server-only and must never be imported into client code.");
  }
}

function statusToErrorKind(status: number): GraphErrorKind {
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 412) return "PRECONDITION_FAILED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "SERVER_ERROR";
}

/** Never includes a foreign-tenant identifier or the raw Graph error body verbatim — only the normalised kind/status and a generic description (SP02 "without exposing foreign-tenant metadata"). */
function describeError(kind: GraphErrorKind, status: number | null): string {
  switch (kind) {
    case "AUTHENTICATION":
      return "Microsoft Graph rejected the request's credentials.";
    case "PERMISSION_DENIED":
      return "Microsoft Graph denied this operation for the configured site permission.";
    case "NOT_FOUND":
      return "The requested SharePoint site, drive, item or version could not be found.";
    case "CONFLICT":
      return "Microsoft Graph reported a conflict for this operation.";
    case "PRECONDITION_FAILED":
      return "Microsoft Graph reported a precondition failure (an eTag/cTag mismatch).";
    case "RATE_LIMITED":
      return "Microsoft Graph rate-limited this request.";
    case "TIMEOUT":
      return "The request to Microsoft Graph timed out.";
    case "MALFORMED_RESPONSE":
      return "Microsoft Graph returned a response that was not valid JSON.";
    case "NETWORK":
      return "Could not reach Microsoft Graph.";
    case "CONFIGURATION":
      return "Microsoft Graph is not configured for this organisation/site.";
    case "SERVER_ERROR":
    default:
      return status ? `Microsoft Graph returned an unexpected error (HTTP ${status}).` : "Microsoft Graph returned an unexpected error.";
  }
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GraphErrorBody {
  error?: { code?: unknown; message?: unknown; innerError?: { "request-id"?: unknown } };
}

export interface GraphClientOptions {
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  tokenProvider: GraphTokenProvider;
}

export class MicrosoftGraphClient implements GraphClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenProvider: GraphTokenProvider;

  constructor(options: GraphClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.baseUrl = options.baseUrl ?? GRAPH_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.tokenProvider = options.tokenProvider;
  }

  /**
   * Performs one Graph call with a bounded number of attempts. Retries only
   * on `RETRYABLE_STATUSES` or a network/timeout failure, honouring
   * `Retry-After` when Graph supplies one, and only for `idempotent` calls —
   * a mutating request (e.g. `createUploadSession`) is called with
   * `idempotent: false` so a single ambiguous failure is surfaced rather than
   * silently retried.
   */
  private async request(
    path: string,
    target: GraphSiteTarget,
    correlationId: string,
    options: { method?: string; body?: unknown; idempotent?: boolean } = {},
  ): Promise<unknown> {
    assertServerSide();
    const idempotent = options.idempotent ?? true;
    const method = options.method ?? "GET";

    let token: GraphAccessToken;
    try {
      token = await this.tokenProvider.getToken(target.entraTenantId, correlationId);
    } catch (err) {
      if (err instanceof GraphClientError) throw err;
      throw new GraphClientError("Could not acquire a Microsoft Graph token.", "AUTHENTICATION", null, true, correlationId);
    }

    let lastError: GraphClientError | null = null;

    for (let attempt = 1; attempt <= (idempotent ? MAX_ATTEMPTS : 1); attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            "Content-Type": "application/json",
            "client-request-id": correlationId,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
          redirect: "manual",
        });
      } catch (err) {
        clearTimeout(timeout);
        const aborted = err instanceof Error && err.name === "AbortError";
        lastError = new GraphClientError(
          aborted ? "The request to Microsoft Graph timed out." : "Could not reach Microsoft Graph.",
          aborted ? "TIMEOUT" : "NETWORK",
          null,
          true,
          correlationId,
        );
        if (attempt < MAX_ATTEMPTS && idempotent) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }
      clearTimeout(timeout);

      // A redirect response is never followed automatically — SP02 "prevent
      // redirects ... from being logged" and from being an implicit trust
      // boundary crossing; treat it as an unexpected server error.
      if (response.status >= 300 && response.status < 400) {
        throw new GraphClientError("Microsoft Graph returned an unexpected redirect.", "SERVER_ERROR", response.status, false, correlationId);
      }

      if (response.ok) {
        if (response.status === 204) return null;
        const rawText = await response.text();
        if (!rawText) return null;
        try {
          return JSON.parse(rawText);
        } catch {
          throw new GraphClientError("Microsoft Graph returned a response that was not valid JSON.", "MALFORMED_RESPONSE", response.status, true, correlationId);
        }
      }

      const kind = statusToErrorKind(response.status);
      const retryable = idempotent && RETRYABLE_STATUSES.has(response.status);

      let requestId: string | null = null;
      try {
        const body = JSON.parse(await response.text()) as GraphErrorBody;
        if (typeof body.error?.innerError?.["request-id"] === "string") requestId = body.error.innerError["request-id"];
      } catch {
        // Non-JSON error body — the status code alone drives classification.
      }

      lastError = new GraphClientError(
        scrubGraphSecrets(describeError(kind, response.status) + (requestId ? ` (Graph request-id: ${requestId})` : "")),
        kind,
        response.status,
        retryable,
        correlationId,
      );

      if (retryable && attempt < MAX_ATTEMPTS) {
        const retryAfterMs = parseRetryAfterMs(response);
        await sleep(retryAfterMs ?? BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }

    // Unreachable in practice — the loop always returns or throws — but
    // keeps the function's return type honest for a non-idempotent call
    // whose single attempt somehow fell through.
    throw lastError ?? new GraphClientError("Microsoft Graph request failed for an unknown reason.", "SERVER_ERROR", null, false, correlationId);
  }

  async getDrive(target: GraphSiteTarget, correlationId: string): Promise<GraphDriveMetadata> {
    const raw = (await this.request(`/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}`, target, correlationId)) as {
      id?: unknown;
      webUrl?: unknown;
    };
    return {
      siteId: target.siteId,
      driveId: typeof raw?.id === "string" ? raw.id : target.driveId,
      webUrl: typeof raw?.webUrl === "string" ? raw.webUrl : null,
    };
  }

  async getItem(target: GraphSiteTarget, itemId: string, correlationId: string): Promise<GraphItemMetadata> {
    const raw = (await this.request(
      `/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(itemId)}`,
      target,
      correlationId,
    )) as {
      id?: unknown;
      name?: unknown;
      eTag?: unknown;
      cTag?: unknown;
      webUrl?: unknown;
      lastModifiedDateTime?: unknown;
      size?: unknown;
      file?: { hashes?: { sha256Hash?: unknown } };
    };
    return {
      itemId: typeof raw?.id === "string" ? raw.id : itemId,
      name: typeof raw?.name === "string" ? raw.name : "",
      eTag: typeof raw?.eTag === "string" ? raw.eTag : null,
      cTag: typeof raw?.cTag === "string" ? raw.cTag : null,
      webUrl: typeof raw?.webUrl === "string" ? raw.webUrl : null,
      lastModifiedDateTime: typeof raw?.lastModifiedDateTime === "string" ? raw.lastModifiedDateTime : null,
      sha256: typeof raw?.file?.hashes?.sha256Hash === "string" ? raw.file.hashes.sha256Hash : null,
      size: typeof raw?.size === "number" ? raw.size : null,
    };
  }

  async listVersions(target: GraphSiteTarget, itemId: string, correlationId: string): Promise<GraphVersionMetadata[]> {
    const raw = (await this.request(
      `/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(itemId)}/versions`,
      target,
      correlationId,
    )) as { value?: unknown };
    const list = Array.isArray(raw?.value) ? raw.value : [];
    return list.map((entry) => {
      const v = entry as { id?: unknown; lastModifiedDateTime?: unknown };
      return {
        versionId: typeof v?.id === "string" ? v.id : "",
        lastModifiedDateTime: typeof v?.lastModifiedDateTime === "string" ? v.lastModifiedDateTime : null,
      };
    });
  }

  async getDownloadMetadata(target: GraphSiteTarget, itemId: string, versionId: string, correlationId: string): Promise<GraphDownloadMetadata> {
    const raw = (await this.request(
      `/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
      target,
      correlationId,
    )) as { size?: unknown };
    // The item's current facet carries mime type and hash; the version
    // resource itself is minimal, so this deliberately only asserts what
    // Graph's version endpoint actually returns (size) plus what the caller
    // already has pinned (itemId/versionId) — it never falls back to
    // resolving "latest" (SP00 §7).
    const item = await this.getItem(target, itemId, correlationId);
    return {
      itemId,
      versionId,
      sizeBytes: typeof raw?.size === "number" ? raw.size : item.size,
      mimeType: null,
      sha256: item.sha256,
    };
  }

  async createUploadSession(target: GraphSiteTarget, parentItemPath: string, fileName: string, correlationId: string): Promise<GraphUploadSession> {
    const safePath = parentItemPath.replace(/^\/+|\/+$/g, "");
    const path = `/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}/root:/${safePath ? `${safePath}/` : ""}${encodeURIComponent(fileName)}:/createUploadSession`;
    const raw = (await this.request(path, target, correlationId, {
      method: "POST",
      body: { item: { "@microsoft.graph.conflictBehavior": "fail" } },
      idempotent: false,
    })) as { uploadUrl?: unknown; expirationDateTime?: unknown };
    if (typeof raw?.uploadUrl !== "string") {
      throw new GraphClientError("Microsoft Graph did not return an upload session URL.", "MALFORMED_RESPONSE", null, false, correlationId);
    }
    return {
      uploadUrl: raw.uploadUrl,
      expirationDateTime: typeof raw?.expirationDateTime === "string" ? raw.expirationDateTime : null,
    };
  }

  async checkHealth(target: GraphSiteTarget, correlationId: string): Promise<GraphHealthCheckResult> {
    try {
      await this.getDrive(target, correlationId);
      return { ok: true, checkedAt: new Date().toISOString(), detail: "Drive metadata reachable." };
    } catch (err) {
      const detail = err instanceof GraphClientError ? describeError(err.kind, err.status) : "Unexpected error checking Graph health.";
      return { ok: false, checkedAt: new Date().toISOString(), detail };
    }
  }
}
