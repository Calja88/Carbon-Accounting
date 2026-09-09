/**
 * `LegalContentProvider` implementation for legislation.gov.uk (task T41,
 * Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §4). The only file that knows
 * legislation.gov.uk's URL scheme — a second provider is a sibling file plus
 * a case in `registry.ts`, same convention as `providers/openrouter.ts`.
 *
 * legislation.gov.uk exposes:
 *  - `/new/data.feed` — an Atom feed of newly published legislation, the
 *    PUBLICATIONS stream;
 *  - `/changes/data.feed` — an Atom feed of amendment/commencement effects,
 *    the EFFECTS stream (spec §4: "keep publication and effects
 *    streams/cursors separate" — two paths, two cursors, never mixed);
 *  - `{type}/{year}/{number}/data.feed` — a single-entry Atom feed for one
 *    instrument, used for both `getInstrument` and `getVersionMetadata`.
 * (https://www.legislation.gov.uk/developer/formats,
 * https://www.legislation.gov.uk/developer/uris.)
 *
 * This sandbox's outbound network policy denies legislation.gov.uk (see
 * `__fixtures__/legislation-gov-uk/README.md`), so none of this has been
 * exercised against the live site in this session — only against the
 * recorded/constructed fixtures under `__fixtures__/`. Nothing here claims
 * live verification.
 *
 * No credentials: legislation.gov.uk is a public, unauthenticated feed. The
 * only "respectful client" obligation is an identifying `User-Agent`
 * (legislation.gov.uk's usage guidance asks automated/bulk clients to
 * identify themselves), which `http-client.ts` sends on every request.
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "@/lib/audit/integrity";
import { CircuitBreaker, fetchWithPolicy } from "./http-client";
import { parseAtomFeed, toCanonicalId, type ParsedAtomEntry } from "./atom-parser";
import {
  discoveryPageSchema,
  providerHealthSchema,
  providerInstrumentSchema,
  providerVersionSchema,
} from "./schemas";
import {
  LegalContentProviderError,
  type DiscoveryInput,
  type DiscoveryItem,
  type DiscoveryPage,
  type EffectsInput,
  type LegalContentProvider,
  type LegalDiscoveryStream,
  type ProviderHealth,
  type ProviderInstrument,
  type ProviderVersion,
} from "./types";

const DEFAULT_BASE_URL = "https://www.legislation.gov.uk";
const PUBLICATIONS_PATH = "/new/data.feed";
const EFFECTS_PATH = "/changes/data.feed";
/** legislation.gov.uk is a public, unauthenticated feed — `.invalid` (RFC 2606) is a placeholder that cannot resolve to a real inbox; set `LEGAL_PROVIDER_CONTACT` to a real address before any production sync run. */
const DEFAULT_USER_AGENT = "ParagonEMS-LegalRegister/1.0 (+https://github.com/calja88/carbon-accounting; contact: legal-register@paragon-ems.invalid)";

export interface LegislationGovUkProviderOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxResponseBytes?: number;
  /** Absolute ceiling on the Atom `page` query parameter a discovery call will ever request or hand back as a cursor — guards against an unbounded `next`-link chain (spec §4: "pagination ceiling"). */
  maxPages?: number;
  /** Injectable so tests can share (or isolate) circuit-breaker state; defaults to a fresh breaker per provider instance. */
  circuit?: CircuitBreaker;
}

function extractPageNumber(url: string): number {
  try {
    const page = new URL(url).searchParams.get("page");
    const n = page ? Number(page) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

function mapEntry(entry: ParsedAtomEntry, stream: LegalDiscoveryStream): DiscoveryItem | null {
  const primaryUri = stream === "EFFECTS" ? entry.legAffectedUri ?? entry.alternateHref ?? entry.id : entry.alternateHref ?? entry.id;
  const detectedAt = entry.updated ?? entry.published;
  if (!primaryUri || !detectedAt) {
    // Missing the URI to key off, or no timestamp to order by — this one
    // entry cannot be safely used. Dropped, not fatal to the page (T41
    // acceptance: partial responses fail safely rather than all-or-nothing).
    return null;
  }

  let canonicalId: string;
  try {
    canonicalId = toCanonicalId(primaryUri);
  } catch {
    return null;
  }

  return {
    canonicalId,
    itemType: (stream === "EFFECTS" ? entry.legType : entry.dcType) ?? (stream === "EFFECTS" ? "EFFECT" : "PUBLICATION"),
    title: entry.title ?? canonicalId,
    providerItemId: entry.id,
    detectedAt,
    effectiveAt: stream === "EFFECTS" ? entry.legAppliedDate ?? null : null,
    sourceUrl: entry.alternateHref ?? entry.id,
    raw: JSON.parse(JSON.stringify(entry.raw)) as Record<string, unknown>,
  };
}

export class LegislationGovUkProvider implements LegalContentProvider {
  readonly key = "legislation-gov-uk";

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly maxPages: number;
  private readonly circuit: CircuitBreaker;
  private readonly httpOptions: { fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number; maxResponseBytes?: number };

  constructor(options: LegislationGovUkProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? process.env.LEGAL_PROVIDER_CONTACT ?? DEFAULT_USER_AGENT;
    this.maxPages = options.maxPages ?? 50;
    this.circuit = options.circuit ?? new CircuitBreaker();
    this.httpOptions = {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      maxResponseBytes: options.maxResponseBytes,
    };
  }

  private buildDiscoveryUrl(path: string, input: DiscoveryInput): string {
    if (input.cursor) return input.cursor;
    const url = new URL(`${this.baseUrl}${path}`);
    if (input.filterKey) url.searchParams.set("type", input.filterKey);
    if (input.overlapStartAt) url.searchParams.set("from", input.overlapStartAt.toISOString().slice(0, 10));
    return url.toString();
  }

  private async fetchAndParseFeed(url: string) {
    const xml = await fetchWithPolicy(url, { ...this.httpOptions, userAgent: this.userAgent }, this.circuit);
    return parseAtomFeed(xml);
  }

  private async discover(path: string, stream: LegalDiscoveryStream, input: DiscoveryInput): Promise<DiscoveryPage> {
    const url = this.buildDiscoveryUrl(path, input);
    const pageNumber = extractPageNumber(url);
    if (pageNumber > this.maxPages) {
      throw new LegalContentProviderError(`Refusing to request page ${pageNumber}; pagination ceiling is ${this.maxPages}.`, "VALIDATION_ERROR", false);
    }

    const parsed = await this.fetchAndParseFeed(url);

    const items: DiscoveryItem[] = [];
    for (const entry of parsed.entries) {
      const item = mapEntry(entry, stream);
      if (item) items.push(item);
    }

    let nextCursor: string | null = parsed.nextHref;
    if (nextCursor && extractPageNumber(nextCursor) > this.maxPages) {
      // The provider's own next-link points past our ceiling — end the
      // stream here rather than handing back a cursor nothing will ever
      // redeem.
      nextCursor = null;
    }

    const page: DiscoveryPage = { items, nextCursor };
    const validated = discoveryPageSchema.safeParse(page);
    if (!validated.success) {
      throw new LegalContentProviderError(`Discovery page failed schema validation: ${validated.error.message}`, "VALIDATION_ERROR", false);
    }
    return validated.data as DiscoveryPage;
  }

  async discoverPublications(input: DiscoveryInput): Promise<DiscoveryPage> {
    return this.discover(PUBLICATIONS_PATH, "PUBLICATIONS", input);
  }

  async discoverEffects(input: EffectsInput): Promise<DiscoveryPage> {
    return this.discover(EFFECTS_PATH, "EFFECTS", input);
  }

  async getInstrument(canonicalId: string): Promise<ProviderInstrument> {
    const url = `${this.baseUrl}/${canonicalId}/data.feed`;
    const parsed = await this.fetchAndParseFeed(url);
    const entry = parsed.entries[0];
    if (!entry) {
      throw new LegalContentProviderError(`No instrument found at "${canonicalId}".`, "NOT_FOUND", false);
    }

    const segments = canonicalId.split("/");
    const yearSegment = Number(segments[1]);

    const instrument: ProviderInstrument = {
      canonicalId,
      instrumentType: entry.dcType ?? "UNKNOWN",
      title: entry.title ?? canonicalId,
      year: Number.isFinite(yearSegment) ? yearSegment : null,
      number: segments[2] ?? null,
      madeAt: null,
      publishedAt: entry.published,
      commencementAt: null,
      status: "UNKNOWN",
      sourceUrl: entry.alternateHref ?? entry.id,
    };

    const validated = providerInstrumentSchema.safeParse(instrument);
    if (!validated.success) {
      throw new LegalContentProviderError(`Instrument response failed schema validation: ${validated.error.message}`, "VALIDATION_ERROR", false);
    }
    return validated.data as ProviderInstrument;
  }

  async getVersionMetadata(canonicalId: string): Promise<ProviderVersion> {
    const url = `${this.baseUrl}/${canonicalId}/data.feed`;
    const parsed = await this.fetchAndParseFeed(url);
    const entry = parsed.entries[0];
    if (!entry) {
      throw new LegalContentProviderError(`No instrument found at "${canonicalId}".`, "NOT_FOUND", false);
    }

    const rawMetadata = JSON.parse(JSON.stringify(entry.raw)) as Record<string, unknown>;
    const checksum = createHash("sha256").update(canonicalStringify(rawMetadata)).digest("hex");

    const version: ProviderVersion = {
      canonicalId,
      providerVersionId: entry.updated?.toISOString() ?? entry.id,
      retrievedAt: new Date(),
      checksum,
      sourceUrl: entry.alternateHref ?? entry.id,
      metadata: rawMetadata,
    };

    const validated = providerVersionSchema.safeParse(version);
    if (!validated.success) {
      throw new LegalContentProviderError(`Version metadata failed schema validation: ${validated.error.message}`, "VALIDATION_ERROR", false);
    }
    return validated.data as ProviderVersion;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = new Date();
    try {
      await fetchWithPolicy(`${this.baseUrl}${PUBLICATIONS_PATH}`, { ...this.httpOptions, userAgent: this.userAgent, maxRetries: 0 }, this.circuit);
      const health: ProviderHealth = { circuit: this.circuit.status, reachable: true, checkedAt, detail: null };
      return providerHealthSchema.parse(health);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const health: ProviderHealth = { circuit: this.circuit.status, reachable: false, checkedAt, detail };
      return providerHealthSchema.parse(health);
    }
  }
}
