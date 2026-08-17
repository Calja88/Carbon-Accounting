/**
 * Provider-neutral client contract (task T41,
 * Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §4). Mirrors the shape of
 * `AiProvider`/`AiProviderError` (`src/lib/ai/types.ts`): one interface every
 * source implements, one error type call sites can branch on, nothing here
 * assumes legislation.gov.uk specifically. `LegislationGovUkProvider`
 * (`./legislation-gov-uk.ts`) is the first, and so far only, implementation.
 *
 * Nothing here decides applicability or persists anything — see
 * `legal-source-service.ts` (T40) for the persistence boundary this feeds.
 */

/** The two independently-cursored streams a source can be polled for (spec §4: "keep publication and effects streams/cursors separate"). */
export type LegalDiscoveryStream = "PUBLICATIONS" | "EFFECTS";

export interface DiscoveryInput {
  stream: LegalDiscoveryStream;
  /** Opaque cursor previously returned as `nextCursor`. `null`/absent starts from the beginning of the stream. */
  cursor?: string | null;
  /** Poll window start for overlap re-checking (spec §4: "poll with overlap because publication/effect metadata may appear at different times"). Providers that page purely by cursor may ignore this. */
  overlapStartAt?: Date | null;
  /** Optional jurisdiction/type filter, provider-defined encoding. */
  filterKey?: string;
}

export interface DiscoveryItem {
  /** Provider canonical identifier for the instrument this item concerns, e.g. `"uksi/2020/1"`. */
  canonicalId: string;
  /** Machine-facing item kind, provider-defined vocabulary (e.g. `"NEW_PUBLICATION"`, `"AMENDMENT"`). Deliberately a string, not an enum — see `LegalChangeEvent.eventType` (T40). */
  itemType: string;
  title: string;
  /** Provider's own event/version identifier used for idempotency downstream, when the provider supplies one. */
  providerItemId: string | null;
  detectedAt: Date;
  effectiveAt: Date | null;
  sourceUrl: string;
  /** Untouched provider payload for this item — becomes `LegalChangeEvent.rawEvidence` / instrument-version metadata verbatim, never reinterpreted here. */
  raw: Record<string, unknown>;
}

export interface DiscoveryPage {
  items: DiscoveryItem[];
  /** Cursor to resume from on the next call, or `null` when this page was the end of the stream. Never set when the page could not be fully retrieved (rate limiting, parse failure) — see `LegalContentProviderError`. */
  nextCursor: string | null;
}

export interface EffectsInput extends DiscoveryInput {
  stream: "EFFECTS";
}

export interface ProviderInstrument {
  canonicalId: string;
  instrumentType: string;
  title: string;
  year: number | null;
  number: string | null;
  madeAt: Date | null;
  publishedAt: Date | null;
  commencementAt: Date | null;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED" | "UNKNOWN";
  sourceUrl: string;
}

export interface ProviderVersion {
  canonicalId: string;
  providerVersionId: string;
  retrievedAt: Date;
  checksum: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
}

export type ProviderCircuitStatus = "CLOSED" | "OPEN";

export interface ProviderHealth {
  circuit: ProviderCircuitStatus;
  /** `true` when the provider answered a lightweight check within the timeout. `false` (with `circuit: "OPEN"` once the failure threshold is crossed) otherwise — never throws. */
  reachable: boolean;
  checkedAt: Date;
  detail: string | null;
}

/**
 * One interface every legal content source implements (spec §4). Adding a
 * second provider means a sibling file implementing this plus a case in
 * `registry.ts` — no call site outside this directory names a provider, same
 * convention as `src/lib/ai/provider-registry.ts`.
 */
export interface LegalContentProvider {
  readonly key: string;
  discoverPublications(input: DiscoveryInput): Promise<DiscoveryPage>;
  discoverEffects(input: EffectsInput): Promise<DiscoveryPage>;
  getInstrument(canonicalId: string): Promise<ProviderInstrument>;
  getVersionMetadata(canonicalId: string): Promise<ProviderVersion>;
  healthCheck(): Promise<ProviderHealth>;
}

export type LegalContentProviderErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "PARSE_ERROR"
  | "VALIDATION_ERROR"
  | "CIRCUIT_OPEN"
  | "NOT_FOUND"
  | "NETWORK_ERROR";

/**
 * A transport/parse/validation failure from a provider. `retryable` mirrors
 * `AiProviderError.retryable` (`src/lib/ai/types.ts`): callers use it to
 * decide whether to back off and try again versus surface the failure.
 * `code` is the finer-grained reason — in particular `RATE_LIMITED` is the
 * signal a caller (T42's sync worker) must treat as "do not advance the
 * stored cursor", the T41 acceptance criterion "rate limiting does not
 * advance cursor".
 */
export class LegalContentProviderError extends Error {
  constructor(
    message: string,
    readonly code: LegalContentProviderErrorCode,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "LegalContentProviderError";
  }
}
