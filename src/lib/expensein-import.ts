/**
 * ExpenseIn -> Scope 3 Category 6 (business travel) import.
 *
 * ExpenseIn's CSV export formats are **user-configurable** — an admin picks
 * which data fields to export and sets their own header name for each one
 * (docs.expensein.com, "Edit a CSV export format"). There is therefore no
 * single fixed schema to hardcode a parser against. This module instead:
 *
 *   1. auto-detects the four columns it needs from a broad alias list
 *      covering ExpenseIn's standard field names (expense date, category,
 *      description, distance/amount), and
 *   2. lets the importer override every column mapping by hand when
 *      auto-detection guesses wrong or the export uses bespoke headers.
 *
 * Travel type comes from the expense *category* text, matched against
 * keyword rules onto this platform's S3-06 subtypes. Anything unmatched is
 * reported row by row and skipped — never silently guessed at, and never
 * defaulted to a travel type, since picking the wrong one would produce a
 * plausible-looking but wrong emissions figure.
 *
 * Car-mileage claims are recognised and deliberately NOT imported here:
 * employee-owned vehicles used for business are grey fleet (Scope 1, data
 * map row S1-04), not Category 6. They're surfaced as skipped-with-reason
 * so the mileage isn't quietly lost.
 */

import ExcelJS from "exceljs";

/** S3-06 subtype keys, from prisma/seed/activity-data-points.ts. */
export type TravelSubtype = "rail" | "flight_domestic" | "flight_short_haul" | "flight_long_haul" | "hotel";

export const TRAVEL_SUBTYPE_UNITS: Record<TravelSubtype, "km" | "nights"> = {
  rail: "km",
  flight_domestic: "km",
  flight_short_haul: "km",
  flight_long_haul: "km",
  hotel: "nights",
};

export const TRAVEL_SUBTYPE_LABELS: Record<TravelSubtype, string> = {
  rail: "Rail",
  flight_domestic: "Domestic flight",
  flight_short_haul: "Short-haul international flight",
  flight_long_haul: "Long-haul international flight",
  hotel: "Hotel stay",
};

export const MILES_TO_KM = 1.609344;

export type ColumnRole = "date" | "category" | "quantity" | "description";

/**
 * Header aliases, lowercased and punctuation-stripped. Covers ExpenseIn's
 * standard export field names plus the obvious variants a custom format is
 * likely to produce.
 */
const COLUMN_ALIASES: Record<ColumnRole, string[]> = {
  date: ["expense date", "date", "transaction date", "date of expense", "submission date", "expensedate"],
  category: ["category", "expense category", "category name", "expense type", "type", "category reference"],
  quantity: [
    "distance",
    "miles",
    "mileage",
    "business miles",
    "total business miles",
    "km",
    "kilometres",
    "kilometers",
    "quantity",
    "qty",
    "nights",
    "number of nights",
  ],
  description: ["description", "expense description", "details", "notes", "merchant", "supplier"],
};

/** Keyword rules mapping an ExpenseIn category/description onto an S3-06 subtype. */
const SUBTYPE_RULES: { subtype: TravelSubtype; keywords: string[] }[] = [
  { subtype: "hotel", keywords: ["hotel", "accommodation", "lodging", "overnight", "b&b", "bed and breakfast"] },
  { subtype: "flight_long_haul", keywords: ["long haul", "long-haul", "longhaul", "intercontinental"] },
  { subtype: "flight_short_haul", keywords: ["short haul", "short-haul", "shorthaul", "european flight", "europe flight"] },
  { subtype: "flight_domestic", keywords: ["domestic flight", "uk flight", "internal flight"] },
  { subtype: "rail", keywords: ["rail", "train", "underground", "tube", "metro", "tram", "eurostar"] },
];

/** Recognised but intentionally not Category 6 — grey fleet belongs to Scope 1 (S1-04). */
const GREY_FLEET_KEYWORDS = ["mileage", "car mileage", "own car", "private car", "personal car", "motorbike mileage"];

/** Generic "flight/air" fallback, only consulted after the haul-specific rules miss. */
const GENERIC_FLIGHT_KEYWORDS = ["flight", "airfare", "air travel", "aeroplane", "airplane", "plane"];

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[_\-/]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export interface RawSheet {
  headers: string[];
  rows: string[][];
}

/** Small, correct CSV parser — quoted fields, embedded commas/newlines, escaped quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export async function parseExpenseInFile(buffer: ArrayBuffer, filename: string): Promise<RawSheet> {
  const lower = filename.toLowerCase();
  let grid: string[][];

  if (lower.endsWith(".csv")) {
    grid = parseCsv(new TextDecoder("utf-8").decode(buffer));
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };
    grid = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        // Dates arrive as Date objects from xlsx; normalise to ISO so the
        // downstream date parser sees one shape regardless of container.
        const v = cell.value;
        if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
        else cells.push(cell.text ?? "");
      });
      grid.push(cells);
    });
    grid = grid.filter((r) => r.some((c) => c.trim() !== ""));
  } else {
    throw new Error(`Unsupported file type: "${filename}" — export from ExpenseIn as .csv or .xlsx.`);
  }

  if (grid.length === 0) return { headers: [], rows: [] };
  return { headers: grid[0].map((h) => h.trim()), rows: grid.slice(1) };
}

export type ColumnMapping = Record<ColumnRole, number | null>;

/** Best-guess column mapping; every field stays overridable by the importer. */
export function autoDetectColumns(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = { date: null, category: null, quantity: null, description: null };

  for (const role of Object.keys(COLUMN_ALIASES) as ColumnRole[]) {
    const aliases = COLUMN_ALIASES[role];
    // Exact alias match first, then a contains-match, so "Expense Date (UTC)"
    // still resolves without matching every column containing "date".
    let index = normalized.findIndex((h) => aliases.includes(h));
    if (index === -1) index = normalized.findIndex((h) => aliases.some((a) => h.includes(a)));
    mapping[role] = index === -1 ? null : index;
  }
  return mapping;
}

export interface ClassifiedSubtype {
  subtype: TravelSubtype | null;
  /** Set when the row is recognised but deliberately out of scope for Cat 6. */
  skipReason: string | null;
}

export function classifyTravelSubtype(categoryText: string, descriptionText = ""): ClassifiedSubtype {
  const haystack = `${categoryText} ${descriptionText}`.toLowerCase();

  if (GREY_FLEET_KEYWORDS.some((k) => haystack.includes(k)) && !haystack.includes("rail") && !haystack.includes("train")) {
    return {
      subtype: null,
      skipReason:
        "Looks like a car-mileage claim — that's grey fleet (Scope 1, row S1-04), not Category 6 business travel. Enter it under 'Grey fleet / mileage-based vehicles'.",
    };
  }

  for (const rule of SUBTYPE_RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) return { subtype: rule.subtype, skipReason: null };
  }

  if (GENERIC_FLIGHT_KEYWORDS.some((k) => haystack.includes(k))) {
    return {
      subtype: null,
      skipReason:
        "Recognised as a flight, but not which haul band (domestic / short-haul / long-haul) — these have very different emission factors, so it isn't guessed. Re-label the ExpenseIn category, or enter it manually.",
    };
  }

  return { subtype: null, skipReason: `No business-travel type matched the category "${categoryText || "(blank)"}".` };
}

/** Handles ISO, UK (dd/mm/yyyy) and US-ish (yyyy/mm/dd) shapes. Returns null if unparseable. */
export function parseFlexibleDate(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  // ExpenseIn is a UK product — day-first is the correct reading here.
  const uk = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(value);
  if (uk) {
    const day = Number(uk[1]);
    const month = Number(uk[2]);
    let year = Number(uk[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

/** Strips thousands separators and stray currency/unit text before parsing. */
export function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/[a-zA-Z]+$/, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface PreparedRow {
  rowNumber: number;
  date: Date;
  periodStart: Date;
  periodEnd: Date;
  subtype: TravelSubtype;
  /** Already converted into the subtype's own unit (km or nights). */
  value: number;
  unit: "km" | "nights";
  categoryText: string;
  descriptionText: string;
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
  categoryText: string;
}

export interface PrepareResult {
  prepared: PreparedRow[];
  skipped: SkippedRow[];
  /** Blocking problems — the mapping itself is unusable. */
  fatalError: string | null;
}

export interface PrepareOptions {
  mapping: ColumnMapping;
  /** How to read the quantity column for distance-based rows. Hotel rows are always nights. */
  distanceUnit: "miles" | "km";
}

function monthBounds(d: Date): { periodStart: Date; periodEnd: Date } {
  return {
    periodStart: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)),
  };
}

/**
 * Turns the raw sheet into rows ready for createActivityEntryWithCalculations,
 * or a per-row reason why not. Nothing is written here — this is the
 * preview step, so the importer sees exactly what will land before it does.
 */
export function prepareExpenseInRows(sheet: RawSheet, options: PrepareOptions): PrepareResult {
  const { mapping, distanceUnit } = options;

  if (mapping.date === null) return { prepared: [], skipped: [], fatalError: "No expense-date column selected." };
  if (mapping.category === null) return { prepared: [], skipped: [], fatalError: "No category column selected." };
  if (mapping.quantity === null) {
    return {
      prepared: [],
      skipped: [],
      fatalError:
        "No distance/nights column selected. Business-travel emissions are calculated from distance travelled and nights stayed — a money amount can't be used for Category 6 here.",
    };
  }

  const prepared: PreparedRow[] = [];
  const skipped: SkippedRow[] = [];

  sheet.rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 for the header row, +1 for 1-based numbering
    const categoryText = (row[mapping.category!] ?? "").trim();
    const descriptionText = mapping.description !== null ? (row[mapping.description] ?? "").trim() : "";

    const date = parseFlexibleDate(row[mapping.date!] ?? "");
    if (!date) {
      skipped.push({ rowNumber, reason: `Couldn't read a date from "${row[mapping.date!] ?? ""}".`, categoryText });
      return;
    }

    const { subtype, skipReason } = classifyTravelSubtype(categoryText, descriptionText);
    if (!subtype) {
      skipped.push({ rowNumber, reason: skipReason ?? "Unrecognised travel type.", categoryText });
      return;
    }

    const rawQuantity = parseNumber(row[mapping.quantity!] ?? "");
    if (rawQuantity === null) {
      skipped.push({ rowNumber, reason: `Couldn't read a number from "${row[mapping.quantity!] ?? ""}".`, categoryText });
      return;
    }
    if (rawQuantity <= 0) {
      skipped.push({ rowNumber, reason: `Quantity is ${rawQuantity} — nothing to calculate.`, categoryText });
      return;
    }

    const unit = TRAVEL_SUBTYPE_UNITS[subtype];
    const value = unit === "km" && distanceUnit === "miles" ? rawQuantity * MILES_TO_KM : rawQuantity;
    const { periodStart, periodEnd } = monthBounds(date);

    prepared.push({ rowNumber, date, periodStart, periodEnd, subtype, value, unit, categoryText, descriptionText });
  });

  return { prepared, skipped, fatalError: null };
}

export interface AggregatedRow {
  periodStart: Date;
  periodEnd: Date;
  subtype: TravelSubtype;
  unit: "km" | "nights";
  value: number;
  rowCount: number;
}

/**
 * One ActivityEntry per (month, travel type) rather than per expense line —
 * matching how S3-06 is entered by hand, and keeping the audit trail
 * readable when a month has hundreds of claims. The contributing row count
 * is carried through so it can be recorded in the entry's notes.
 */
export function aggregateRows(rows: PreparedRow[]): AggregatedRow[] {
  const map = new Map<string, AggregatedRow>();
  for (const r of rows) {
    const key = `${r.periodStart.toISOString()}|${r.subtype}`;
    const existing = map.get(key);
    if (existing) {
      existing.value += r.value;
      existing.rowCount += 1;
    } else {
      map.set(key, {
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        subtype: r.subtype,
        unit: r.unit,
        value: r.value,
        rowCount: 1,
      });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime() || a.subtype.localeCompare(b.subtype),
  );
}
