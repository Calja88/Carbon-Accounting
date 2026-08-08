import { describe, expect, it } from "vitest";
import { AiDataEntryMode } from "@prisma/client";
import { evaluateAutoLog, userDeclinedAutoLog, type AutoLogFacts } from "@/lib/ai/auto-log";

/**
 * The auto-log engine decides whether accounting data gets written without a
 * person checking it field by field, so it is tested the way the rules are
 * stated: one test per condition that must hold, and one per condition that
 * must stop it.
 *
 * The single most important assertion in this file is the last one in the
 * first block — that a model's confidence plays no part. Everything else here
 * follows from that.
 */

/** A candidate where every condition holds. Each test breaks exactly one. */
function passingFacts(overrides: Partial<AutoLogFacts> = {}): AutoLogFacts {
  return {
    sourceUsable: true,
    sourceUnusableReason: null,
    quantity: 18420,
    unit: "kWh",
    acceptedUnits: ["kWh"],
    periodInput: "2026-07",
    dataPointCode: "S2-01",
    dataPointName: "Grid electricity consumption",
    requiresSubtype: false,
    subtypeKey: null,
    subtypeOptions: [],
    siteId: "site-a1",
    siteAuthorised: true,
    factor: {
      resolved: true,
      ambiguous: false,
      candidateLabels: ["UK Gov 2026 — grid_electricity (LOCATION_BASED)"],
      unitCompatible: true,
      reason: null,
    },
    duplicate: { suspected: false, reason: null, existingEntryIds: [] },
    conflicts: [],
    sourceDocumentId: "doc-1",
    extractionId: "extraction-1",
    ...overrides,
  };
}

const AUTO = { mode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE, trigger: "DOCUMENT" as const };

describe("auto-log: what allows an automatic entry", () => {
  it("allows it when every condition holds", () => {
    const decision = evaluateAutoLog(passingFacts(), AUTO);
    expect(decision.allowed).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.question).toBeNull();
  });

  it("reports every condition it checked, not just the verdict", () => {
    const decision = evaluateAutoLog(passingFacts(), AUTO);
    const ids = decision.checks.map((c) => c.id);
    expect(ids).toContain("factor_resolved");
    expect(ids).toContain("no_duplicate");
    expect(ids).toContain("evidence_retained");
    expect(decision.checks.every((c) => c.passed)).toBe(true);
  });

  it("has no way to be told a model was confident", () => {
    // If a confidence number could reach this decision there would be a field
    // for it. There isn't, and there must not be: "high confidence" in this
    // platform means the checks above passed.
    expect(Object.keys(passingFacts())).not.toContain("confidence");
    expect(JSON.stringify(evaluateAutoLog(passingFacts(), AUTO))).not.toMatch(/confidence/i);
  });
});

describe("auto-log: what stops an automatic entry", () => {
  it("refuses an unreadable document", () => {
    const decision = evaluateAutoLog(
      passingFacts({ sourceUsable: false, sourceUnusableReason: "The scan is too faint to read." }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.blockers[0]).toContain("too faint");
  });

  it("refuses an ambiguous quantity", () => {
    for (const quantity of [null, 0, -5, Number.NaN]) {
      expect(evaluateAutoLog(passingFacts({ quantity }), AUTO).allowed, String(quantity)).toBe(false);
    }
  });

  it("refuses a unit the data point doesn't record", () => {
    const decision = evaluateAutoLog(passingFacts({ unit: "therms" }), AUTO);
    expect(decision.allowed).toBe(false);
    expect(decision.question).toContain("kWh");
  });

  it("accepts a unit whose only difference is case or spacing", () => {
    expect(evaluateAutoLog(passingFacts({ unit: " KWH " }), AUTO).allowed).toBe(true);
  });

  it("refuses when no period could be read, and asks for one", () => {
    const decision = evaluateAutoLog(passingFacts({ periodInput: null }), AUTO);
    expect(decision.allowed).toBe(false);
    expect(decision.question).toMatch(/period/i);
  });

  it("refuses when the activity maps to no data point", () => {
    const decision = evaluateAutoLog(passingFacts({ dataPointCode: null, dataPointName: null }), AUTO);
    expect(decision.allowed).toBe(false);
    expect(decision.question).toMatch(/what is it a record of/i);
  });

  it("refuses when a sub-type is needed and none was determined, listing the options", () => {
    const decision = evaluateAutoLog(
      passingFacts({
        dataPointCode: "S1-03",
        dataPointName: "Company-owned/leased vehicle fuel",
        requiresSubtype: true,
        subtypeKey: null,
        subtypeOptions: [
          { key: "petrol", label: "Petrol" },
          { key: "diesel", label: "Diesel" },
        ],
      }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.question).toContain("Petrol or Diesel");
  });

  it("refuses a site outside the caller's access", () => {
    expect(evaluateAutoLog(passingFacts({ siteAuthorised: false }), AUTO).allowed).toBe(false);
  });

  it("refuses when no emission factor is available, and asks nothing — the user can't fix that", () => {
    const decision = evaluateAutoLog(
      passingFacts({
        factor: {
          resolved: false,
          ambiguous: false,
          candidateLabels: [],
          unitCompatible: false,
          reason: "No emission factor is available for this activity and period.",
        },
      }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.question).toBeNull();
    expect(decision.blockers[0]).toMatch(/no emission factor/i);
  });

  it("refuses when more than one factor could plausibly apply", () => {
    const decision = evaluateAutoLog(
      passingFacts({
        factor: {
          resolved: false,
          ambiguous: true,
          candidateLabels: ["diesel", "petrol"],
          unitCompatible: false,
          reason: "More than one factor could apply and no type was determined.",
        },
      }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses when the factor's unit doesn't match the recorded quantity", () => {
    const decision = evaluateAutoLog(
      passingFacts({
        factor: { resolved: true, ambiguous: false, candidateLabels: ["x"], unitCompatible: false, reason: null },
      }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses when the document's own figures contradict each other", () => {
    const decision = evaluateAutoLog(
      passingFacts({ conflicts: ["The total of 18,420 kWh doesn't match the day and night figures."] }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.question).toMatch(/which one is right/i);
  });

  it("refuses a suspected duplicate", () => {
    const decision = evaluateAutoLog(
      passingFacts({
        duplicate: { suspected: true, reason: "Invoice 8812 is already recorded.", existingEntryIds: ["entry-1"] },
      }),
      AUTO,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toContain("Invoice 8812 is already recorded.");
  });

  it("refuses a document-sourced entry whose evidence has gone", () => {
    expect(evaluateAutoLog(passingFacts({ sourceDocumentId: null }), AUTO).allowed).toBe(false);
  });
});

describe("auto-log: the data entry mode", () => {
  it("holds a document-triggered entry for review when the mode says review everything", () => {
    const decision = evaluateAutoLog(passingFacts(), {
      mode: AiDataEntryMode.REVIEW_ALL,
      trigger: "DOCUMENT",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.checks.every((c) => c.passed)).toBe(true);
    expect(decision.withheldReason).toMatch(/review everything/i);
  });

  it("still honours a person's explicit instruction in review-everything mode", () => {
    // The user typing "log this" is the human decision the mode exists to
    // preserve. The checks still have to pass.
    const decision = evaluateAutoLog(passingFacts({ sourceDocumentId: null, extractionId: null }), {
      mode: AiDataEntryMode.REVIEW_ALL,
      trigger: "USER_INSTRUCTION",
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses a person's instruction just as readily when a condition fails", () => {
    const decision = evaluateAutoLog(passingFacts({ quantity: null }), {
      mode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE,
      trigger: "USER_INSTRUCTION",
    });
    expect(decision.allowed).toBe(false);
  });

  it("doesn't require an evidence document for something stated in chat", () => {
    const decision = evaluateAutoLog(passingFacts({ sourceDocumentId: null, extractionId: null }), {
      mode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE,
      trigger: "USER_INSTRUCTION",
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("the user asking for something not to be logged", () => {
  it("recognises an explicit refusal", () => {
    for (const message of [
      "Don't log this invoice.",
      "Do not record this one.",
      "Just read it and tell me the total.",
      "Read this without recording it.",
      "Don't create an entry for this.",
    ]) {
      expect(userDeclinedAutoLog(message), message).toBe(true);
    }
  });

  it("does not read a refusal into a question about the document", () => {
    for (const message of [
      "What does this invoice say?",
      "Which scope is this?",
      "Log this.",
      "Add this to July.",
      "Is anything missing?",
    ]) {
      expect(userDeclinedAutoLog(message), message).toBe(false);
    }
  });
});
