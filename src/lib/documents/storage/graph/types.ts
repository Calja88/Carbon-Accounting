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
  | "NETWORK"
  /** HTTP 410 on a delta query — the supplied deltaLink/nextLink token has expired; Graph requires a fresh (non-token) delta query, which SP06's reconciliation service treats as a bounded resync, never an unbounded full-history scan (SP00 §9). */
  | "GONE";

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

/**
 * Result of writing evidence bytes to a driveItem (task SP03). `versionId`
 * is resolved from the item's version history immediately after the write
 * completes, since the upload response itself does not carry it — this is
 * the exact version SP03's `SharePointEvidenceStorageProvider` pins into an
 * `ExternalFileReference` (SP00 §7).
 */
export interface GraphUploadResult {
  itemId: string;
  versionId: string;
  eTag: string | null;
  webUrl: string | null;
  sha256: string | null;
  size: number;
}

export interface GraphHealthCheckResult {
  ok: boolean;
  checkedAt: string;
  detail: string;
}

/**
 * One driveItem entry from a Graph delta page (SP00 §9, task SP06). Mirrors
 * `GraphItemMetadata` but adds the fields delta reconciliation specifically
 * needs: `deleted` (Graph's tombstone facet — the item has been removed from
 * the drive), and `parentPath`/`parentDriveId`/`parentSiteId` so a
 * move-outside-scope can be distinguished from a rename/move-within-scope
 * without a second lookup. `webUrl` is again authorised-display-only.
 */
export interface GraphDeltaItem {
  itemId: string;
  name: string | null;
  eTag: string | null;
  webUrl: string | null;
  lastModifiedDateTime: string | null;
  sha256: string | null;
  size: number | null;
  /** True when Graph reports this item deleted (its `deleted` facet is present). */
  deleted: boolean;
  /** The parent folder's driveItem id, when Graph supplied one — used to detect a move outside the configured root folder. */
  parentItemId: string | null;
  /** The parent's drive id — a value other than the target drive means the item left the connected drive entirely (a cross-drive move, SP00 §9's "move outside the granted site/library scope"). */
  parentDriveId: string | null;
  /** Cached display path only (SP00 §6/§9) — never used for resolution. */
  parentPath: string | null;
}

/**
 * One page of a Graph `/drive/root/delta` walk (task SP06). Exactly one of
 * `nextLink`/`deltaLink` is ever non-null per Graph's own contract: more
 * pages remain (`nextLink`) or this page is the walk's final page and
 * `deltaLink` is the cursor to resume from on the next reconciliation run.
 */
export interface GraphDeltaPage {
  items: GraphDeltaItem[];
  nextLink: string | null;
  deltaLink: string | null;
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
  /**
   * Writes evidence bytes to a new driveItem (task SP03). Uses a direct PUT
   * for small files and an upload session for larger ones, but this
   * distinction is entirely internal — callers never see a session URL.
   * Always creates a new item (conflict behaviour `fail`), matching
   * `createUploadSession`'s existing "never overwrite" default.
   */
  uploadContent(
    target: GraphSiteTarget,
    parentItemPath: string,
    fileName: string,
    bytes: Buffer,
    correlationId: string,
  ): Promise<GraphUploadResult>;
  /**
   * Streams the exact pinned `itemId`/`versionId` content server-side (task
   * SP03) — never "latest" (SP00 §7). The only path any download route may
   * use; a caller must never construct a Graph content URL itself.
   */
  downloadContent(target: GraphSiteTarget, itemId: string, versionId: string, correlationId: string): Promise<Buffer>;
  /** Deletes a driveItem (task SP03, used when Paragon-side retention removes evidence bytes it owns). */
  deleteItem(target: GraphSiteTarget, itemId: string, correlationId: string): Promise<void>;
  checkHealth(target: GraphSiteTarget, correlationId: string): Promise<GraphHealthCheckResult>;
  /**
   * One page of `target`'s drive delta walk (task SP06, SP00 §9). `cursor`
   * is an opaque `deltaLink`/`nextLink` URL from a previous page/run, or
   * null to start a fresh walk from the drive root. Throws a `GraphClientError`
   * with kind `GONE` (HTTP 410) when `cursor` has expired — the caller must
   * restart with `cursor: null` and treat the result as a bounded resync,
   * never resolve it against the target's `rootFolderPath`/`rootFolderId`
   * itself (delta is always scoped to the whole drive; the reconciliation
   * service filters to the configured root).
   */
  getDelta(target: GraphSiteTarget, cursor: string | null, correlationId: string): Promise<GraphDeltaPage>;
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
