/**
 * App-only Microsoft Graph token acquisition (task SP02, SP00 §3 Option A —
 * a single Paragon multi-tenant Entra application — combined with
 * `Sites.Selected`, §4). This is the only file that reads the Paragon Graph
 * application's client secret; it is read from the environment at call
 * time, used only as an OAuth2 client-credentials request body field, and
 * is never returned, logged, or included in any thrown error (mirrors
 * `src/lib/ai/providers/openrouter.ts`'s `OPENROUTER_API_KEY` handling).
 *
 * SP00 §3's customer-owned (Option B) app-identity mode is modelled in the
 * SP01 schema (`ApplicationIdentityMode.CUSTOMER_OWNED`) but its per-organisation
 * credential resolution is out of scope here — this provider implements
 * Option A only; Option B remains an owner decision per SP00 §14.
 */

import { GraphAccessToken, GraphClientError, GraphTokenProvider } from "./types";

const ENTRA_TOKEN_ENDPOINT = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

/** Renew this far ahead of actual expiry so a request never races an about-to-expire token. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

function assertServerSide() {
  if (typeof window !== "undefined") {
    throw new Error("The Graph token provider is server-only and must never be imported into client code.");
  }
}

/** Belt-and-braces guard, matching `scrubSecrets` in `openrouter.ts`: strips the configured client secret out of anything that might echo it back. */
export function scrubGraphSecrets(text: string): string {
  const secret = process.env.GRAPH_CLIENT_SECRET;
  let out = text;
  if (secret && secret.length > 6) out = out.split(secret).join("[redacted]");
  return out;
}

export interface EntraClientCredentialsTokenProviderOptions {
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface EntraTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Default `GraphTokenProvider`: OAuth2 client-credentials grant against
 * Entra ID, scoped to `https://graph.microsoft.com/.default` (application
 * permissions, i.e. whatever the app registration has been granted —
 * `Sites.Selected` per SP00 §4). Caches one token per Entra tenant ID in
 * memory only; never persists a token anywhere.
 */
export class EntraClientCredentialsTokenProvider implements GraphTokenProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, GraphAccessToken>();

  constructor(options: EntraClientCredentialsTokenProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private readAppCredentials(correlationId: string): { clientId: string; clientSecret: string } {
    const clientId = process.env.GRAPH_CLIENT_ID?.trim();
    const clientSecret = process.env.GRAPH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      throw new GraphClientError(
        "Microsoft Graph application credentials are not configured.",
        "CONFIGURATION",
        null,
        false,
        correlationId,
      );
    }
    return { clientId, clientSecret };
  }

  async getToken(entraTenantId: string, correlationId: string): Promise<GraphAccessToken> {
    assertServerSide();
    if (!entraTenantId) {
      throw new GraphClientError("No Entra tenant ID configured for this organisation.", "CONFIGURATION", null, false, correlationId);
    }

    const cached = this.cache.get(entraTenantId);
    if (cached && cached.expiresAtMs - TOKEN_REFRESH_SKEW_MS > Date.now()) {
      return cached;
    }

    const { clientId, clientSecret } = this.readAppCredentials(correlationId);

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(ENTRA_TOKEN_ENDPOINT(entraTenantId), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new GraphClientError(
        aborted ? "Timed out acquiring a Microsoft Graph token." : "Could not reach Microsoft Entra to acquire a token.",
        aborted ? "TIMEOUT" : "NETWORK",
        null,
        true,
        correlationId,
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();
    let parsed: EntraTokenResponse;
    try {
      parsed = JSON.parse(rawText) as EntraTokenResponse;
    } catch {
      throw new GraphClientError("Entra returned a token response that was not valid JSON.", "MALFORMED_RESPONSE", response.status, true, correlationId);
    }

    if (!response.ok || !parsed.access_token) {
      const kind = response.status === 401 || response.status === 400 ? "AUTHENTICATION" : "SERVER_ERROR";
      const retryable = response.status >= 500 || response.status === 429;
      throw new GraphClientError(
        scrubGraphSecrets(`Entra token request failed (HTTP ${response.status}): ${parsed.error ?? "unknown_error"}`),
        kind,
        response.status,
        retryable,
        correlationId,
      );
    }

    const expiresInSeconds = typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in) ? parsed.expires_in : 3600;
    const token: GraphAccessToken = {
      accessToken: parsed.access_token,
      expiresAtMs: Date.now() + expiresInSeconds * 1000,
    };
    this.cache.set(entraTenantId, token);
    return token;
  }
}
