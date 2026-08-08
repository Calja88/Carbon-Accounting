/**
 * Shared CSV reading and writing.
 *
 * Extracted from the emission-factor and ExpenseIn importers, which had grown
 * identical copies of the same parser. A CSV parser is the wrong thing to have
 * two of: a fix to quote handling in one copy silently leaves the other
 * mis-reading a notes field, and both feed emission figures.
 *
 * Handles quoted fields, embedded commas and newlines, and doubled quotes.
 */

/** Parses CSV text into rows of raw cell strings, dropping blank lines. */
export function parseCsv(text: string): string[][] {
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

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Quotes a value only where it needs it, doubling any embedded quotes. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** One CSV line, newline included. */
export function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map((v) => csvEscape(v === null || v === undefined ? "" : String(v))).join(",") + "\n";
}

/** A whole CSV document from a header row and body rows. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return csvRow(header) + rows.map(csvRow).join("");
}

/** Header text -> a comparable key: lowercased, punctuation collapsed. */
export function normalizeHeaderKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
