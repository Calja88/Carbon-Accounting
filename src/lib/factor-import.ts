/**
 * Emission factor import (brief Part B). Never invents a number — every
 * value in every EmissionFactor row this module creates came from a file
 * a human uploaded, in a canonical template we define (documented in the
 * admin UI / downloadable via /api/admin/factor-template.csv):
 *
 *   scope, factor_category, subtype_key, basis, region, unit, co2e_factor, notes
 *
 * We don't parse the real DESNZ "GHG Conversion Factors for Company
 * Reporting" workbook's own tab/column layout directly — its exact
 * current-year structure hasn't been supplied to build and verify a
 * parser against, and guessing at that would risk silently misreading a
 * column (exactly the "wrong factor corrupts every report" risk this
 * whole mechanism exists to avoid). Mapping the real file into this
 * template is a manual step for whoever uploads it — see README
 * assumptions for the reasoning and the plan to automate this once a real
 * copy of the file is available to build against.
 *
 * Both .csv and .xlsx are accepted as containers for that same template.
 */

import ExcelJS from "exceljs";
import { FactorBasis, LcaFactorBoundary, Scope } from "@prisma/client";
import { isKnownFactorCategory } from "@/lib/factor-categories";
import { parseCsv } from "@/lib/csv";

export const FACTOR_TEMPLATE_COLUMNS = [
  "scope",
  "factor_category",
  "subtype_key",
  "basis",
  "region",
  "unit",
  "co2e_factor",
  "notes",
  // Life-cycle metadata. Optional, and only meaningful for factors used in
  // product LCA work — a corporate Scope 1/2 factor has no LCA boundary to
  // declare. Kept in this one template rather than a second importer so
  // there is a single audited path into the factor library.
  "boundary",
  "gwp_basis",
  "reference_year",
  "lca_data_source",
  "uncertainty_percent",
] as const;

const HEADER_ALIASES: Record<string, (typeof FACTOR_TEMPLATE_COLUMNS)[number]> = {
  scope: "scope",
  factor_category: "factor_category",
  category: "factor_category",
  subtype_key: "subtype_key",
  subtype: "subtype_key",
  basis: "basis",
  region: "region",
  unit: "unit",
  uom: "unit",
  co2e_factor: "co2e_factor",
  co2efactor: "co2e_factor",
  factor: "co2e_factor",
  ghg_conversion_factor: "co2e_factor",
  notes: "notes",
  note: "notes",
  boundary: "boundary",
  lifecycle_boundary: "boundary",
  factor_boundary: "boundary",
  gwp_basis: "gwp_basis",
  gwp: "gwp_basis",
  characterization_factors: "gwp_basis",
  reference_year: "reference_year",
  data_year: "reference_year",
  year: "reference_year",
  lca_data_source: "lca_data_source",
  dataset: "lca_data_source",
  data_source: "lca_data_source",
  uncertainty_percent: "uncertainty_percent",
  uncertainty: "uncertainty_percent",
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export interface RawFactorRow {
  [column: string]: string;
}


function rowsToObjects(rows: string[][]): RawFactorRow[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((r) => {
    const obj: RawFactorRow = {};
    headers.forEach((h, i) => {
      const canonical = HEADER_ALIASES[h];
      if (canonical) obj[canonical] = (r[i] ?? "").trim();
    });
    return obj;
  });
}

export async function parseFactorFile(buffer: ArrayBuffer, filename: string): Promise<RawFactorRow[]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(buffer);
    return rowsToObjects(parseCsv(text));
  }

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    // exceljs's bundled types lag the current @types/node Buffer shape;
    // this is a real Node Buffer at runtime, just a type-defs mismatch.
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.text ?? "");
      });
      rows.push(cells);
    });
    return rowsToObjects(rows);
  }

  throw new Error(`Unsupported file type: "${filename}" — upload a .csv or .xlsx file in the factor template format.`);
}

export interface ValidatedFactorRow {
  scope: Scope;
  category: string;
  subtypeKey: string | null;
  basis: FactorBasis;
  region: string;
  unit: string;
  co2eFactor: number;
  notes: string | null;
  boundary: LcaFactorBoundary | null;
  gwpBasis: string | null;
  referenceYear: number | null;
  lcaDataSource: string | null;
  uncertaintyPercent: number | null;
}

export interface RowIssue {
  rowNumber: number; // 1-based, counting from the first data row
  message: string;
}

export interface ValidationResult {
  valid: ValidatedFactorRow[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

const SCOPE_ALIASES: Record<string, Scope> = {
  scope_1: Scope.SCOPE_1,
  "scope1": Scope.SCOPE_1,
  "1": Scope.SCOPE_1,
  scope_2: Scope.SCOPE_2,
  "scope2": Scope.SCOPE_2,
  "2": Scope.SCOPE_2,
  scope_3: Scope.SCOPE_3,
  "scope3": Scope.SCOPE_3,
  "3": Scope.SCOPE_3,
};

const BASIS_VALUES = new Set<string>(Object.values(FactorBasis));
const BOUNDARY_VALUES = new Set<string>(Object.values(LcaFactorBoundary));

function parseScope(raw: string): Scope | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SCOPE_ALIASES[key] ?? null;
}

function parseBasis(raw: string): FactorBasis | null {
  if (!raw.trim()) return FactorBasis.STANDARD;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return BASIS_VALUES.has(key) ? (key as FactorBasis) : null;
}

/** Returns undefined for an unrecognised value so the caller can warn on it. */
function parseBoundary(raw: string): LcaFactorBoundary | null | undefined {
  if (!raw.trim()) return null;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return BOUNDARY_VALUES.has(key) ? (key as LcaFactorBoundary) : undefined;
}

/** Validates parsed rows against the canonical template — blocks import on
 * any hard error (missing/malformed required field); an unknown
 * factor_category is a warning only, since it might legitimately be a new
 * category not yet wired to a data point. */
export function validateFactorRows(rows: RawFactorRow[]): ValidationResult {
  const valid: ValidatedFactorRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const scope = parseScope(row.scope ?? "");
    if (!scope) {
      errors.push({ rowNumber, message: `Invalid or missing "scope" ("${row.scope ?? ""}") — must be SCOPE_1, SCOPE_2 or SCOPE_3.` });
      return;
    }

    const category = (row.factor_category ?? "").trim();
    if (!category) {
      errors.push({ rowNumber, message: 'Missing "factor_category".' });
      return;
    }

    const basis = parseBasis(row.basis ?? "");
    if (!basis) {
      errors.push({ rowNumber, message: `Invalid "basis" ("${row.basis}") — must be STANDARD, LOCATION_BASED, MARKET_BASED or RESIDUAL_MIX.` });
      return;
    }

    const unit = (row.unit ?? "").trim();
    if (!unit) {
      errors.push({ rowNumber, message: 'Missing "unit".' });
      return;
    }

    const co2eFactorRaw = (row.co2e_factor ?? "").trim();
    const co2eFactor = Number(co2eFactorRaw);
    if (co2eFactorRaw === "" || !Number.isFinite(co2eFactor) || co2eFactor < 0) {
      errors.push({ rowNumber, message: `Invalid "co2e_factor" ("${co2eFactorRaw}") — must be a number >= 0.` });
      return;
    }

    if (!isKnownFactorCategory(category)) {
      warnings.push({
        rowNumber,
        message: `"${category}" isn't one of the platform's known factor categories yet — the row will still be imported, but won't be used by any calculation until a data point references it.`,
      });
    }

    const boundary = parseBoundary(row.boundary ?? "");
    if (boundary === undefined) {
      warnings.push({
        rowNumber,
        message: `"${row.boundary}" isn't a lifecycle boundary this platform recognises, so the row will import without one. Product assessments flag factors with no stated boundary, because what a factor covers decides whether a model double-counts or leaves a gap.`,
      });
    }

    const referenceYearRaw = (row.reference_year ?? "").trim();
    const referenceYear = referenceYearRaw ? Number(referenceYearRaw) : null;
    if (referenceYearRaw && (!Number.isInteger(referenceYear) || (referenceYear as number) < 1900 || (referenceYear as number) > 2200)) {
      errors.push({ rowNumber, message: `Invalid "reference_year" ("${referenceYearRaw}") — must be a four-digit year.` });
      return;
    }

    const uncertaintyRaw = (row.uncertainty_percent ?? "").trim();
    const uncertaintyPercent = uncertaintyRaw ? Number(uncertaintyRaw) : null;
    if (uncertaintyRaw && (!Number.isFinite(uncertaintyPercent) || (uncertaintyPercent as number) < 0)) {
      errors.push({ rowNumber, message: `Invalid "uncertainty_percent" ("${uncertaintyRaw}") — must be a number >= 0.` });
      return;
    }

    valid.push({
      scope,
      category,
      subtypeKey: row.subtype_key?.trim() || null,
      basis,
      region: row.region?.trim() || "UK",
      unit,
      co2eFactor,
      notes: row.notes?.trim() || null,
      boundary: boundary ?? null,
      gwpBasis: row.gwp_basis?.trim() || null,
      referenceYear: referenceYear,
      lcaDataSource: row.lca_data_source?.trim() || null,
      uncertaintyPercent: uncertaintyPercent,
    });
  });

  return { valid, errors, warnings };
}

/** For the "Download CSV template" link in the admin UI. */
export function buildTemplateCsv(): string {
  const header = FACTOR_TEMPLATE_COLUMNS.join(",");
  const corporateExample =
    "SCOPE_1,stationary_combustion_natural_gas,,STANDARD,UK,kWh,0.18293,Example row - replace with real published figures,,,,,";
  const lcaExample =
    "SCOPE_3,lca_material_plastic,abs,STANDARD,EU,kg,0,Example product-LCA row - replace the factor with a real sourced value,CRADLE_TO_GATE,IPCC AR6 GWP100,2024,Dataset name within the publisher library,15";
  return `${header}\n${corporateExample}\n${lcaExample}\n`;
}
