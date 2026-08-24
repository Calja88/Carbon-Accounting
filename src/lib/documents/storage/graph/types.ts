/**
 * Microsoft Graph client boundary types (task SP02,
 * Docs/SP00_SHAREPOINT_INTEGRATION_SPEC.md §§3-4,6,11). This module and its
 * siblings under `graph/` are the *only* place in the application that will
 * ever know Microsoft Graph exists — SP03+ (the SharePoint
 * EvidenceStorageProvider) talks to `GraphClient`, never to `fetch` or a
 * Graph SDK directly, mirroring the `AiProvider` boundary in
 * `src/lib/ai/types.ts`/`provider-registry.ts`.
 *
 * Nothing here performs a live call, uploads/downloads file bytes, or stores
 * a token/secret in Neon (SP02 scope: authentication/client boundary only).
 */

/** Normalised Graph failure kinds — never a raw HTTP status alone, so callers can branch without re-deriving Graph's own error shape (SP02 "distinguish permission/configuration failures from missing files without exposing foreign-tenant metadata"). */
export type GraphErrorKind =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_FAILED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "NETWORK";

/**
 * Thrown by every function in this module. `message` is always safe to log —
 * construction here (and in `client.ts`) never interpolates a token,
 * upload-session URL, or foreign-tenant identifier into it (SP02 "prevent
 * redirects or upload-session URLs from being logged").
 */
export class GraphClientError extends Error {
  constructor(
    message: string,
    readonly kind: GraphErrorKind,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly correlationId: string,
  ) {
    super(message);
    this.name = "GraphClientError";
  }
}

/** The organisation-specific target this client call is scoped to — resolved by `config.ts` from SP01's `OrganisationStorageConnection`/`StorageSiteBinding` rows, never accepted raw from a caller. */
export interface GraphSiteTarget {
  organisationId: string;
  entraTenantId: string;
  siteId: string;
  driveId: string;
}

/** Non-secret site/drive metadata (SP00 §6's identity fields, minus version/item which are per-file). */
export interface GraphDriveMetadata {
  siteId: string;
  driveId: string;
  webUrl: string | null;
}

/** SP00 §6 driveItem identity fields. `webUrl` is authorised-display-only per SP00 §8 — callers must never use it for retrieval. */
export interface GraphItemMetadata {
  itemId: string;
  name: string;
  eTag: string | null;
  cTag: string | null;
  webUrl: string | null;
  lastModifiedDateTime: string | null;
  sha256: string | null;
  size: number | null;
}

/** One entry from a driveItem's version history (SP00 §6-7). */
export interface GraphVersionMetadata {
  versionId: string;
  lastModifiedDateTime: string | null;
}

/** Metadata needed to stream a download server-side later (SP03) — never the bytes themselves, and never a direct/unauthenticated URL (SP00 §8). */
export interface GraphDownloadMetadata {
  itemId: string;
  versionId: string;
  sizeBytes: number | null;
  mimeType: string | null;
  sha256: string | null;
}

/** Opaque handle for a prepared large-file upload session. The session URL itself is never logged or returned to a browser (SP02 scope: preparation only — no bytes are sent in this task). */
export interface GraphUploadSession {
  uploadUrl: string;
  expirationDateTime: string | null;
}

export interface GraphHealthCheckResult {
  ok: boolean;
  checkedAt: string;
  detail: string;
}

/**
 * The client boundary. `SharePointEvidenceStorageProvider` (SP03) is the
 * intended sole caller; nothing here performs an upload/download of file
 * bytes — that is explicitly out of SP02 scope.
 */
export interface GraphClient {
  getDrive(target: GraphSiteTarget, correlationId: string): Promise<GraphDriveMetadata>;
  getItem(target: GraphSiteTarget, itemId: string, correlationId: string): Promise<GraphItemMetadata>;
  listVersions(target: GraphSiteTarget, itemId: string, correlationId: string): Promise<GraphVersionMetadata[]>;
  getDownloadMetadata(
    target: GraphSiteTarget,
    itemId: string,
    versionId: string,
    correlationId: string,
  ): Promise<GraphDownloadMetadata>;
  createUploadSession(
    target: GraphSiteTarget,
    parentItemPath: string,
    fileName: string,
    correlationId: string,
  ): Promise<GraphUploadSession>;
  checkHealth(target: GraphSiteTarget, correlationId: string): Promise<GraphHealthCheckResult>;
}

/** Cached app-only token plus its expiry, so a caching provider can decide whether to reuse it (SP02 "mocked unit/contract tests for token caching/expiry"). */
export interface GraphAccessToken {
  accessToken: string;
  /** Epoch milliseconds. Never serialised into a log line or error message. */
  expiresAtMs: number;
}

/**
 * Injectable app-only token acquisition (SP02 "behind an injectable
 * provider"). The default implementation performs the OAuth2
 * client-credentials flow against Entra using env-only configuration; tests
 * inject a fake.
 */
export interface GraphTokenProvider {
  getToken(entraTenantId: string, correlationId: string): Promise<GraphAccessToken>;
}
