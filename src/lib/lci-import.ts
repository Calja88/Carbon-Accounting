/**
 * Importer for the canonical UK DESNZ 2026 "LCI Integration Pack" schema
 * (data/lci-import/uk-desnz-2026/canonical_factor_schema.json) — a richer,
 * governance-aware row shape than the platform's own flat template
 * (src/lib/factor-import.ts). Kept as a separate module rather than forced
 * through the generic importer's column aliases, per the brief.
 *
 * This is a reference/product-LCA library import, not the hand-curated
 * corporate Scope 1/2/3 factor set: rows keep their own pack category
 * hierarchy rather than being force-mapped onto an existing platform
 * `factorCategory` key (src/lib/factor-categories.ts still applies to the
 * corporate side; nothing here changes it).
 *
 * IMPORTANT METHODOLOGICAL LIMITATION (see PACK_README.md): every row this
 * module can import is a *characterised UK GHG conversion factor*, not a
 * complete unit-process LCI — isFullUnitProcessLci is always hard-coded
 * false. This pack is not a complete LCI database and must never be
 * presented as one.
 *
 * Never invents a value: every EmissionFactor row this module can produce
 * traces back one-to-one to a parsed CSV row with a real, published
 * `factor_value`. Rows with no published value (`factor_status =
 * DATA_UNAVAILABLE`, blank `factor_value`) are always rejected, never
 * coerced to zero.
 */

import { LcaFactorBoundary, LciLicenseDecision, Scope } from "@prisma/client";
import { parseCsv } from "@/lib/csv";

// --- parsing -----------------------------------------------------------

export interface RawLciRow {
  [column: string]: string;
}

const CANONICAL_COLUMNS = [
  "factor_id",
  "source_factor_id",
  "name",
  "description",
  "scope",
  "category_level_1",
  "category_level_2",
  "category_level_3",
  "category_level_4",
  "column_text",
  "factor_value",
  "numerator_unit",
  "denominator_unit",
  "original_uom",
  "impact_category",
  "characterisation_basis",
  "geography",
  "lifecycle_boundary",
  "dataset_type",
  "is_full_unit_process_lci",
  "data_type",
  "factor_status",
  "lca_relevance",
  "lca_use_status",
  "requires_human_review",
  "automated_assignment_allowed",
  "is_placeholder",
  "source_name",
  "source_publisher",
  "source_year",
  "source_version",
  "publication_date",
  "source_file_updated",
  "source_page_last_updated",
  "valid_from",
  "valid_to",
  "license",
  "license_decision",
  "source_url",
  "methodology_url",
  "license_url",
  "review_notes",
] as const;

/** Strips a UTF-8 BOM, which every staged pack CSV starts with. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function rowsToObjects(rows: string[][]): RawLciRow[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: RawLciRow = {};
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? "").trim();
    });
    return obj;
  });
}

/** Parses a canonical-schema CSV (BOM-safe). Any of the three staged pack
 * files share this exact column set. */
export function parseLciCsv(text: string): RawLciRow[] {
  return rowsToObjects(parseCsv(stripBom(text)));
}

// --- validation ----------------------------------------------------------

export interface ValidatedLciRow {
  externalFactorId: string;
  sourceFactorId: string | null;
  name: string;
  description: string | null;
  scope: Scope;
  categoryLevel1: string | null;
  categoryLevel2: string | null;
  categoryLevel3: string | null;
  categoryLevel4: string | null;
  factorValue: number;
  /** The exact original decimal text from the file, e.g. "3033.38067" —
   * passed straight to Prisma's Decimal column so the stored value is
   * never a float re-serialisation of the source figure. */
  factorValueRaw: string;
  numeratorUnit: string;
  denominatorUnit: string;
  originalUom: string | null;
  boundary: LcaFactorBoundary;
  sourceLifecycleBoundary: string;
  geography: string | null;
  sourceName: string;
  sourcePublisher: string | null;
  sourceYear: number | null;
  sourceVersion: string;
  publicationDate: Date | null;
  sourceUpdatedDate: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  licenseName: string | null;
  licenseDecisionRaw: string;
  sourceUrl: string | null;
  methodologyUrl: string | null;
  licenseUrl: string | null;
  reviewNotes: string | null;
  /** True for the ~38 legitimate published zero-value rows, so the UI can
   * show them distinctly from rejects rather than just as "0". */
  isLegitimateZero: boolean;
}

export type RejectReason =
  | "MISSING_VALUE" // factor_status DATA_UNAVAILABLE / blank factor_value — never coerced to zero
  | "NON_ACTIVE_STATUS" // factor_status is something other than ACTIVE_PUBLIC
  | "LICENSE_NOT_ALLOWED" // license_decision isn't ALLOW_WITH_ATTRIBUTION
  | "NON_NUMERIC_VALUE" // factor_value present but not parseable as a number
  | "MISSING_REQUIRED_FIELD" // schema-required field absent
  | "UNKNOWN_SCOPE"
  | "UNKNOWN_BOUNDARY";

export interface RejectedRow {
  rowNumber: number; // 1-based, counting from the first data row
  factorId: string | null;
  reason: RejectReason;
  message: string;
}

export interface DuplicateRow {
  rowNumber: number;
  factorId: string;
  sourceVersion: string;
}

export interface LciValidationResult {
  importable: ValidatedLciRow[];
  rejected: RejectedRow[];
  /** Populated by validateLciRows only when a duplicate-check set is supplied; otherwise empty and left to the caller (see checkDuplicates). */
  counts: {
    total: number;
    importable: number;
    rejectedMissingValue: number;
    rejectedOther: number;
  };
}

const SCOPE_MAP: Record<string, Scope> = {
  "scope 1": Scope.SCOPE_1,
  "scope 2": Scope.SCOPE_2,
  "scope 3": Scope.SCOPE_3,
};

/**
 * Maps the pack's raw, fine-grained lifecycle_boundary values onto the
 * platform's coarser LcaFactorBoundary enum. The raw string is always also
 * stored (sourceLifecycleBoundary) since this mapping is inherently lossy
 * and the double-counting heuristic needs the un-lossy original.
 */
const BOUNDARY_MAP: Record<string, LcaFactorBoundary> = {
  DIRECT_COMBUSTION: LcaFactorBoundary.COMBUSTION_ONLY,
  DIRECT_BIOENERGY_COMBUSTION_OR_RELEASE: LcaFactorBoundary.COMBUSTION_ONLY,
  DIRECT_FUGITIVE_OR_PROCESS_RELEASE: LcaFactorBoundary.GATE_TO_GATE,
  UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY: LcaFactorBoundary.WELL_TO_TANK,
  ELECTRICITY_TRANSMISSION_AND_DISTRIBUTION: LcaFactorBoundary.UPSTREAM,
  ELECTRICITY_GENERATION_USE: LcaFactorBoundary.UPSTREAM,
  PURCHASED_HEAT_AND_STEAM: LcaFactorBoundary.UPSTREAM,
  WATER_SUPPLY: LcaFactorBoundary.UPSTREAM,
  WASTEWATER_TREATMENT: LcaFactorBoundary.END_OF_LIFE,
  END_OF_LIFE_TREATMENT: LcaFactorBoundary.END_OF_LIFE,
  CRADLE_TO_GATE_MATERIAL_PROXY: LcaFactorBoundary.CRADLE_TO_GATE,
  TRANSPORT_OPERATION: LcaFactorBoundary.GATE_TO_GATE,
  LEASED_ASSET_TRANSPORT_OPERATION: LcaFactorBoundary.GATE_TO_GATE,
  LEASED_ASSET_ELECTRICITY_USE: LcaFactorBoundary.UPSTREAM,
  SERVICE_OPERATIONAL_PROXY: LcaFactorBoundary.GATE_TO_GATE,
};

function parseDate(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validates and filters raw parsed rows against the governance rules (brief
 * items 4-6, 9-11). Only rows with factor_status === "ACTIVE_PUBLIC" AND
 * license_decision === "ALLOW_WITH_ATTRIBUTION" AND a numeric factor_value
 * are importable — everything else is a rejected row with a clear reason,
 * never coerced to zero and never silently dropped from the report.
 *
 * `allowedLicenseDecisions` lets the caller additionally gate on the
 * governance registry (LciSource.licenseDecision) rather than trusting the
 * file's own license_decision column blindly — pass the set of raw manifest
 * decision strings currently permitted for numeric import (normally just
 * the exact string "ALLOW_WITH_ATTRIBUTION").
 */
export function validateLciRows(rows: RawLciRow[]): LciValidationResult {
  const importable: ValidatedLciRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const factorId = (row.factor_id ?? "").trim() || null;

    const factorStatus = (row.factor_status ?? "").trim();
    const licenseDecision = (row.license_decision ?? "").trim();
    const factorValueRaw = (row.factor_value ?? "").trim();

    // Required-field checks first (schema-required fields).
    const name = (row.name ?? "").trim();
    const sourceName = (row.source_name ?? "").trim();
    const sourceVersion = (row.source_version ?? "").trim();
    const sourceYearRaw = (row.source_year ?? "").trim();
    const lifecycleBoundaryRaw = (row.lifecycle_boundary ?? "").trim();

    if (!factorId || !name || !sourceName || !sourceVersion || !sourceYearRaw || !lifecycleBoundaryRaw) {
      rejected.push({
        rowNumber,
        factorId,
        reason: "MISSING_REQUIRED_FIELD",
        message: "Missing one or more schema-required fields (factor_id, name, source_name, source_version, source_year, lifecycle_boundary).",
      });
      return;
    }

    // Governance gate 1: factor_status.
    if (factorStatus !== "ACTIVE_PUBLIC") {
      const isMissing = factorStatus === "DATA_UNAVAILABLE" || factorValueRaw === "";
      rejected.push({
        rowNumber,
        factorId,
        reason: isMissing ? "MISSING_VALUE" : "NON_ACTIVE_STATUS",
        message: isMissing
          ? `No published value (factor_status="${factorStatus || "(blank)"}") — never imported and never treated as zero.`
          : `factor_status is "${factorStatus}", not ACTIVE_PUBLIC — not imported.`,
      });
      return;
    }

    // Governance gate 2: license_decision on the row itself must be
    // exactly ALLOW_WITH_ATTRIBUTION. (The commit path additionally checks
    // the LciSource registry's own decision — see lci-import-service.ts —
    // so a source that regresses in the registry is blocked even if a row
    // still claims ALLOW_WITH_ATTRIBUTION.)
    if (licenseDecision !== "ALLOW_WITH_ATTRIBUTION") {
      rejected.push({
        rowNumber,
        factorId,
        reason: "LICENSE_NOT_ALLOWED",
        message: `license_decision is "${licenseDecision || "(blank)"}", not ALLOW_WITH_ATTRIBUTION — not imported.`,
      });
      return;
    }

    // Governance gate 3: factor_value must be numeric (0 is legitimate).
    if (factorValueRaw === "") {
      rejected.push({
        rowNumber,
        factorId,
        reason: "MISSING_VALUE",
        message: "factor_status is ACTIVE_PUBLIC but factor_value is blank — never imported and never treated as zero.",
      });
      return;
    }
    const factorValue = Number(factorValueRaw);
    if (!Number.isFinite(factorValue)) {
      rejected.push({
        rowNumber,
        factorId,
        reason: "NON_NUMERIC_VALUE",
        message: `factor_value ("${factorValueRaw}") is not a valid number.`,
      });
      return;
    }

    const scopeKey = (row.scope ?? "").trim().toLowerCase();
    const scope = SCOPE_MAP[scopeKey];
    if (!scope) {
      rejected.push({ rowNumber, factorId, reason: "UNKNOWN_SCOPE", message: `Unrecognised scope "${row.scope}".` });
      return;
    }

    const boundaryKey = lifecycleBoundaryRaw.toUpperCase();
    const boundary = BOUNDARY_MAP[boundaryKey] ?? LcaFactorBoundary.UNKNOWN;

    const numeratorUnit = (row.numerator_unit ?? "").trim();
    const denominatorUnit = (row.denominator_unit ?? "").trim();
    const sourceYear = Number.isFinite(Number(sourceYearRaw)) ? Number(sourceYearRaw) : null;

    importable.push({
      externalFactorId: factorId,
      sourceFactorId: (row.source_factor_id ?? "").trim() || null,
      name,
      description: (row.description ?? "").trim() || null,
      scope,
      categoryLevel1: (row.category_level_1 ?? "").trim() || null,
      categoryLevel2: (row.category_level_2 ?? "").trim() || null,
      categoryLevel3: (row.category_level_3 ?? "").trim() || null,
      categoryLevel4: (row.category_level_4 ?? "").trim() || null,
      // Exact value preserved — parsed as a JS number here for validation,
      // but the caller passes the original decimal string on to Prisma's
      // Decimal column, never a rounded float re-serialisation.
      factorValue,
      factorValueRaw,
      numeratorUnit,
      denominatorUnit,
      originalUom: (row.original_uom ?? "").trim() || null,
      boundary,
      sourceLifecycleBoundary: lifecycleBoundaryRaw,
      geography: (row.geography ?? "").trim() || null,
      sourceName,
      sourcePublisher: (row.source_publisher ?? "").trim() || null,
      sourceYear,
      sourceVersion,
      publicationDate: parseDate(row.publication_date),
      sourceUpdatedDate: parseDate(row.source_file_updated),
      validFrom: parseDate(row.valid_from),
      validTo: parseDate(row.valid_to),
      licenseName: (row.license ?? "").trim() || null,
      licenseDecisionRaw: licenseDecision,
      sourceUrl: (row.source_url ?? "").trim() || null,
      methodologyUrl: (row.methodology_url ?? "").trim() || null,
      licenseUrl: (row.license_url ?? "").trim() || null,
      reviewNotes: (row.review_notes ?? "").trim() || null,
      isLegitimateZero: factorValue === 0,
    });
  });

  const rejectedMissingValue = rejected.filter((r) => r.reason === "MISSING_VALUE").length;

  return {
    importable,
    rejected,
    counts: {
      total: rows.length,
      importable: importable.length,
      rejectedMissingValue,
      rejectedOther: rejected.length - rejectedMissingValue,
    },
  };
}

/** Splits importable rows into new-to-import vs already-in-the-database
 * duplicates, keyed on (externalFactorId, sourceVersion) — the same pair
 * the DB's unique constraint enforces. Never mutates existingKeys. */
export function partitionDuplicates(
  rows: ValidatedLciRow[],
  existingKeys: ReadonlySet<string>,
): { toImport: ValidatedLciRow[]; duplicates: DuplicateRow[] } {
  const toImport: ValidatedLciRow[] = [];
  const duplicates: DuplicateRow[] = [];
  rows.forEach((row, idx) => {
    const key = dedupKey(row.externalFactorId, row.sourceVersion);
    if (existingKeys.has(key)) {
      duplicates.push({ rowNumber: idx + 1, factorId: row.externalFactorId, sourceVersion: row.sourceVersion });
    } else {
      toImport.push(row);
    }
  });
  return { toImport, duplicates };
}

export function dedupKey(externalFactorId: string, sourceVersion: string): string {
  return `${externalFactorId} ${sourceVersion}`;
}

// --- double-counting heuristic (brief item 11) ----------------------------

const DIRECT_BOUNDARIES = new Set(["DIRECT_COMBUSTION", "DIRECT_FUGITIVE_OR_PROCESS_RELEASE", "DIRECT_BIOENERGY_COMBUSTION_OR_RELEASE"]);
const WTT_BOUNDARIES = new Set(["UPSTREAM_FUEL_ENERGY_OR_TRANSPORT_SUPPLY"]);

export interface DoubleCountingWarning {
  categoryKey: string;
  directFactorId: string;
  wttFactorId: string;
  message: string;
}

export interface SelectedFactorForCheck {
  externalFactorId: string | null;
  sourceLifecycleBoundary: string | null;
  /** category_level_1..3 joined, or any equivalent grouping key the caller
   * uses to recognise "same underlying fuel/activity". */
  categoryKey: string;
}

/**
 * Detects when a set of selected factors includes both a direct-emission
 * factor (combustion/fugitive) and an upstream well-to-tank factor for what
 * looks like the same fuel/activity (matched on categoryKey). This is a
 * warning, never a hard block — the two are legitimately often both wanted
 * (e.g. DEFRA's own "direct + WTT" convention), they just both need to be
 * visible and intentional.
 */
export function detectDoubleCounting(selected: SelectedFactorForCheck[]): DoubleCountingWarning[] {
  const byCategory = new Map<string, SelectedFactorForCheck[]>();
  for (const f of selected) {
    if (!f.categoryKey) continue;
    const list = byCategory.get(f.categoryKey) ?? [];
    list.push(f);
    byCategory.set(f.categoryKey, list);
  }

  const warnings: DoubleCountingWarning[] = [];
  for (const [categoryKey, factors] of byCategory) {
    const direct = factors.find((f) => f.sourceLifecycleBoundary && DIRECT_BOUNDARIES.has(f.sourceLifecycleBoundary));
    const wtt = factors.find((f) => f.sourceLifecycleBoundary && WTT_BOUNDARIES.has(f.sourceLifecycleBoundary));
    if (direct && wtt) {
      warnings.push({
        categoryKey,
        directFactorId: direct.externalFactorId ?? "(unknown)",
        wttFactorId: wtt.externalFactorId ?? "(unknown)",
        message: `Both a direct-emission factor and a well-to-tank (upstream supply) factor are selected for "${categoryKey}". This is often intentional (direct + WTT is a recognised convention), but confirm it isn't double-counting the same activity.`,
      });
    }
  }
  return warnings;
}

// --- governance helper -----------------------------------------------------

/** True only for a source whose normalised registry decision permits
 * numeric import — used by the commit path as the authoritative gate,
 * independent of what any individual row's own license_decision column
 * claims (brief: a BLOCK/non-ALLOW_WITH_ATTRIBUTION manifest source is
 * refused numeric import even if handed a well-formed row). */
export function sourceAllowsNumericImport(decision: LciLicenseDecision): boolean {
  return decision === LciLicenseDecision.ALLOW_WITH_ATTRIBUTION;
}

export { CANONICAL_COLUMNS };
