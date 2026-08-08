import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import type { AiActor } from "@/lib/ai/scope";

/**
 * Natural-language editing of accounting data.
 *
 * The risk this file guards against is an ambiguous conversational reference —
 * "that entry", "the one you just made" — reaching a row it has no business
 * touching. Four independent conditions have to hold before anything changes,
 * and each of them is tested by breaking it on its own.
 *
 * The other property tested here is that a correction never rewrites a figure
 * in place: the original is withdrawn and kept, and a corrected entry is
 * recorded beside it, so a stored Calculation always still describes something
 * that was really submitted.
 */

const mocks = vi.hoisted(() => ({
  entryFindUnique: vi.fn(),
  entryUpdate: vi.fn(),
  optionFindFirst: vi.fn(),
  entryFindUniqueOrThrow: vi.fn(),
  createEntry: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    activityEntry: {
      findUnique: mocks.entryFindUnique,
      update: mocks.entryUpdate,
      findUniqueOrThrow: mocks.entryFindUniqueOrThrow,
    },
    factorOption: { findFirst: mocks.optionFindFirst },
  },
}));
vi.mock("@/lib/entries-service", () => ({
  createActivityEntryWithCalculations: mocks.createEntry,
  previewFactorResolution: vi.fn(),
}));

const { correctAssistantEntry, retractAssistantEntry, EntryCorrectionError, userConfirmedRetraction } = await import(
  "@/lib/ai/entry-corrections"
);

const actor: AiActor = {
  userId: "user-1",
  name: "Test User",
  role: Role.SUSTAINABILITY_LEAD,
  isAdmin: false,
  entityIds: ["entity-a"],
  siteIds: ["site-a1"],
};

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    activityDataPointId: "dp-s1-03",
    siteId: "site-a1",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    rawValue: 1500,
    rawUnit: "litres",
    factorOptionId: "opt-diesel",
    supplierName: null,
    status: "SUBMITTED",
    notes: "Recorded through the assistant.",
    dataOrigin: "AI_CHAT",
    sourceDocumentId: null,
    acceptedFromExtractionId: null,
    enteredByUserId: "user-1",
    activityDataPoint: {
      id: "dp-s1-03",
      code: "S1-03",
      dataPointName: "Company-owned/leased vehicle fuel",
      frequency: "Monthly",
      unitOptions: ["litres"],
    },
    factorOption: { id: "opt-diesel", subtypeKey: "diesel", unit: null },
    site: { id: "site-a1", name: "Hull" },
    ...overrides,
  };
}

const OPTIONS = { interactionId: "interaction-1", turnRequestId: "turn-1" };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.entryFindUnique.mockResolvedValue(entry());
  mocks.entryUpdate.mockResolvedValue({});
  mocks.createEntry.mockResolvedValue({ entry: { id: "entry-2" }, calculations: [] });
  mocks.entryFindUniqueOrThrow.mockResolvedValue({
    id: "entry-2",
    rawValue: 1550,
    rawUnit: "litres",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    status: "SUBMITTED",
    plausibilityFlagged: false,
    plausibilityReason: null,
    autoLogged: false,
    activityDataPoint: { code: "S1-03", dataPointName: "Company-owned/leased vehicle fuel", scope: "SCOPE_1", scope3Category: null },
    factorOption: { subtypeKey: "diesel" },
    site: { id: "site-a1", name: "Hull" },
    sourceDocument: null,
    calculations: [],
  });
});

describe("what a conversational reference may reach", () => {
  it("refuses an entry this conversation never created", async () => {
    await expect(
      correctAssistantEntry(actor, "entry-99", ["entry-1"], { quantity: 1550 }, OPTIONS),
    ).rejects.toThrow(EntryCorrectionError);
    expect(mocks.createEntry).not.toHaveBeenCalled();
    expect(mocks.entryUpdate).not.toHaveBeenCalled();
  });

  it("refuses an entry at a site outside the caller's organisation", async () => {
    mocks.entryFindUnique.mockResolvedValue(entry({ siteId: "site-elsewhere" }));
    await expect(correctAssistantEntry(actor, "entry-1", ["entry-1"], { quantity: 1550 }, OPTIONS)).rejects.toThrow();
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it("refuses an entry somebody typed in by hand", async () => {
    mocks.entryFindUnique.mockResolvedValue(entry({ dataOrigin: "USER_ENTERED" }));
    await expect(
      correctAssistantEntry(actor, "entry-1", ["entry-1"], { quantity: 1550 }, OPTIONS),
    ).rejects.toThrow(/wasn't created by the assistant/i);
  });

  it("refuses an entry recorded by another user", async () => {
    mocks.entryFindUnique.mockResolvedValue(entry({ enteredByUserId: "user-2" }));
    await expect(
      correctAssistantEntry(actor, "entry-1", ["entry-1"], { quantity: 1550 }, OPTIONS),
    ).rejects.toThrow(/recorded by someone else/i);
  });

  it("refuses an entry that has already been withdrawn", async () => {
    mocks.entryFindUnique.mockResolvedValue(entry({ status: "REJECTED" }));
    await expect(retractAssistantEntry(actor, "entry-1", ["entry-1"], "")).rejects.toThrow(/already been withdrawn/i);
  });
});

describe("correcting a figure", () => {
  it("withdraws the original and records a corrected entry beside it", async () => {
    const result = await correctAssistantEntry(actor, "entry-1", ["entry-1"], { quantity: 1550 }, OPTIONS);

    const written = mocks.createEntry.mock.calls[0][0];
    expect(written.rawValue).toBe(1550);
    expect(written.rawUnit).toBe("litres");
    expect(written.autoLogged).toBe(false);
    expect(written.notes).toContain("Corrected from entry entry-1");

    // The original is withdrawn, not edited.
    const update = mocks.entryUpdate.mock.calls[0][0];
    expect(update.where.id).toBe("entry-1");
    expect(update.data.status).toBe("REJECTED");
    expect(update.data.notes).toContain("Superseded by entry entry-2");

    expect(result.entryId).toBe("entry-2");
  });

  it("moves the period when the correction is about the month", async () => {
    await correctAssistantEntry(actor, "entry-1", ["entry-1"], { periodInput: "2026-06" }, OPTIONS);
    const written = mocks.createEntry.mock.calls[0][0];
    expect(written.periodStart.toISOString().slice(0, 7)).toBe("2026-06");
    expect(written.rawValue).toBe(1500);
  });

  it("refuses a unit the data point doesn't record", async () => {
    await expect(
      correctAssistantEntry(actor, "entry-1", ["entry-1"], { unit: "gallons" }, OPTIONS),
    ).rejects.toThrow(/can't record it in "gallons"/i);
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it("refuses a sub-type the data point doesn't offer", async () => {
    mocks.optionFindFirst.mockResolvedValue(null);
    await expect(
      correctAssistantEntry(actor, "entry-1", ["entry-1"], { subtypeKey: "hydrogen" }, OPTIONS),
    ).rejects.toThrow(/isn't a type offered/i);
  });

  it("refuses a quantity of zero or less", async () => {
    await expect(correctAssistantEntry(actor, "entry-1", ["entry-1"], { quantity: 0 }, OPTIONS)).rejects.toThrow();
  });
});

describe("withdrawing an entry", () => {
  it("keeps the record and its calculations, and stops it counting", async () => {
    const result = await retractAssistantEntry(actor, "entry-1", ["entry-1"], "logged in error");

    const update = mocks.entryUpdate.mock.calls[0][0];
    expect(update.data.status).toBe("REJECTED");
    expect(update.data.notes).toContain("logged in error");
    expect(result.digest).toMatch(/excluded from all totals/i);
    expect(result.digest).toMatch(/kept on file/i);
  });
});

describe("recognising that the user asked for a withdrawal", () => {
  it("accepts the ways someone actually says it", () => {
    for (const message of [
      "Delete the entry you just created.",
      "Please remove that one.",
      "Undo that.",
      "Don't log this invoice.",
      "That shouldn't have been recorded.",
    ]) {
      expect(userConfirmedRetraction(message), message).toBe(true);
    }
  });

  it("does not read a withdrawal into an ordinary message", () => {
    for (const message of ["Log this invoice.", "What did you record?", "Add this to July.", "Which scope is this?"]) {
      expect(userConfirmedRetraction(message), message).toBe(false);
    }
  });
});
