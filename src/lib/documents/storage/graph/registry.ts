/**
 * Default `GraphClient` construction (task SP02). Mirrors
 * `src/lib/ai/provider-registry.ts`: one place wires the concrete
 * implementation together, so a caller never constructs
 * `MicrosoftGraphClient`/`EntraClientCredentialsTokenProvider` itself.
 */

import { MicrosoftGraphClient } from "./client";
import { EntraClientCredentialsTokenProvider } from "./token-provider";
import { GraphClient } from "./types";

let defaultClient: GraphClient | null = null;

/** Returns the shared default `GraphClient`, constructing it once. Tests should construct their own `MicrosoftGraphClient` with an injected `fetchImpl`/`tokenProvider` instead of calling this. */
export function getGraphClient(): GraphClient {
  if (!defaultClient) {
    const timeoutOverride = Number(process.env.GRAPH_REQUEST_TIMEOUT_MS);
    defaultClient = new MicrosoftGraphClient({
      tokenProvider: new EntraClientCredentialsTokenProvider(),
      timeoutMs: Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : undefined,
    });
  }
  return defaultClient;
}

/** Whether the shared Paragon Graph application credentials are present at all — "are there credentials?", independent of any organisation's own connection status. */
export function isGraphAppConfigured(): boolean {
  return Boolean(process.env.GRAPH_CLIENT_ID?.trim() && process.env.GRAPH_CLIENT_SECRET?.trim());
}
