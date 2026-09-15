import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { normalizeHeaderKey, parseCsv } from "@/lib/csv";
import type { DatasetMetadata, ImportMessage, ParsedFactorFile, SourceRow } from "./types";

// Explicit tabular contract plus the locally calibrated 2026 official flat file.
const aliases: Record<string, string> = {
  category_path: "categoryPath", source_category: "categoryPath", category: "categoryPath",
  activity: "activity", fuel: "activity", material: "activity", travel_mode: "activity",
  unit: "unit", units: "unit", uom: "unit",
  factor_value: "value", co2e_factor: "value", kgco2e: "value",
  gas: "gas", gas_basis: "gas", factor_kind: "kind", factor_type: "kind",
  factor_unit: "factorUnit", publisher: "publisher", source: "publisher",
  dataset_year: "year", year: "year", release: "release", version: "release",
  factor_category: "category", subtype_key: "subtypeKey", scope: "scope",
  basis: "basis", region: "region", geography: "region", notes: "notes",
};
const flatAliases: Record<string, string> = {
  id: "sourceId", scope: "scope", level_1: "level1", level_2: "level2",
  level_3: "level3", level_4: "level4", column_text: "columnText", uom: "unit",
  "ghg/unit": "gas",
};
const message = (code: string, text: string, severity: ImportMessage["severity"] = "error"): ImportMessage =>
  ({ severity, code, message: text });

/** Split records without losing physical line numbers; reuse shared CSV cell decoding. */
function csvRecords(text: string): { number: number; cells: string[] }[] {
  const records: { number: number; cells: string[] }[] = [];
  let start = 0, line = 1, startLine = 1, quoted = false;
  for (let i = 0; i <= text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue; }
      // Quotes are only valid at the start/end of a quoted field.
      if (!quoted && i > start && text[i - 1] !== ",") throw new Error("Malformed CSV");
      quoted = !quoted;
      if (!quoted && i + 1 < text.length && !/[\r\n,]/.test(text[i + 1])) throw new Error("Malformed CSV");
    }
    const newline = text[i] === "\n" || text[i] === "\r";
    if ((!quoted && newline) || i === text.length) {
      const record = text.slice(start, i);
      records.push({ number: startLine, cells: parseCsv(record)[0] ?? [] });
      start = i + (text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1);
    }
    if (newline) {
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      line++;
      if (!quoted) startLine = line;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  return records;
}

export async function parseUkGovFactors(
  buffer: ArrayBuffer | Uint8Array,
  sourceFileName: string,
  supplied: Partial<DatasetMetadata> = {},
): Promise<ParsedFactorFile> {
  const bytes = Buffer.from(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);
  const result: ParsedFactorFile = {
    sourceFileName, fileHash: createHash("sha256").update(bytes).digest("hex"),
    metadata: { publisher: null, year: null, release: null }, sheets: [], totalRowsScanned: 0, rows: [], messages: [],
  };
  if (bytes.length > 10 * 1024 * 1024) {
    result.messages.push(message("FILE_TOO_LARGE", "Maximum supported file size is 10 MiB."));
    return result;
  }
  const metadataValues = { publisher: new Set<string>(), year: new Set<string>(), release: new Set<string>() };
  function observe(field: string, value: string) {
    if (field === "publisher" || field === "year" || field === "release") {
      if (value.trim()) metadataValues[field].add(value.trim());
    }
  }
  Object.entries(supplied).forEach(([key, value]) => { if (value != null) observe(key, String(value)); });

  function scan(name: string, records: { number: number; cells: string[]; unsafe?: boolean }[]) {
    const sheet: ParsedFactorFile["sheets"][number] = { name, supported: false, rowsScanned: records.length };
    result.sheets.push(sheet);
    result.totalRowsScanned += records.length;
    let headers: (string | undefined)[] | null = null;
    let impliedCo2e = false;
    let officialFlat = false;
    for (const record of records) {
      const { cells } = record;
      if (!cells.some((cell) => cell.trim())) continue;
      const keys = cells.map(normalizeHeaderKey);
      const flatHeader = keys.some((key) => /^ghg_conversion_factor_\d{4}$/.test(key)) &&
        Object.keys(flatAliases).every((key) => keys.includes(key));
      const detected = keys.map((key) => flatHeader
        ? /^ghg_conversion_factor_\d{4}$/.test(key) ? "value" : Object.hasOwn(flatAliases, key) ? flatAliases[key] : undefined
        : Object.hasOwn(aliases, key) ? aliases[key] : undefined);
      if (flatHeader || (detected.includes("value") && (detected.includes("activity") || detected.includes("categoryPath") || detected.includes("category")))) {
        const known = detected.filter(Boolean);
        const ambiguous = new Set(known).size !== known.length;
        if (ambiguous || record.unsafe) {
          result.messages.push(message("AMBIGUOUS_HEADER", `Ambiguous header in ${name}, row ${record.number}.`));
          headers = null;
          continue;
        }
        headers = detected;
        officialFlat = flatHeader;
        if (officialFlat) {
          observe("year", keys.find((key) => /^ghg_conversion_factor_\d{4}$/.test(key))!.slice(-4));
          (sheet.tables ??= []).push({ rowNumber: record.number, headers: cells, layout: "official-flat" });
        }
        impliedCo2e = keys.includes("co2e_factor") || keys.includes("kgco2e");
        sheet.supported = true;
        continue;
      }
      // Metadata preambles are explicit key/value pairs, never filename guesses.
      if (!headers && cells.filter((v) => v.trim()).length === 2 && detected[0] && ["publisher", "year", "release"].includes(detected[0])) {
        observe(detected[0], cells[1] ?? "");
        continue;
      }
      if (!headers) {
        result.messages.push(message("UNSUPPORTED_ROW", `Unmapped preamble or table row in ${name}, row ${record.number}.`, "warning"));
        continue;
      }
      const fields: Record<string, string> = {};
      headers.forEach((key, index) => { if (key) fields[key] = cells[index] ?? ""; });
      if (officialFlat) {
        const populated = cells.filter((cell) => cell.trim());
        if (populated.length === 1 && populated[0].trim() === "END" && !record.unsafe) continue;
        fields.categoryPath = [fields.level1, fields.level2, fields.level3, fields.level4].filter((v) => v?.trim()).join(" > ");
        fields.activity = [fields.level2, fields.level3, fields.level4, fields.columnText].filter((v) => v?.trim()).join(" > ");
        fields.factorUnit = fields.gas;
        // Only boundaries explicit in this calibrated subset are classified.
        // Corporate category/subtype/region and Scope 2 basis still require review.
        fields.kind = /^WTT\s*-/i.test(fields.level1.trim()) ? "wtt"
          : fields.level1.trim() === "Fuels" && fields.scope.trim() === "Scope 1" ? "direct" : "";
      }
      if (impliedCo2e) {
        fields.gas ||= "CO2e";
        fields.factorUnit ||= "kgCO2e";
      }
      Object.entries(fields).forEach(([key, value]) => observe(key, value));
      const row: SourceRow = { sheet: name, rowNumber: record.number, cells, fields, messages: [] };
      if (officialFlat && !fields.kind) row.messages.push(message("UNREVIEWED_FACTOR_KIND", "This source table's emissions boundary is unreviewed; direct, total or lifecycle must not be guessed."));
      if (officialFlat && /^kwh\b/i.test(fields.gas.trim())) row.messages.push(message("NOT_EMISSION_FACTOR", "This is an energy conversion, not a kgCO2e emissions factor."));
      if (record.unsafe) row.messages.push(message("UNSUPPORTED_CELL", "Formula, error or merged data cell requires an explicit value."));
      if (cells.some((cell, index) => index < headers!.length && !headers![index] && cell.trim())) {
        row.messages.push(message("UNMAPPED_COLUMN", "Populated source columns are unrecognised; review their meaning before mapping this row.", "warning"));
      }
      if (cells.some((cell, index) => index >= headers!.length && cell.trim())) {
        row.messages.push(message("EXTRA_CELLS", "Data extends beyond the detected header."));
      }
      const text = [fields.activity, fields.categoryPath, fields.category, cells.find((cell) => cell.trim())].filter(Boolean).join(" ");
      if (/^(notes?\b|totals?\b|subtotals?\b|footnotes?\b)/i.test(text)) {
        row.messages.push(message("NON_FACTOR_ROW", "Note, total or heading; excluded from factor candidates."));
      }
      result.rows.push(row);
    }
    if (!sheet.supported) result.messages.push({ ...message("UNSUPPORTED_SHEET", `No supported factor table found in ${name}; metadata or other layouts are not factor tables.`, "warning"), sheet: name });
  }

  try {
    if (/\.csv$/i.test(sourceFileName)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      const records = csvRecords(text);
      if (records.length > 50000) throw new Error("Row limit");
      // Do not count an extra record after a final line terminator.
      if (/[\r\n]$/.test(text)) records.pop();
      scan("CSV", records);
    } else if (/\.(xlsx|xlsm)$/i.test(sourceFileName)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      if (workbook.worksheets.reduce((sum, sheet) => sum + sheet.rowCount, 0) > 50000) throw new Error("Row limit");
      for (const sheet of workbook.worksheets) {
        // The front page uses merged cells and several key/value pairs per row.
        // Read masters only; cached formula/error metadata is never trusted.
        if (sheet.name === "Front page") {
          sheet.eachRow((row) => {
            const values: string[] = [];
            let unsafe = false;
            row.eachCell((cell) => {
              if (cell.isMerged && cell.address !== cell.master.address) return;
              unsafe ||= cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error;
              if (cell.value != null && cell.text.trim()) values.push(cell.text.trim());
            });
            if (unsafe) {
              result.messages.push({ ...message("UNSUPPORTED_METADATA", "Formula or error in front-page metadata; provide explicit source values."), sheet: sheet.name, rowNumber: row.number });
              return;
            }
            values.forEach((value, index) => {
              if (value === "UK Government GHG Conversion Factors for Company Reporting") observe("publisher", "UK Government");
              if (/^year\s*:?$/i.test(value)) observe("year", values[index + 1] ?? "");
              if (/^version\s*:?$/i.test(value)) observe("release", values[index + 1] ?? "");
            });
          });
        }
        const records: { number: number; cells: string[]; unsafe: boolean }[] = [];
        for (let number = 1; number <= sheet.rowCount; number++) {
          const row = sheet.getRow(number);
          const cells: string[] = [];
          let unsafe = false;
          for (let col = 1; col <= row.cellCount; col++) {
            const cell = row.getCell(col);
            // ExcelJS throws reading .text on a merge whose master is empty.
            cells.push(cell.value == null ? "" : cell.text);
            unsafe ||= cell.isMerged || cell.type === ExcelJS.ValueType.Formula || cell.type === ExcelJS.ValueType.Error;
          }
          records.push({ number, cells, unsafe });
        }
        scan(sheet.name, records);
      }
    } else result.messages.push(message("UNSUPPORTED_FILE", "Supply a UTF-8 CSV, XLSX or XLSM file in the supported tabular format."));
  } catch {
    result.messages.push(message("PARSE_FAILED", "File is malformed, unreadable or exceeds the 50,000 row limit. No import is allowed."));
  }
  for (const key of ["publisher", "year", "release"] as const) {
    const values = [...metadataValues[key]];
    if (values.length > 1) result.messages.push(message("METADATA_CONFLICT", `Conflicting ${key} metadata; resolve before importing.`));
    if (!values.length) result.messages.push(message("MISSING_METADATA", `Supply dataset ${key}.`));
    if (key === "year") {
      const year = Number(values[0]);
      if (values.length === 1 && /^\d{4}$/.test(values[0]) && year >= 1900 && year <= 2200) result.metadata.year = year;
      else if (values.length) result.messages.push(message("INVALID_YEAR", "Dataset year must be an unambiguous four-digit year between 1900 and 2200."));
    } else result.metadata[key] = values.length === 1 ? values[0] : null;
  }
  if (!result.rows.length) result.messages.push(message("NO_FACTORS", "No supported factor rows found."));
  return result;
}
