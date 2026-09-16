/**
 * The presentation normalisation for the synthetic demo's retired
 * factor-source labels.
 *
 * Commit 3e94741 renamed the fixture's factor-set names, and the align script
 * converged the live rows — but `Calculation.factorSourceSnapshot`,
 * `LcaCalculationResult.factorSource` and the LCA run snapshots deliberately
 * still hold the wording each calculation actually used. These assertions pin
 * the display-side rule that reads those stored values back under the current
 * name, and pin how narrow it is: nothing else that says BOARD-1 is touched,
 * and the stored string itself is never mutated.
 */
import { describe, expect, it } from "vitest";
import { formatFactorSource } from "../format";

const LEGACY_CARBON = "BOARD-1 demo factors — not for reporting";
const LEGACY_LCA = "BOARD-1 demonstration — not for reporting";
const PLACEHOLDER = " (PLACEHOLDER — not verified)";

describe("formatFactorSource", () => {
  it("displays the legacy carbon factor-set snapshot under its current name", () => {
    expect(formatFactorSource(LEGACY_CARBON)).toBe("Demo factors — not for reporting");
  });

  it("keeps the PLACEHOLDER suffix the calculation appended", () => {
    expect(formatFactorSource(LEGACY_CARBON + PLACEHOLDER)).toBe(
      "Demo factors — not for reporting (PLACEHOLDER — not verified)",
    );
  });

  it("displays the legacy LCA factor source under its current name, suffix included", () => {
    expect(formatFactorSource(LEGACY_LCA)).toBe("Demo — not for reporting");
    expect(formatFactorSource(`${LEGACY_LCA} (2026)`)).toBe("Demo — not for reporting (2026)");
  });

  it("leaves a value already carrying the current wording alone", () => {
    for (const current of [
      "Demo factors — not for reporting",
      "Demo factors — not for reporting (PLACEHOLDER — not verified)",
      "Demo — not for reporting",
    ]) {
      expect(formatFactorSource(current)).toBe(current);
    }
  });

  it("is idempotent, so a value that passes through twice is not rewritten twice", () => {
    const once = formatFactorSource(LEGACY_CARBON + PLACEHOLDER);
    expect(formatFactorSource(once)).toBe(once);
  });

  it("does not rewrite any other BOARD-1 string", () => {
    // Identity and history, not a stale label — these must survive verbatim.
    for (const untouched of [
      "BOARD-1",
      "BOARD1-grid_electricity",
      "board1_purchased_goods",
      "BOARD-1 sustainability-lead",
      "BOARD-1:north-works:2026-01:gas",
      "BOARD1-LCA-001",
      "BOARD-1-invoice.txt",
      "board-1-northstar-demonstration",
      "Activity entry recorded for BOARD1-grid_electricity at site cmtx673c2",
      "BOARD-1 demonstration programme",
      "BOARD-1 internal audit",
      "DEFRA 2026 Official",
    ]) {
      expect(formatFactorSource(untouched)).toBe(untouched);
    }
  });

  it("only matches at the start, never a legacy label quoted mid-sentence", () => {
    const quoted = `Superseded by BOARD-1 demo factors — not for reporting`;
    expect(formatFactorSource(quoted)).toBe(quoted);
  });

  it("does not mutate the stored value handed to it", () => {
    const stored = LEGACY_CARBON + PLACEHOLDER;
    const copy = String(stored);
    formatFactorSource(stored);
    expect(stored).toBe(copy);
    expect(stored).toContain("BOARD-1");
  });

  it("passes a null or undefined snapshot straight through", () => {
    expect(formatFactorSource(null)).toBeNull();
    expect(formatFactorSource(undefined)).toBeUndefined();
  });
});

/**
 * The display surfaces that read a stored snapshot back. Each of these was
 * checked to be presentation-only before the helper was applied — in
 * particular `resultsToAnalysisRows` is NOT in this list, because it also
 * feeds `issueVersionAction`, which seals an assessment version.
 */
describe("the surfaces that normalise a stored snapshot", () => {
  const SURFACES: readonly [string, string][] = [
    ["Activity Data Register detail", "src/lib/carbon/activity-register-service.ts"],
    ["calculation provenance", "src/lib/explain-calculation.ts"],
    ["Management Report and its XLSX export", "src/lib/carbon/live-management-report.ts"],
    ["LCA assessment report and calculation-register CSV", "src/lib/lca/report-service.ts"],
  ];

  it.each(SURFACES)("%s calls the helper", async (_name, path) => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
    expect(source).toContain("formatFactorSource(");
    expect(source).toContain('from "@/lib/format"');
  });

  /**
   * Immutable records keep what was recorded. The audit-trail CSV exports the
   * raw snapshot columns for verification, an issued assessment version is
   * frozen, and the engine/persistence paths write what the calculation used.
   */
  const UNTOUCHED: readonly [string, string][] = [
    ["audit-trail CSV", "src/app/(app)/reports/[id]/audit-trail.csv/route.ts"],
    ["frozen assessment version", "src/app/(app)/assessments/[id]/versions/[versionId]/page.tsx"],
    ["stored report payload", "src/lib/report-service.ts"],
    ["LCA engine output", "src/lib/lca/engine/engine.ts"],
  ];

  it.each(UNTOUCHED)("%s does not normalise", async (_name, path) => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
    expect(source).not.toContain("formatFactorSource");
  });

  it("leaves the persistence path in lca/calculation-service untouched", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/lca/calculation-service.ts", "utf8"),
    );
    // createMany writes what the engine produced; resultsToAnalysisRows feeds
    // the version-sealing path as well as the results table.
    expect(source).not.toContain("formatFactorSource");
  });
});
