/**
 * Repository-layer tests for the T40 provider-neutral legal schema
 * (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §§1-3). No live database — a
 * synthetic in-memory fake stands in for `prisma`, matching the pattern in
 * outbox-service.test.ts. `$transaction` snapshots every table before
 * running the callback and restores the snapshot if the callback throws, so
 * the "cursor advances only after batch commit" acceptance criterion can be
 * verified without a real database transaction.
 */

import { describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  [key: string]: unknown;
}

function flattenWhere(where: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      Object.assign(flat, value as Record<string, unknown>);
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  const flat = flattenWhere(where);
  return Object.entries(flat).every(([key, value]) => row[key] === value);
}

const { tables, db } = vi.hoisted(() => {
  // `defaults` stands in for the Prisma schema `@default(...)` values the
  // real client applies on create — the mock has no schema to read them
  // from, so a table with a defaulted column (e.g. LegalChangeEvent.status)
  // must supply it explicitly, same as the fakes in outbox-service.test.ts.
  function makeTable(idPrefix: string, defaults: Record<string, unknown> = {}) {
    const rows: Row[] = [];
    let n = 0;
    return {
      rows,
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return rows.find((r) => matches(r, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
        return where ? rows.filter((r) => matches(r, where)) : [...rows];
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = { id: `${idPrefix}${++n}`, createdAt: now, updatedAt: now, ...defaults, ...data };
        rows.push(row);
        return row;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: Record<string, unknown>;
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
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

const {
  registerJurisdiction,
  registerLegalTopic,
  registerLegalSourceProvider,
  upsertLegalInstrument,
  recordLegalInstrumentVersion,
  recordLegalChangeEvent,
  applyLegalSyncBatch,
  getOrCreateSyncCursor,
  LegalSourceError,
} = await import("@/lib/ems/legal/legal-source-service");

function resetAll() {
  for (const table of Object.values(tables)) table.rows.length = 0;
}

async function seedProvider(key = "legislation-gov-uk") {
  return registerLegalSourceProvider({ key, name: "legislation.gov.uk", authorityType: "OFFICIAL" }, db as never);
}

describe("reference data registration", () => {
  it("registerJurisdiction is idempotent by code", async () => {
    resetAll();
    const first = await registerJurisdiction({ code: "GB-ENG", name: "England", country: "GB" }, db as never);
    const second = await registerJurisdiction({ code: "GB-ENG", name: "England (updated)", country: "GB" }, db as never);
    expect(second.id).toBe(first.id);
    expect(tables.jurisdiction.rows).toHaveLength(1);
    expect(second.name).toBe("England (updated)");
  });

  it("registerLegalTopic is idempotent by key", async () => {
    resetAll();
    const first = await registerLegalTopic({ key: "waste", name: "Waste" }, db as never);
    const second = await registerLegalTopic({ key: "waste", name: "Waste management" }, db as never);
    expect(second.id).toBe(first.id);
    expect(tables.legalTopic.rows).toHaveLength(1);
  });

  it("registerLegalSourceProvider is idempotent by key", async () => {
    resetAll();
    const first = await seedProvider();
    const second = await seedProvider();
    expect(second.id).toBe(first.id);
    expect(tables.legalSourceProvider.rows).toHaveLength(1);
  });
});

describe("upsertLegalInstrument", () => {
  it("is idempotent by (providerId, canonicalId) and links jurisdictions/topics without duplicating", async () => {
    resetAll();
    const provider = await seedProvider();
    await registerJurisdiction({ code: "GB-ENG", name: "England", country: "GB" }, db as never);
    await registerLegalTopic({ key: "waste", name: "Waste" }, db as never);

    const input = {
      providerKey: provider.key as string,
      canonicalId: "uksi/2020/1",
      instrumentType: "UK_STATUTORY_INSTRUMENT",
      title: "Test Statutory Instrument",
      jurisdictionCodes: ["GB-ENG"],
      topicKeys: ["waste"],
    };

    const first = await upsertLegalInstrument(db as never, input);
    const second = await upsertLegalInstrument(db as never, { ...input, title: "Test Statutory Instrument (amended)" });

    expect(second.id).toBe(first.id);
    expect(tables.legalInstrument.rows).toHaveLength(1);
    expect(second.title).toBe("Test Statutory Instrument (amended)");
    expect(tables.legalInstrumentJurisdiction.rows).toHaveLength(1);
    expect(tables.legalInstrumentTopic.rows).toHaveLength(1);
  });

  it("throws LegalSourceError for an unknown provider or jurisdiction/topic reference", async () => {
    resetAll();
    await expect(
      upsertLegalInstrument(db as never, {
        providerKey: "not-registered",
        canonicalId: "x",
        instrumentType: "T",
        title: "T",
      }),
    ).rejects.toThrow(LegalSourceError);

    const provider = await seedProvider();
    await expect(
      upsertLegalInstrument(db as never, {
        providerKey: provider.key as string,
        canonicalId: "x",
        instrumentType: "T",
        title: "T",
        jurisdictionCodes: ["does-not-exist"],
      }),
    ).rejects.toThrow(LegalSourceError);
  });
});

describe("recordLegalInstrumentVersion — append-only provenance", () => {
  it("is idempotent by (instrumentId, providerVersionId) and never overwrites the first-written checksum", async () => {
    resetAll();
    const provider = await seedProvider();
    const instrument = await upsertLegalInstrument(db as never, {
      providerKey: provider.key as string,
      canonicalId: "uksi/2020/1",
      instrumentType: "UK_STATUTORY_INSTRUMENT",
      title: "Test SI",
    });

    const first = await recordLegalInstrumentVersion(db as never, instrument.id as string, {
      providerVersionId: "v1",
      retrievedAt: new Date("2026-01-01T00:00:00Z"),
      metadata: {},
      checksum: "checksum-1",
      sourceUrl: "https://example.test/v1",
    });

    // A repeated retrieval of the same provider version — even with a
    // (implausible) different checksum — must never overwrite the
    // original row: source provenance is immutable once recorded.
    const second = await recordLegalInstrumentVersion(db as never, instrument.id as string, {
      providerVersionId: "v1",
      retrievedAt: new Date("2026-01-02T00:00:00Z"),
      metadata: {},
      checksum: "checksum-tampered",
      sourceUrl: "https://example.test/v1",
    });

    expect(second.id).toBe(first.id);
    expect(second.checksum).toBe("checksum-1");
    expect(tables.legalInstrumentVersion.rows).toHaveLength(1);
  });
});

describe("recordLegalChangeEvent — idempotency", () => {
  it("collapses a repeated (providerId, dedupeKey) onto the existing row instead of creating a duplicate", async () => {
    resetAll();
    const provider = await seedProvider();
    const instrument = await upsertLegalInstrument(db as never, {
      providerKey: provider.key as string,
      canonicalId: "uksi/2020/1",
      instrumentType: "UK_STATUTORY_INSTRUMENT",
      title: "Test SI",
    });

    const baseInput = {
      providerEventId: "ev-1",
      eventType: "AMENDMENT",
      sourceInstrumentId: instrument.id as string,
      detectedAt: new Date("2026-01-01T00:00:00Z"),
      rawEvidence: { note: "synthetic fixture" },
    };

    const first = await recordLegalChangeEvent(db as never, provider.id as string, baseInput);
    const second = await recordLegalChangeEvent(db as never, provider.id as string, baseInput);

    expect(second.id).toBe(first.id);
    expect(tables.legalChangeEvent.rows).toHaveLength(1);
    expect(second.status).toBe("DETECTED");
  });

  it("derives a deterministic dedupe key when no providerEventId is supplied", async () => {
    resetAll();
    const provider = await seedProvider();
    const instrument = await upsertLegalInstrument(db as never, {
      providerKey: provider.key as string,
      canonicalId: "uksi/2020/1",
      instrumentType: "UK_STATUTORY_INSTRUMENT",
      title: "Test SI",
    });

    const baseInput = {
      providerEventId: "",
      eventType: "AMENDMENT",
      sourceInstrumentId: instrument.id as string,
      detectedAt: new Date("2026-01-01T00:00:00Z"),
      rawEvidence: { note: "synthetic fixture" },
    };

    const first = await recordLegalChangeEvent(db as never, provider.id as string, baseInput);
    const second = await recordLegalChangeEvent(db as never, provider.id as string, { ...baseInput });

    expect(second.id).toBe(first.id);
    expect(tables.legalChangeEvent.rows).toHaveLength(1);
  });

  it("never sets anything resembling an applicability/compliance decision", async () => {
    resetAll();
    const provider = await seedProvider();
    const instrument = await upsertLegalInstrument(db as never, {
      providerKey: provider.key as string,
      canonicalId: "uksi/2020/1",
      instrumentType: "UK_STATUTORY_INSTRUMENT",
      title: "Test SI",
    });
    const event = await recordLegalChangeEvent(db as never, provider.id as string, {
      providerEventId: "ev-2",
      eventType: "AMENDMENT",
      sourceInstrumentId: instrument.id as string,
      detectedAt: new Date(),
      rawEvidence: { note: "synthetic fixture" },
    });
    expect(Object.keys(event)).not.toContain("applicability");
    expect(Object.keys(event)).not.toContain("complianceDecision");
    expect(event.status).toBe("DETECTED");
  });
});

describe("applyLegalSyncBatch — transactional cursor advance", () => {
  it("advances the cursor only after the batch's writes commit", async () => {
    resetAll();
    const provider = await seedProvider();

    const result = await applyLegalSyncBatch(
      { providerKey: provider.key as string, stream: "PUBLICATIONS" as never, nextCursor: "cursor-page-2" },
      async (tx) => {
        return upsertLegalInstrument(tx as never, {
          providerKey: provider.key as string,
          canonicalId: "uksi/2020/1",
          instrumentType: "UK_STATUTORY_INSTRUMENT",
          title: "Test SI",
        });
      },
    );

    expect(result.canonicalId).toBe("uksi/2020/1");
    const cursor = await getOrCreateSyncCursor(db as never, provider.id as string, "PUBLICATIONS" as never);
    expect(cursor.cursor).toBe("cursor-page-2");
    expect(cursor.lastSuccessAt).not.toBeNull();
  });

  it("leaves the cursor and any partial writes untouched when the batch throws", async () => {
    resetAll();
    const provider = await seedProvider();

    // Establish a cursor at a known position first.
    await applyLegalSyncBatch(
      { providerKey: provider.key as string, stream: "PUBLICATIONS" as never, nextCursor: "cursor-page-1" },
      async () => undefined,
    );

    await expect(
      applyLegalSyncBatch(
        { providerKey: provider.key as string, stream: "PUBLICATIONS" as never, nextCursor: "cursor-page-2" },
        async (tx) => {
          await upsertLegalInstrument(tx as never, {
            providerKey: provider.key as string,
            canonicalId: "uksi/2020/2",
            instrumentType: "UK_STATUTORY_INSTRUMENT",
            title: "Should be rolled back",
          });
          throw new Error("simulated failure partway through the batch");
        },
      ),
    ).rejects.toThrow("simulated failure partway through the batch");

    const cursor = await getOrCreateSyncCursor(db as never, provider.id as string, "PUBLICATIONS" as never);
    expect(cursor.cursor).toBe("cursor-page-1");
    expect(tables.legalInstrument.rows.find((r) => r.canonicalId === "uksi/2020/2")).toBeUndefined();
  });
});
