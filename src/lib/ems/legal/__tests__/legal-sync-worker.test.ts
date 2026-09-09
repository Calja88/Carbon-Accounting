/**
 * Tests for the T42 legal sync worker (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
 * §§4,8-9). Same synthetic in-memory Prisma fake as
 * `legal-source-service.test.ts` (T40) — no live database, no live network:
 * the `LegalContentProvider` here is a fully synthetic fake, not the real
 * legislation.gov.uk client, and every title/payload below is a fabricated
 * placeholder, never real legislative text.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegalContentProviderError, type DiscoveryPage, type LegalContentProvider, type ProviderHealth, type ProviderInstrument, type ProviderVersion } from "@/lib/ems/legal/provider/types";

interface Row {
  id: string;
  [key: string]: unknown;
}

function flattenWhere(where: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    // A Prisma compound-unique key (e.g. `{ providerId_stream_filterKey: {...} }`)
    // flattens into its parts; an operator object (e.g. `{ in: [...] }`) is a
    // leaf value for its own key and must not be flattened away.
    if (value && typeof value === "object" && !(value instanceof Date) && !("in" in (value as Record<string, unknown>))) {
      Object.assign(flat, value as Record<string, unknown>);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  const flat = flattenWhere(where);
  return Object.entries(flat).every(([key, value]) => {
    if (value && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    return row[key] === value;
  });
}

const { tables, db } = vi.hoisted(() => {
  function makeTable(idPrefix: string, defaults: Record<string, unknown> = {}) {
    const rows: Row[] = [];
    let n = 0;
    return {
      rows,
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => (where ? rows.filter((r) => matches(r, where)) : [...rows])),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = { id: `${idPrefix}${++n}`, createdAt: now, updatedAt: now, ...defaults, ...data };
        rows.push(row);
        return row;
      }),
      upsert: vi.fn(
        async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const existing = rows.find((r) => matches(r, where));
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return existing;
          }
          const now = new Date();
          const row: Row = { id: `${idPrefix}${++n}`, createdAt: now, updatedAt: now, ...defaults, ...create };
          rows.push(row);
          return row;
        },
      ),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const existing = rows.find((r) => matches(r, where));
        if (!existing) throw new Error(`update: no row matches ${JSON.stringify(where)}`);
        Object.assign(existing, data, { updatedAt: new Date() });
        return existing;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const row of matched) Object.assign(row, data, { updatedAt: new Date() });
        return { count: matched.length };
      }),
    };
  }

  const tables = {
    jurisdiction: makeTable("jur-"),
    legalTopic: makeTable("topic-"),
    legalSourceProvider: makeTable("prov-"),
    legalSyncCursor: makeTable("cursor-"),
    legalInstrument: makeTable("inst-"),
    legalInstrumentJurisdiction: makeTable("instjur-"),
    legalInstrumentTopic: makeTable("insttopic-"),
    legalInstrumentVersion: makeTable("ver-"),
    legalProvisionReference: makeTable("prov-ref-"),
    legalChangeEvent: makeTable("evt-", { status: "DETECTED" }),
  };

  function snapshot() {
    return Object.fromEntries(Object.entries(tables).map(([key, table]) => [key, table.rows.map((r) => ({ ...r }))]));
  }
  function restore(snap: Record<string, Row[]>) {
    for (const [key, rows] of Object.entries(snap)) {
      const table = tables[key as keyof typeof tables];
      table.rows.length = 0;
      table.rows.push(...rows);
    }
  }

  const db = {
    ...tables,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = snapshot();
      try {
        return await fn(db);
      } catch (error) {
        restore(snap);
        throw error;
      }
    }),
  };

  return { tables, db };
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));

const { registerLegalSourceProvider } = await import("@/lib/ems/legal/legal-source-service");
const { runLegalSyncCycle, makeLegalSyncJobHandler, LEGAL_SYNC_JOB_TOPIC } = await import("@/lib/ems/legal/legal-sync-worker");

function resetAll() {
  for (const table of Object.values(tables)) table.rows.length = 0;
}

async function seedProvider(key = "legislation-gov-uk") {
  return registerLegalSourceProvider({ key, name: "legislation.gov.uk (test)", authorityType: "OFFICIAL" }, db as never);
}

function providerInstrument(canonicalId: string, overrides: Partial<ProviderInstrument> = {}): ProviderInstrument {
  return {
    canonicalId,
    instrumentType: "UK_STATUTORY_INSTRUMENT",
    title: `Test Order relating to ${canonicalId}`,
    year: 2026,
    number: "1",
    madeAt: null,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    commencementAt: null,
    status: "ACTIVE",
    sourceUrl: `https://example.invalid/${canonicalId}`,
    ...overrides,
  };
}

function providerVersion(canonicalId: string, overrides: Partial<ProviderVersion> = {}): ProviderVersion {
  return {
    canonicalId,
    providerVersionId: `${canonicalId}:v1`,
    retrievedAt: new Date("2026-01-01T00:00:00Z"),
    checksum: `checksum-${canonicalId}-v1`,
    sourceUrl: `https://example.invalid/${canonicalId}`,
    metadata: { synthetic: true },
    ...overrides,
  };
}

/** A fully synthetic `LegalContentProvider` — every response below is a fabricated fixture, never real legislative text. */
class FakeProvider implements LegalContentProvider {
  readonly key = "legislation-gov-uk";
  publicationsPages: DiscoveryPage[] = [{ items: [], nextCursor: null }];
  effectsPages: DiscoveryPage[] = [{ items: [], nextCursor: null }];
  instruments = new Map<string, ProviderInstrument>();
  versions = new Map<string, ProviderVersion>();
  instrumentErrors = new Map<string, LegalContentProviderError>();
  discoveryError: LegalContentProviderError | null = null;

  async discoverPublications(): Promise<DiscoveryPage> {
    if (this.discoveryError) throw this.discoveryError;
    return this.publicationsPages.shift() ?? { items: [], nextCursor: null };
  }

  async discoverEffects(): Promise<DiscoveryPage> {
    if (this.discoveryError) throw this.discoveryError;
    return this.effectsPages.shift() ?? { items: [], nextCursor: null };
  }

  async getInstrument(canonicalId: string): Promise<ProviderInstrument> {
    const err = this.instrumentErrors.get(canonicalId);
    if (err) throw err;
    const instrument = this.instruments.get(canonicalId);
    if (!instrument) throw new LegalContentProviderError(`No fixture instrument for "${canonicalId}".`, "NOT_FOUND", false);
    return instrument;
  }

  async getVersionMetadata(canonicalId: string): Promise<ProviderVersion> {
    const version = this.versions.get(canonicalId);
    if (!version) throw new LegalContentProviderError(`No fixture version for "${canonicalId}".`, "NOT_FOUND", false);
    return version;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return { circuit: "CLOSED", reachable: true, checkedAt: new Date(), detail: null };
  }
}

describe("runLegalSyncCycle", () => {
  beforeEach(() => resetAll());

  it("upserts the instrument/version/event, triages the event, and advances the cursor after the page commits", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    fake.publicationsPages = [
      {
        items: [
          {
            canonicalId: "uksi/2026/1",
            itemType: "UK_STATUTORY_INSTRUMENT",
            title: "Test Order 2026",
            providerItemId: "ev-1",
            detectedAt: new Date("2026-01-05T00:00:00Z"),
            effectiveAt: null,
            sourceUrl: "https://example.invalid/uksi/2026/1",
            raw: { synthetic: true },
          },
        ],
        nextCursor: null,
      },
    ];
    fake.instruments.set("uksi/2026/1", providerInstrument("uksi/2026/1"));
    fake.versions.set("uksi/2026/1", providerVersion("uksi/2026/1"));

    const now = new Date("2026-01-06T00:00:00Z");
    const result = await runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake, now });

    expect(result).toEqual({ pagesProcessed: 1, itemsWritten: 1, itemsSkipped: 0, cursorAdvancedTo: null });
    expect(tables.legalInstrument.rows).toHaveLength(1);
    expect(tables.legalInstrumentVersion.rows).toHaveLength(1);
    expect(tables.legalChangeEvent.rows).toHaveLength(1);
    expect(tables.legalChangeEvent.rows[0].status).toBe("TRIAGED");

    const cursor = tables.legalSyncCursor.rows[0];
    expect(cursor.status).toBe("ACTIVE");
    expect(cursor.lastSuccessAt).not.toBeNull();
    expect((cursor.overlapStartAt as Date).getTime()).toBe(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  });

  it("replaying the same discovery page twice creates no duplicate rows", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    const page: DiscoveryPage = {
      items: [
        {
          canonicalId: "uksi/2026/1",
          itemType: "UK_STATUTORY_INSTRUMENT",
          title: "Test Order 2026",
          providerItemId: "ev-1",
          detectedAt: new Date("2026-01-05T00:00:00Z"),
          effectiveAt: null,
          sourceUrl: "https://example.invalid/uksi/2026/1",
          raw: { synthetic: true },
        },
      ],
      nextCursor: null,
    };
    fake.instruments.set("uksi/2026/1", providerInstrument("uksi/2026/1"));
    fake.versions.set("uksi/2026/1", providerVersion("uksi/2026/1"));

    fake.publicationsPages = [page];
    await runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake });

    fake.publicationsPages = [page];
    await runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake });

    expect(tables.legalInstrument.rows).toHaveLength(1);
    expect(tables.legalInstrumentVersion.rows).toHaveLength(1);
    expect(tables.legalChangeEvent.rows).toHaveLength(1);
  });

  it("aborts the page and never advances the cursor on a transient provider error", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    fake.discoveryError = new LegalContentProviderError("Too many requests.", "RATE_LIMITED", true);

    await expect(
      runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake }),
    ).rejects.toThrow("Too many requests.");

    expect(tables.legalInstrument.rows).toHaveLength(0);
    const cursor = tables.legalSyncCursor.rows[0];
    expect(cursor.status).toBe("ERROR");
    expect(cursor.cursor).toBeUndefined();
    expect(cursor.lastSuccessAt).toBeUndefined();
    expect(cursor.lastAttemptAt).not.toBeNull();
  });

  it("skips a permanently-failing item without failing the rest of the page", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    fake.publicationsPages = [
      {
        items: [
          {
            canonicalId: "uksi/2026/1",
            itemType: "UK_STATUTORY_INSTRUMENT",
            title: "Test Order 2026",
            providerItemId: "ev-1",
            detectedAt: new Date("2026-01-05T00:00:00Z"),
            effectiveAt: null,
            sourceUrl: "https://example.invalid/uksi/2026/1",
            raw: {},
          },
          {
            canonicalId: "uksi/2026/2",
            itemType: "UK_STATUTORY_INSTRUMENT",
            title: "Withdrawn Order 2026",
            providerItemId: "ev-2",
            detectedAt: new Date("2026-01-05T00:00:00Z"),
            effectiveAt: null,
            sourceUrl: "https://example.invalid/uksi/2026/2",
            raw: {},
          },
        ],
        nextCursor: null,
      },
    ];
    fake.instruments.set("uksi/2026/1", providerInstrument("uksi/2026/1"));
    fake.versions.set("uksi/2026/1", providerVersion("uksi/2026/1"));
    fake.instrumentErrors.set("uksi/2026/2", new LegalContentProviderError("Gone.", "NOT_FOUND", false));

    const result = await runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake });

    expect(result.itemsWritten).toBe(1);
    expect(result.itemsSkipped).toBe(1);
    expect(tables.legalInstrument.rows).toHaveLength(1);
    // The whole page still committed — the cursor advanced despite the skip.
    expect(tables.legalSyncCursor.rows[0].status).toBe("ACTIVE");
  });

  it("accepts a delayed EFFECTS item for an instrument already known from PUBLICATIONS without replacing its history", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    fake.instruments.set("uksi/2026/1", providerInstrument("uksi/2026/1"));
    fake.versions.set("uksi/2026/1", providerVersion("uksi/2026/1"));
    fake.publicationsPages = [
      {
        items: [
          {
            canonicalId: "uksi/2026/1",
            itemType: "UK_STATUTORY_INSTRUMENT",
            title: "Test Order 2026",
            providerItemId: "ev-1",
            detectedAt: new Date("2026-01-05T00:00:00Z"),
            effectiveAt: null,
            sourceUrl: "https://example.invalid/uksi/2026/1",
            raw: {},
          },
        ],
        nextCursor: null,
      },
    ];
    await runLegalSyncCycle({ providerKey: provider.key as string, stream: "PUBLICATIONS" as never, provider: fake });
    const firstVersionId = tables.legalInstrumentVersion.rows[0].id;

    // A later, independent poll of the EFFECTS stream reports an amendment
    // against the same instrument, arriving after the original publication.
    fake.versions.set("uksi/2026/1", providerVersion("uksi/2026/1", { providerVersionId: "uksi/2026/1:v2", checksum: "checksum-uksi/2026/1-v2" }));
    fake.effectsPages = [
      {
        items: [
          {
            canonicalId: "uksi/2026/1",
            itemType: "AMENDMENT",
            title: "Amendment to Test Order 2026",
            providerItemId: "ev-3",
            detectedAt: new Date("2026-02-01T00:00:00Z"),
            effectiveAt: new Date("2026-03-01T00:00:00Z"),
            sourceUrl: "https://example.invalid/uksi/2026/1",
            raw: {},
          },
        ],
        nextCursor: null,
      },
    ];
    await runLegalSyncCycle({ providerKey: provider.key as string, stream: "EFFECTS" as never, provider: fake });

    expect(tables.legalInstrument.rows).toHaveLength(1);
    expect(tables.legalInstrumentVersion.rows).toHaveLength(2);
    expect(tables.legalInstrumentVersion.rows[0].id).toBe(firstVersionId);
    expect(tables.legalChangeEvent.rows).toHaveLength(2);
    expect(tables.legalChangeEvent.rows.map((r) => r.eventType)).toEqual(["UK_STATUTORY_INSTRUMENT", "AMENDMENT"]);
  });

  it("rejects an unknown provider key without touching any table", async () => {
    const fake = new FakeProvider();
    await expect(
      runLegalSyncCycle({ providerKey: "not-registered", stream: "PUBLICATIONS" as never, provider: fake }),
    ).rejects.toThrow(/Unknown legal source provider/);
    expect(tables.legalSyncCursor.rows).toHaveLength(0);
  });
});

describe("makeLegalSyncJobHandler", () => {
  beforeEach(() => resetAll());

  function outboxMessage(payload: unknown) {
    return {
      id: "outbox-1",
      organisationId: null,
      topic: LEGAL_SYNC_JOB_TOPIC,
      version: 1,
      payload,
      idempotencyKey: "key-1",
      status: "LEASED" as const,
      availableAt: new Date(),
      leaseOwner: "worker-1",
      leaseUntil: new Date(Date.now() + 60_000),
      attempts: 1,
      maxAttempts: 8,
      lastErrorCode: null,
      lastErrorMessage: null,
      correlationId: "corr-1",
      source: "test",
      completedAt: null,
      deadLetteredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("resolves the provider by key from the payload and runs a sync cycle", async () => {
    const provider = await seedProvider();
    const fake = new FakeProvider();
    const resolveProvider = vi.fn().mockReturnValue(fake);
    const handler = makeLegalSyncJobHandler(resolveProvider);

    await handler(outboxMessage({ providerKey: provider.key, stream: "PUBLICATIONS" }) as never);

    expect(resolveProvider).toHaveBeenCalledWith(provider.key);
    expect(tables.legalSyncCursor.rows).toHaveLength(1);
  });

  it("throws a JobHandlerError for a malformed payload instead of calling the provider resolver", async () => {
    const resolveProvider = vi.fn();
    const handler = makeLegalSyncJobHandler(resolveProvider);

    await expect(handler(outboxMessage({ providerKey: "x" }) as never)).rejects.toThrow(/payload/i);
    expect(resolveProvider).not.toHaveBeenCalled();
  });
});
