import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { FactorBasis, Scope } from "@prisma/client";
import { csvRow } from "@/lib/csv";
import { parseUkGovFactors } from "../parse-uk-gov-factors";
import { normaliseUnit } from "../normalise-factor-row";
import { validateFactorImport } from "../validate-factor-import";
import type { ExistingFactor } from "../types";

// All numeric values and dataset metadata are synthetic, not published factors.
const metadata = { publisher: "Synthetic UK Gov fixture", year: 2026, release: "test-v1" };
const valid = {
  activity: "Synthetic fuel", category_path: "Fuels > Synthetic fuel",
  factor_category: "stationary_combustion_natural_gas", scope: "SCOPE_1",
  unit: "kilowatt-hour", co2e_factor: "0.125", factor_kind: "direct", region: "UK",
};
const buffer = (text: string) => Buffer.from(text, "utf8");
function csv(rows: Record<string, string>[], columns = [...new Set(rows.flatMap(Object.keys))]) {
  return buffer(csvRow(columns) + rows.map((row) => csvRow(columns.map((key) => row[key] ?? ""))).join(""));
}
async function preview(rows: Record<string, string>[] = [valid], existing?: ExistingFactor[]) {
  return validateFactorImport(await parseUkGovFactors(csv(rows), "synthetic.csv", metadata), existing);
}
const existing: ExistingFactor = {
  category: valid.factor_category, subtypeKey: null, basis: FactorBasis.STANDARD,
  scope: Scope.SCOPE_1, region: "UK", unit: "kWh", co2eFactor: "0.12500000",
};

describe("UK factor file adapter", () => {
  it("detects moved headers and preserves physical CSV rows, quoted multiline values and raw source text", async () => {
    const columns = Object.keys(valid).reverse();
    const text = '\nPublisher,Synthetic UK Gov fixture\nYear,2026\nRelease,test-v1\n\n' +
      csvRow(columns) + csvRow(columns.map((key) => ({ ...valid, activity: 'Synthetic, "quoted"\nfuel' }[key as keyof typeof valid]))) + '\n';
    const parsed = await parseUkGovFactors(buffer(text), "synthetic.csv");
    expect(parsed.metadata).toEqual(metadata);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ sheet: "CSV", rowNumber: 7, fields: { activity: 'Synthetic, "quoted"\nfuel', unit: "kilowatt-hour", value: "0.125" } });
    expect(parsed.rows[0].cells).toContain("Fuels > Synthetic fuel");
    expect(parsed.totalRowsScanned).toBe(8);
  });

  it("reads XLSX buffers with preambles, reordered tables, repeated headers and unknown sheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const notes = workbook.addWorksheet("Read me");
    notes.mergeCells("A1:D1");
    notes.getCell("A1").value = "Synthetic fixture only";
    const sheet = workbook.addWorksheet("Synthetic fuels");
    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = "Synthetic fuel table";
    const columns = Object.keys(valid).reverse();
    sheet.getRow(3).values = columns;
    sheet.getRow(5).values = columns.map((key) => valid[key as keyof typeof valid]);
    sheet.getRow(7).values = columns;
    sheet.getRow(8).values = columns.map((key) => ({ ...valid, activity: "Second", subtype_key: "second" }[key as keyof typeof valid]));
    const parsed = await parseUkGovFactors(new Uint8Array(await workbook.xlsx.writeBuffer()), "fixture.xlsx", metadata);
    expect(parsed.rows.map((row) => [row.sheet, row.rowNumber])).toEqual([["Synthetic fuels", 5], ["Synthetic fuels", 8]]);
    expect(parsed.sheets).toEqual([{ name: "Read me", supported: false, rowsScanned: 1 }, { name: "Synthetic fuels", supported: true, rowsScanned: 8 }]);
    expect(parsed.messages.map((m) => m.code)).toContain("UNSUPPORTED_SHEET");
  });

  it("rejects formulas (even with cached results) and merged data cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Fuels");
    const columns = Object.keys(valid);
    sheet.addRow(columns);
    sheet.addRow(Object.values(valid));
    sheet.getCell(2, columns.indexOf("co2e_factor") + 1).value = { formula: "1/8", result: 0.125 };
    sheet.addRow(Object.values(valid));
    sheet.mergeCells("A3:B3");
    const result = validateFactorImport(await parseUkGovFactors(new Uint8Array(await workbook.xlsx.writeBuffer()), "fixture.xlsx", metadata));
    expect(result.rejectedRows).toHaveLength(2);
    expect(result.rejectedRows.every((row) => row.messages.some((m) => m.code === "UNSUPPORTED_CELL"))).toBe(true);
  });

  it("rejects ambiguous duplicate headers and preserves structured parse messages", async () => {
    const parsed = await parseUkGovFactors(buffer("activity,unit,units,co2e_factor\nFuel,kWh,kg,1\n"), "fixture.csv", metadata);
    expect(parsed.rows).toEqual([]);
    expect(parsed.messages.map((m) => m.code)).toEqual(expect.arrayContaining(["AMBIGUOUS_HEADER", "NO_FACTORS"]));
  });

  it.each([
    ['activity,unit,co2e_factor\n"unclosed,kWh,1', "bad.csv"],
    ['activity,unit,co2e_factor\nf"uel,kWh,1', "bad.csv"],
    ['activity,unit,co2e_factor\n"fuel"junk,kWh,1', "bad.csv"],
    ["not a ZIP workbook", "bad.xlsx"],
  ])("returns a safe parse error for malformed file %#", async (text, name) => {
    const result = validateFactorImport(await parseUkGovFactors(buffer(text), name, metadata));
    expect(result.messages.map((m) => m.code)).toContain("PARSE_FAILED");
    expect(result.commitAllowed).toBe(false);
    expect(result.validationPassed).toBe(false);
  });

  it("handles unsupported/empty inputs and metadata conflicts without guessing from filenames", async () => {
    const unsupported = await parseUkGovFactors(buffer("hi"), "2026.xls");
    expect(unsupported.metadata.year).toBeNull();
    expect(unsupported.messages.map((m) => m.code)).toContain("UNSUPPORTED_FILE");
    const empty = await parseUkGovFactors(buffer("\n\n"), "empty.csv", metadata);
    expect(empty.messages.map((m) => m.code)).toContain("NO_FACTORS");
    const conflict = await parseUkGovFactors(csv([{ ...valid, dataset_year: "2025" }]), "fixture.csv", metadata);
    expect(conflict.metadata.year).toBeNull();
    expect(conflict.messages.map((m) => m.code)).toContain("METADATA_CONFLICT");
  });
});

describe("normalisation and validation", () => {
  it.each([
    ["kWh", "kWh"], ["kilowatt-hour", "kWh"], ["kilowatt hour", "kWh"],
    ["kilogram", "kg"], ["tonnes", "tonne"], ["t", "tonne"],
    ["kilometre", "km"], ["miles", "mile"], ["cubic metre", "m3"], ["m³", "m3"],
  ])("normalises only textual units: %s", (raw, canonical) => expect(normaliseUnit(raw)).toBe(canonical));

  it("accepts synthetic values, preserves raw units and never scales values", async () => {
    const result = await preview([{ ...valid, unit: "tonnes" }]);
    expect(result.counts).toMatchObject({ accepted: 1, warning: 0, rejected: 0, duplicate: 0, byUnit: { tonne: 1 } });
    expect(result.acceptedRows[0]).toMatchObject({ rawUnit: "tonnes", canonicalUnit: "tonne", factorValue: "0.125", factorUnit: "kgCO2e/tonne", gas: "CO2e", kind: "direct" });
    expect(result.validationPassed).toBe(true);
    expect(result.commitAllowed).toBe(false);
    expect(result.commitBlockedReasons[0]).toContain("preview-only");
    expect(result.proposedFactorSet).toMatchObject({ ...metadata, sourceType: "OFFICIAL_DEFRA_DESNZ" });
  });

  it.each(["", "abc", "-0.1", "NaN", "Infinity", "0x10", "1,25", "0.000000001", "10000000000", "1e999"])("rejects missing, invalid or unrepresentable factor %s", async (co2e_factor) => {
    const result = await preview([{ ...valid, co2e_factor }]);
    expect(result.counts.rejected).toBe(1);
    expect(result.candidates[0].factorValue).toBeNull();
    expect(result.validationPassed).toBe(false);
  });

  it.each(["0", "1.25e-1", "9999999999.99999999"])("retains representable decimal values exactly: %s", async (co2e_factor) => {
    const result = await preview([{ ...valid, co2e_factor }]);
    expect(result.counts.accepted).toBe(1);
    expect(result.candidates[0].factorValue).toBe(co2e_factor === "1.25e-1" ? "0.125" : co2e_factor);
  });

  it.each([
    [{ unit: "" }, "MISSING_UNIT"], [{ unit: "kWh (Gross CV)" }, "UNKNOWN_UNIT"],
    [{ unit: "MWh" }, "UNKNOWN_UNIT"], [{ activity: "" }, "MISSING_ACTIVITY_CATEGORY"],
    [{ gas: "CH4" }, "UNSUPPORTED_GAS"], [{ gas: "CO2" }, "UNSUPPORTED_GAS"],
    [{ factor_kind: "total" }, "UNSUPPORTED_KIND"], [{ factor_kind: "" }, "UNSUPPORTED_KIND"],
    [{ factor_kind: "WTT" }, "KIND_CONFLICT"], [{ scope: "SCOPE_3" }, "SCOPE_CONFLICT"],
    [{ factor_unit: "tCO2e/kWh" }, "UNSUPPORTED_FACTOR_UNIT"],
    [{ factor_unit: "kgCO2e/kg" }, "UNSUPPORTED_FACTOR_UNIT"],
    [{ factor_category: "grid_electricity", scope: "SCOPE_2", basis: "" }, "AMBIGUOUS_BASIS"],
    [{ activity: "Total" }, "NON_FACTOR_ROW"],
  ])("blocks unsafe row %#", async (changes, code) => {
    const result = await preview([{ ...valid, ...changes }]);
    expect(result.counts.rejected).toBe(1);
    expect(result.candidates[0].messages.map((m) => m.code)).toContain(code);
  });

  it("separates accepted, warning, rejected and duplicate rows with accurate counts", async () => {
    const result = await preview([
      valid, { ...valid },
      { ...valid, factor_category: "", activity: "Unmapped" },
      { ...valid, subtype_key: "bad", co2e_factor: "" },
    ]);
    expect(result.counts).toMatchObject({ accepted: 1, warning: 1, rejected: 1, duplicate: 1 });
    expect(result.warningRows[0].messages.map((m) => m.code)).toContain("MAPPING_REQUIRED");
    expect(result.messages.map((m) => m.code)).toContain("EXISTING_DATASET_NOT_CHECKED");
    expect(result.counts.bySheet.CSV).toBe(4);
    expect(result.commitAllowed).toBe(false);
  });

  it("supports explicit WTT mapping without collapsing it into direct combustion", async () => {
    const result = await preview([{ ...valid, factor_category: "wtt_natural_gas", scope: "SCOPE_3", factor_kind: "well-to-tank" }]);
    expect(result.acceptedRows[0]).toMatchObject({ kind: "wtt", category: "wtt_natural_gas" });
  });

  it("requires dataset metadata and region without fabricating defaults", async () => {
    const result = validateFactorImport(await parseUkGovFactors(csv([{ ...valid, region: "" }]), "2026.csv"));
    expect(result.metadata).toEqual({ publisher: null, year: null, release: null });
    expect(result.warningRows[0].region).toBeNull();
    expect(result.validationPassed).toBe(false);
    expect(result.messages.map((m) => m.code)).toContain("MISSING_METADATA");
  });

  it.each(["constructor", "__proto__", "toString"])("does not accept inherited object keys as unit aliases: %s", async (unit) => {
    expect(normaliseUnit(unit)).toBeNull();
    expect((await preview([{ ...valid, unit }])).counts.rejected).toBe(1);
  });

  it("preserves unknown populated columns as review warnings, including potential extra gas columns", async () => {
    const result = await preview([{ ...valid, kgCO2: "0.1", constructor: "unmapped" }]);
    expect(result.warningRows).toHaveLength(1);
    expect(result.warningRows[0].source.cells).toContain("0.1");
    expect(result.warningRows[0].messages.map((m) => m.code)).toContain("UNMAPPED_COLUMN");
    expect(result.validationPassed).toBe(false);
  });
});

describe("duplicate detection and deterministic identities", () => {
  it("repeated parses have stable file/source hashes and one eligible identity", async () => {
    const first = await preview([valid, { ...valid, unit: "kWh" }]);
    const second = await preview([valid, { ...valid, unit: "kWh" }]);
    expect(first).toEqual(second);
    expect(first.counts).toMatchObject({ accepted: 1, duplicate: 1 });
    expect(first.candidates[0].identity).toBe(first.candidates[1].identity);
    expect(first.candidates[0].sourceHash).not.toBe(first.candidates[1].sourceHash);
    expect(new Set(first.acceptedRows.map((row) => row.identity)).size).toBe(1);
  });

  it.each([{ co2e_factor: "0.2" }, { unit: "kg" }, { region: "EU" }, { activity: "Different fuel" }])("rejects every conflicting candidate %#", async (changes) => {
    const result = await preview([valid, { ...valid, ...changes }]);
    expect(result.counts.rejected).toBe(2);
    expect(result.acceptedRows).toEqual([]);
  });

  it("detects existing matches with equivalent unit spelling and decimal value", async () => {
    const result = await preview([valid], [existing]);
    expect(result.counts.duplicate).toBe(1);
    expect(result.existingDatasetChecked).toBe(true);
    expect(result.duplicateRows[0].messages.map((m) => m.code)).toContain("EXISTING_FACTOR_DUPLICATE");
  });

  it.each([{ co2eFactor: "0.2" }, { unit: "kg" }, { region: "EU" }])("blocks existing dataset conflict %#", async (changes) => {
    const result = await preview([valid], [{ ...existing, ...changes }]);
    expect(result.rejectedRows[0].messages.map((m) => m.code)).toContain("EXISTING_FACTOR_CONFLICT");
  });

  it("blocks ambiguous null-subtype duplicates already in the database", async () => {
    const result = await preview([valid], [existing, existing]);
    expect(result.counts.rejected).toBe(1);
  });

  it("does not hide unresolved source dimensions behind duplicate status", async () => {
    const result = await preview([valid, { ...valid, dimension: "Unmapped dimension" }]);
    expect(result.counts.rejected).toBe(2);
    const existingResult = await preview([{ ...valid, dimension: "Unmapped dimension" }], [existing]);
    expect(existingResult.counts.warning).toBe(1);
    expect(existingResult.counts.duplicate).toBe(0);
  });
});
