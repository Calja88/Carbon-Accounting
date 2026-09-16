import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";
import { parseUkGovFactors } from "../parse-uk-gov-factors";
import { normaliseUnit } from "../normalise-factor-row";
import { validateFactorImport } from "../validate-factor-import";

// Headers/layout mimic the official flat file; all activities, IDs, releases and
// numerical values below are invented. The official workbook is never a fixture.
const headers = ["ID", "Scope", "Level 1", "Level 2", "Level 3", "Level 4", "Column Text", "UOM", "GHG/Unit", "GHG Conversion Factor 2026"];
const fuel = ["synthetic-id", "Scope 1", "Fuels", "Synthetic group", "Synthetic fuel", "", "", "kWh (Net CV)", "kg CO2e", "0.125"];
const context = makeOrganisationContext("org-synthetic", { permissions: new Set(["carbon.factor.manage"]) });
vi.mock("@/lib/organisation/session", () => ({
  requireOrganisationContext: () => context,
  OrganisationAccessError: class extends Error {},
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get() { throw new Error("No database allowed"); } }) }));
vi.mock("@/lib/factor-sets-service", () => ({
  visibleFactorSetFilter: () => { throw new Error("No dataset comparison requested"); },
  commitFactorImport: () => { throw new Error("No persistence allowed"); },
}));
vi.mock("@/lib/entries-service", () => ({ recalculatePendingEntries: () => { throw new Error("No recalculation allowed"); } }));
vi.mock("@/lib/observability/logger", () => ({ logEvent: () => { throw new Error("No raw output expected"); } }));
const { previewFactorImportAction } = await import("@/app/(app)/admin/factors/import/actions");

async function workbook(rows: string[][] = [fuel], headerRow = 9) {
  const book = new ExcelJS.Workbook();
  const front = book.addWorksheet("Front page");
  front.mergeCells("A1:C1");
  front.getCell("A1").value = "UK Government GHG Conversion Factors for Company Reporting";
  front.mergeCells("D1:F1"); // Empty merged master: ExcelJS .text throws.
  front.getRow(4).values = ["Version:", "synthetic-v1", "Year:", "2026"];
  front.getRow(5).values = ["Next publication date:", "June 2027"];
  const sheet = book.addWorksheet("Factors by Category");
  sheet.getRow(2).values = ["Synthetic notes only"];
  sheet.getRow(headerRow).values = [...headers].reverse();
  rows.forEach((row, index) => { sheet.getRow(headerRow + 2 + index).values = [...row].reverse(); });
  sheet.getRow(headerRow + 2 + rows.length).values = [...headers].reverse();
  sheet.getRow(headerRow + 3 + rows.length).values = ["END"];
  book.addWorksheet("Unsupported layout").addRow(["Synthetic narrative"]);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function preview(rows: string[][] = [fuel]) {
  return validateFactorImport(await parseUkGovFactors(await workbook(rows), "synthetic.xlsx"));
}

describe("calibrated official flat format", () => {
  it.each([6, 9, 17])("detects moved/reversed headers at row %i and preserves raw provenance", async (position) => {
    const parsed = await parseUkGovFactors(await workbook([fuel], position), "synthetic.xlsx");
    expect(parsed.metadata).toEqual({ publisher: "UK Government", year: 2026, release: "synthetic-v1" });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ sheet: "Factors by Category", rowNumber: position + 2,
      fields: { sourceId: "synthetic-id", level1: "Fuels", level2: "Synthetic group", level3: "Synthetic fuel",
        level4: "", columnText: "", value: "0.125", unit: "kWh (Net CV)", gas: "kg CO2e", kind: "direct" } });
    expect(parsed.sheets[1].tables).toEqual([
      { rowNumber: position, headers: [...headers].reverse(), layout: "official-flat" },
      { rowNumber: position + 3, headers: [...headers].reverse(), layout: "official-flat" },
    ]);
    expect(parsed.messages).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_SHEET", sheet: "Unsupported layout" }));
    expect(parsed.messages.some((m) => m.code === "PARSE_FAILED")).toBe(false);
  });

  it.each([
    ["kWh (Net CV)", "kWh (Net CV)"], ["kWh (Gross CV)", "kWh (Gross CV)"],
    ["GJ", "GJ"], ["million litres", "million litres"],
    ["Room per night", "room.night"], ["per FTE Working Hour", "FTE.hour"],
  ])("preserves the distinct denominator for %s without converting values", async (raw, canonical) => {
    expect(normaliseUnit(raw)).toBe(canonical);
    const row = [...fuel]; row[7] = raw;
    const result = await preview([row]);
    expect(result.warningRows[0]).toMatchObject({ rawUnit: raw, canonicalUnit: canonical, factorValue: "0.125" });
    expect(result.warningRows[0].messages.map((m) => m.code)).not.toContain("UNKNOWN_UNIT");
  });

  it("does not collapse qualified energy, volume or room units into other units", async () => {
    expect(new Set(["kWh", "kWh (Net CV)", "kWh (Gross CV)"].map(normaliseUnit)).size).toBe(3);
    expect(normaliseUnit("million litres")).not.toBe(normaliseUnit("litres"));
    expect(normaliseUnit("Room per night")).not.toBe(normaliseUnit("night"));
    expect(normaliseUnit("kWh (net)")).toBeNull(); // SECR output, not an approved denominator alias.
    const row = [...fuel]; row[7] = "unknown unit";
    expect((await preview([row])).rejectedRows[0].messages.map((m) => m.code)).toContain("UNKNOWN_UNIT");
  });

  it.each(["", "not numeric", "-0.1", "0.000000001"])("rejects unavailable or unrepresentable value %s without substituting zero", async (value) => {
    const row = [...fuel]; row[9] = value;
    const result = await preview([row]);
    expect(result.rejectedRows[0].factorValue).toBeNull();
    expect(result.rejectedRows[0].source.fields.value).toBe(value);
    expect(result.rejectedRows[0].messages.map((m) => m.code)).toContain(value ? "INVALID_VALUE" : "MISSING_VALUE");
  });

  it.each(["kg CO2e of CO2 per unit", "kg CO2e of CH4 per unit", "kg CO2e of N2O per unit", "CO2", "CH4", "N2O", "kg CO2e of other per unit"])("preserves and rejects unsupported gas expression %s", async (gas) => {
    const row = [...fuel]; row[8] = gas;
    const result = await preview([row]);
    expect(result.rejectedRows[0]).toMatchObject({ gas, source: { fields: { gas } } });
    expect(result.rejectedRows[0].messages.map((m) => m.code)).toContain("UNSUPPORTED_GAS");
  });

  it("keeps direct, WTT, unreviewed total/lifecycle and energy conversions distinct", async () => {
    const wtt = [...fuel]; wtt[1] = "Scope 3"; wtt[2] = "WTT- fuels";
    const total = [...fuel]; total[2] = "Total lifecycle";
    const energy = [...fuel]; energy[2] = "SECR kWh pass & delivery vehs"; energy[8] = "kWh (Net CV)";
    const result = await preview([fuel, wtt, total, energy]);
    expect(result.candidates.map((r) => r.kind)).toEqual(["direct", "wtt", null, null]);
    expect(result.counts).toMatchObject({ accepted: 0, warning: 2, rejected: 2, duplicate: 0 });
    expect(new Set(result.candidates.map((r) => r.identity)).size).toBe(4);
    expect(result.candidates[2].messages.map((m) => m.code)).toContain("UNREVIEWED_FACTOR_KIND");
    expect(result.candidates[3].messages.map((m) => m.code)).toContain("NOT_EMISSION_FACTOR");
  });

  it("keeps hierarchy positions and column dimensions in deterministic identities", async () => {
    const dimension = [...fuel]; dimension[6] = "Synthetic load";
    const shifted = [...fuel]; shifted[5] = shifted[4]; shifted[4] = "";
    const result = await preview([fuel, dimension, shifted]);
    expect(new Set(result.candidates.map((r) => r.identity)).size).toBe(3);
    expect((await preview([fuel, dimension, shifted])).candidates.map((r) => r.identity)).toEqual(result.candidates.map((r) => r.identity));
    const duplicate = [...fuel]; duplicate[0] = "another-source-id";
    const conflicts = await preview([fuel, duplicate]);
    expect(conflicts.candidates[0].identity).toBe(conflicts.candidates[1].identity);
    expect(conflicts.candidates[0].sourceHash).not.toBe(conflicts.candidates[1].sourceHash);
    // Do not hide unresolved mapping/region warnings by labelling a row duplicate.
    expect(conflicts.rejectedRows.every((r) => r.messages.some((m) => m.code === "CONFLICT_WITHIN_FILE"))).toBe(true);
  });

  it("keeps metadata conflicts blocking and rejects totals/headings and formulas", async () => {
    const bytes = await workbook([fuel]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.getWorksheet("Factors by Category")!;
    sheet.getCell(11, 1).value = { formula: "1/8", result: 0.125 };
    const result = validateFactorImport(await parseUkGovFactors(new Uint8Array(await book.xlsx.writeBuffer()), "synthetic.xlsx", { year: 2025 }));
    expect(result.metadata.year).toBeNull();
    expect(result.messages.map((m) => m.code)).toContain("METADATA_CONFLICT");
    expect(result.rejectedRows[0].messages.map((m) => m.code)).toContain("UNSUPPORTED_CELL");
    const total = [...fuel]; total[3] = "Total"; total[4] = "";
    expect((await preview([total])).rejectedRows[0].messages.map((m) => m.code)).toContain("NON_FACTOR_ROW");
  });

  it("returns official-style preview counts and raw gas/value/kind through the real action without DB access", async () => {
    const missing = [...fuel]; missing[4] = "Synthetic missing"; missing[9] = "";
    const gas = [...fuel]; gas[8] = "kg CO2e of CH4 per unit";
    const bytes = await workbook([fuel, missing, gas]);
    const form = new FormData();
    form.set("file", new File([bytes as Uint8Array<ArrayBuffer>], "synthetic.xlsx"));
    const state = await previewFactorImportAction({ error: null, preview: null }, form);
    expect(state.error).toBeNull();
    expect(state.preview).toMatchObject({ totalRowsScanned: 21, counts: { accepted: 0, warning: 1, rejected: 2, duplicate: 0 },
      commitAllowed: false, validationPassed: false, existingDatasetChecked: false });
    expect(state.preview?.sheets[1].tables?.[0].rowNumber).toBe(9);
    expect(state.preview?.warning.rows[0]).toMatchObject({ rawFactorValue: "0.125", rawGas: "kg CO2e", rawKind: "Fuels" });
    expect(state.preview?.rejected.rows[0]).toMatchObject({ rawFactorValue: "", factorValue: null });
    expect(state.preview?.rejected.rows[1].rawGas).toBe("kg CO2e of CH4 per unit");
    expect(state.preview?.commitBlockedReasons.join(" ")).toContain("gas/kind representation");
    expect(state.preview?.warning.rows[0]).not.toHaveProperty("source");
  });
});
