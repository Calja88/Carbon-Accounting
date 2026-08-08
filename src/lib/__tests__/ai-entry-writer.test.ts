import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiDataEntryMode, Prisma, Role } from "@prisma/client";
import type { AiActor } from "@/lib/ai/scope";

/**
 * The single path from something the assistant worked out to a real entry.
 *
 * These tests cover what a reviewer would want to know about that path: that
 * the emissions figure comes from the calculation engine and not from
 * anything AI produced, that provenance is written with the row rather than
 * patched on afterwards, that a failed condition produces a question instead
 * of an entry, and that a retried write cannot land twice.
 *
 * Prisma and the calculation pipeline are mocked — the arithmetic itself is
 * tested in calc-engine.test.ts, and what matters here is which values reach
 * the pipeline and what is done with the result.
 */

const mocks = vi.hoisted(() => ({
  dataPointFindUnique: vi.fn(),
  siteFindUnique: vi.fn(),
  entryFindUnique: vi.fn(),
  entryFindMany: vi.fn(),
  entryFindUniqueOrThrow: vi.fn(),
  extractionUpdate: vi.fn(),
  documentUpdate: vi.fn(),
  suggestionCreate: vi.fn(),
  factorFindMany: vi.fn(),
  createEntry: vi.fn(),
  previewFactor: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityDataPoint: { findUnique: mocks.dataPointFindUnique },
    site: { findUnique: mocks.siteFindUnique },
    activityEntry: {
      findUnique: mocks.entryFindUnique,
      findMany: mocks.entryFindMany,
      findUniqueOrThrow: mocks.entryFindUniqueOrThrow,
    },
    documentExtraction: { update: mocks.extractionUpdate },
    sourceDocument: { update: mocks.documentUpdate },
    aiSuggestion: { create: mocks.suggestionCreate },
    emissionFactor: { findMany: mocks.factorFindMany },
  },
}));

vi.mock("@/lib/entries-service", () => ({
  createActivityEntryWithCalculations: mocks.createEntry,
  previewFactorResolution: mocks.previewFactor,
}));

const { logEntryCandidate } = await import("@/lib/ai/entry-writer");
type EntryCandidate = Parameters<typeof logEntryCandidate>[1];

const actor: AiActor = {
  userId: "user-1",
  name: "Test User",
  role: Role.SUSTAINABILITY_LEAD,
  isAdmin: false,
  entityIds: ["entity-a"],
  siteIds: ["site-a1"],
};

function candidate(overrides: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    key: "doc-1:electricity",
    label: "Grid electricity consumption",
    dataPointCode: "S2-01",
    siteId: "site-a1",
    quantity: 18420,
    unit: "kWh",
    periodInput: "2026-07",
    subtypeKey: null,
    supplierName: null,
    sourceDocumentId: "doc-1",
    extractionId: "extraction-1",
    basis: "Electricity consumption in kWh read from the document.",
    warnings: [],
    conflicts: [],
    invoiceNumber: "INV-8812",
    meterNumber: null,
    documentSha256: "abc",
    ...overrides,
  };
}

const OPTIONS = {
  mode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE,
  trigger: "DOCUMENT" as const,
  turnRequestId: "turn-1",
  interactionId: "interaction-1",
  allowDuplicate: false,
};

/** The entry as it reads back after the pipeline has calculated it. */
function writtenEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-new",
    rawValue: 18420,
    rawUnit: "kWh",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    status: "SUBMITTED",
    plausibilityFlagged: false,
    plausibilityReason: null,
    autoLogged: true,
    activityDataPoint: {
      code: "S2-01",
      dataPointName: "Grid electricity consumption",
      scope: "SCOPE_2",
      scope3Category: null,
    },
    factorOption: null,
    site: { id: "site-a1", name: "Slough" },
    sourceDocument: { id: "doc-1", filename: "electricity-july-2026.pdf" },
    calculations: [
      {
        id: "calc-1",
        basis: "LOCATION_BASED",
        resultKgCo2e: 3_684.0,
        factorValueSnapshot: 0.2,
        factorUnitSnapshot: "kWh",
        factorSourceSnapshot: "UK Gov GHG Conversion Factors 2026",
        factorVintageSnapshot: "2026",
        formulaApplied: "18420 kWh × 0.2 kgCO2e/kWh = 3684.000000 kgCO2e",
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();

  mocks.dataPointFindUnique.mockResolvedValue({
    id: "dp-s2-01",
    code: "S2-01",
    dataPointName: "Grid electricity consumption",
    formType: "QUANTITY",
    frequency: "Monthly",
    unitOptions: ["kWh"],
    factorCategory: "grid_electricity",
    scope: "SCOPE_2",
    factorOptions: [],
  });
  mocks.siteFindUnique.mockResolvedValue({ id: "site-a1", name: "Slough" });
  mocks.entryFindUnique.mockResolvedValue(null);
  mocks.entryFindMany.mockResolvedValue([]);
  mocks.factorFindMany.mockResolvedValue([]);
  mocks.suggestionCreate.mockResolvedValue({ id: "suggestion-1" });
  mocks.extractionUpdate.mockResolvedValue({});
  mocks.documentUpdate.mockResolvedValue({});
  mocks.previewFactor.mockResolvedValue({
    resolved: true,
    ambiguous: false,
    unitCompatible: true,
    canonicalUnit: "kWh",
    reason: null,
    factors: [{ id: "factor-1", label: "UK Gov 2026 — grid_electricity", unit: "kWh" }],
    candidateSubtypeKeys: [],
  });
  mocks.createEntry.mockResolvedValue({ entry: { id: "entry-new", status: "SUBMITTED" }, calculations: [{}] });
  mocks.entryFindUniqueOrThrow.mockResolvedValue(writtenEntry());
});

describe("creating an entry from a document", () => {
  it("records it and reports the figure the calculation engine produced", async () => {
    const outcome = await logEntryCandidate(actor, candidate(), OPTIONS);

    expect(outcome.status).toBe("CREATED");
    expect(outcome.card.kind).toBe("ENTRY_CREATED");
    if (outcome.card.kind !== "ENTRY_CREATED") throw new Error("unreachable");

    // Every figure on the card came from the written rows, not the candidate.
    expect(outcome.card.quantity).toBe("18,420");
    expect(outcome.card.calculations[0].kgCo2e).toBe("3,684");
    expect(outcome.card.calculations[0].factorSource).toBe("UK Gov GHG Conversion Factors 2026");
    expect(outcome.card.sourceFilename).toBe("electricity-july-2026.pdf");
  });

  it("writes provenance and the idempotency key with the row, not afterwards", async () => {
    await logEntryCandidate(actor, candidate(), OPTIONS);

    const written = mocks.createEntry.mock.calls[0][0];
    expect(written.dataOrigin).toBe("AI_EXTRACTED");
    expect(written.sourceDocumentId).toBe("doc-1");
    expect(written.acceptedFromExtractionId).toBe("extraction-1");
    expect(written.autoLogged).toBe(true);
    expect(written.aiInteractionId).toBe("interaction-1");
    expect(written.aiIdempotencyKey).toEqual(expect.any(String));
    expect(written.enteredByUserId).toBe("user-1");
  });

  it("never passes an emission factor or an emissions figure into the write", async () => {
    await logEntryCandidate(actor, candidate(), OPTIONS);
    const written = mocks.createEntry.mock.calls[0][0];
    // The pipeline resolves the factor itself. There is no field here through
    // which one could be supplied, and no kgCO2e anywhere in the payload.
    expect(Object.keys(written)).not.toContain("emissionFactorId");
    expect(JSON.stringify(written)).not.toMatch(/co2e|factorValue/i);
  });

  it("records the decision, with the checks it ran, for the audit trail", async () => {
    await logEntryCandidate(actor, candidate(), OPTIONS);

    const suggestion = mocks.suggestionCreate.mock.calls[0][0].data;
    expect(suggestion.targetType).toBe("ACTIVITY_ENTRY");
    expect(suggestion.status).toBe("ACCEPTED");
    expect(suggestion.payload.trigger).toBe("DOCUMENT");
    expect(suggestion.payload.checks.map((c: { id: string }) => c.id)).toContain("factor_resolved");
  });

  it("marks the extraction reviewed and the document partly accepted", async () => {
    await logEntryCandidate(actor, candidate(), OPTIONS);
    expect(mocks.extractionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "extraction-1" } }),
    );
    expect(mocks.documentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PARTIALLY_ACCEPTED" } }),
    );
  });
});

describe("when a condition fails", () => {
  it("asks for the fuel type rather than picking one", async () => {
    mocks.dataPointFindUnique.mockResolvedValue({
      id: "dp-s1-03",
      code: "S1-03",
      dataPointName: "Company-owned/leased vehicle fuel",
      formType: "QUANTITY",
      frequency: "Monthly",
      unitOptions: ["litres"],
      factorCategory: "mobile_combustion_fuel",
      scope: "SCOPE_1",
      factorOptions: [
        { id: "opt-petrol", subtypeKey: "petrol", label: "Petrol", unit: null },
        { id: "opt-diesel", subtypeKey: "diesel", label: "Diesel", unit: null },
      ],
    });

    const outcome = await logEntryCandidate(
      actor,
      candidate({ dataPointCode: "S1-03", unit: "litres", quantity: 1500, subtypeKey: null }),
      OPTIONS,
    );

    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.question).toContain("Petrol or Diesel");
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it("writes nothing when no factor resolves, and says so", async () => {
    mocks.previewFactor.mockResolvedValue({
      resolved: false,
      ambiguous: false,
      unitCompatible: false,
      canonicalUnit: "kWh",
      reason: "No emission factor is available for this activity and period.",
      factors: [],
      candidateSubtypeKeys: [],
    });

    const outcome = await logEntryCandidate(actor, candidate(), OPTIONS);
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.digest).toMatch(/no emission factor/i);
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it("refuses a site outside the caller's organisation scope", async () => {
    const outcome = await logEntryCandidate(actor, candidate({ siteId: "site-elsewhere" }), OPTIONS);
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it("refuses a data point code that doesn't exist here", async () => {
    mocks.dataPointFindUnique.mockResolvedValue(null);
    const outcome = await logEntryCandidate(actor, candidate({ dataPointCode: "S9-99" }), OPTIONS);
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(outcome.digest).toMatch(/no matching activity data point/i);
  });

  it("holds everything for review when the mode says review everything", async () => {
    const outcome = await logEntryCandidate(actor, candidate(), {
      ...OPTIONS,
      mode: AiDataEntryMode.REVIEW_ALL,
    });
    expect(outcome.status).toBe("REVIEW_REQUIRED");
    expect(mocks.createEntry).not.toHaveBeenCalled();
    if (outcome.card.kind !== "REVIEW_REQUIRED") throw new Error("unreachable");
    expect(outcome.card.reasons[0]).toMatch(/review everything/i);
  });
});

describe("duplicates", () => {
  it("stops a document being recorded twice and shows what is already on file", async () => {
    mocks.entryFindMany.mockResolvedValueOnce([
      {
        id: "entry-existing",
        siteId: "site-a1",
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        rawValue: 18420,
        rawUnit: "kWh",
        enteredAt: new Date("2026-08-02T09:00:00.000Z"),
        sourceDocumentId: "doc-1",
        activityDataPoint: { code: "S2-01", dataPointName: "Grid electricity consumption" },
        site: { name: "Slough" },
        sourceDocument: { id: "doc-1", filename: "electricity-july-2026.pdf", sha256: "abc" },
        acceptedFromExtraction: null,
      },
    ]);

    const outcome = await logEntryCandidate(actor, candidate(), OPTIONS);

    expect(outcome.status).toBe("DUPLICATE");
    expect(mocks.createEntry).not.toHaveBeenCalled();
    if (outcome.card.kind !== "DUPLICATE") throw new Error("unreachable");
    expect(outcome.card.existing[0].entryId).toBe("entry-existing");
    expect(outcome.card.existing[0].recordedOn).toContain("2026");
  });

  it("treats a lost race on the unique key as 'already recorded', not as an error", async () => {
    mocks.createEntry.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );

    const outcome = await logEntryCandidate(actor, candidate(), OPTIONS);
    expect(outcome.status).toBe("DUPLICATE");
    expect(outcome.digest).toMatch(/already recorded/i);
  });

  it("will not let an override defeat the idempotency key", async () => {
    // An identical *request* is not a judgement call — re-running it stays a
    // no-op whatever the user says, which is the guarantee the key exists for.
    mocks.entryFindUnique.mockResolvedValue({
      id: "entry-existing",
      siteId: "site-a1",
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      rawValue: 18420,
      rawUnit: "kWh",
      enteredAt: new Date("2026-08-02T09:00:00.000Z"),
      sourceDocumentId: "doc-1",
      activityDataPoint: { code: "S2-01", dataPointName: "Grid electricity consumption" },
      site: { name: "Slough" },
      sourceDocument: { id: "doc-1", filename: "electricity-july-2026.pdf", sha256: "abc" },
      acceptedFromExtraction: null,
    });

    const outcome = await logEntryCandidate(actor, candidate(), { ...OPTIONS, allowDuplicate: true });
    expect(outcome.status).toBe("DUPLICATE");
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });
});
