import type { ExistingFactor, FactorCandidate, FactorImportPreview, ParsedFactorFile } from "./types";
import { canonicalFactorValue, factorHash, normaliseFactorRow, normaliseUnit } from "./normalise-factor-row";

function lookupKey(row: Pick<FactorCandidate, "category" | "subtypeKey" | "basis">) {
  // Match the existing schema/selector key, including null subtypes. Unit and
  // region differences at this key are conflicts, never separate safe inserts.
  return factorHash([row.category, row.subtypeKey, row.basis]);
}

function reject(row: FactorCandidate, code: string, message: string) {
  row.messages.push({ severity: "error", code, message });
  row.status = "rejected";
}

export function validateFactorImport(parsed: ParsedFactorFile, existing?: ExistingFactor[]): FactorImportPreview {
  const candidates = parsed.rows.map((row) => normaliseFactorRow(row, parsed.metadata));
  const groups = new Map<string, FactorCandidate[]>();
  for (const row of candidates) {
    const key = row.category ? lookupKey(row) : row.identity;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const contents = new Set(group.map((row) => factorHash([
      row.categoryPath, row.activity, row.canonicalUnit, row.factorValue, row.gas, row.kind, row.scope, row.region,
    ])));
    if (contents.size > 1 || group.some((row) => row.status !== "accepted")) {
      group.forEach((row) => reject(row, "CONFLICT_WITHIN_FILE", "Rows collide at the same source or factor lookup key; no row was chosen."));
    } else {
      group.slice(1).forEach((row) => {
        row.status = "duplicate";
        row.messages.push({ severity: "warning", code: "DUPLICATE_WITHIN_FILE", message: "Identical factor already proposed in this file; excluded." });
      });
    }
  }
  const existingByKey = new Map<string, ExistingFactor[]>();
  for (const row of existing ?? []) {
    const key = lookupKey(row);
    const group = existingByKey.get(key) ?? [];
    group.push(row);
    existingByKey.set(key, group);
  }
  for (const row of candidates) {
    if (!row.category || row.status === "rejected" || row.status === "warning") continue;
    const matches = existingByKey.get(lookupKey(row)) ?? [];
    if (!matches.length) continue;
    if (matches.length !== 1 || matches.some((match) =>
      canonicalFactorValue(match.co2eFactor) !== row.factorValue || normaliseUnit(match.unit) !== row.canonicalUnit ||
      match.scope !== row.scope || match.region !== row.region)) {
      reject(row, "EXISTING_FACTOR_CONFLICT", "Existing dataset has a conflicting or ambiguous factor at this lookup key; overwrite is forbidden.");
    } else {
      row.status = "duplicate";
      row.messages.push({ severity: "warning", code: "EXISTING_FACTOR_DUPLICATE", message: "Equivalent mapped factor already exists in the selected visible dataset; excluded. Legacy gas/kind provenance is unavailable." });
    }
  }
  const acceptedRows = candidates.filter((r) => r.status === "accepted");
  const warningRows = candidates.filter((r) => r.status === "warning");
  const rejectedRows = candidates.filter((r) => r.status === "rejected");
  const duplicateRows = candidates.filter((r) => r.status === "duplicate");
  const messages = [...parsed.messages];
  for (const code of ["UNSUPPORTED_GAS", "UNSUPPORTED_KIND", "UNKNOWN_UNIT", "MISSING_VALUE", "MAPPING_REQUIRED"] as const) {
    const count = candidates.filter((row) => row.messages.some((m) => m.code === code)).length;
    if (count) messages.push({ severity: "warning", code, message: `${count} candidate rows require review: ${code}. See row-level messages.` });
  }
  if (!existing) messages.push({ severity: "warning", code: "EXISTING_DATASET_NOT_CHECKED", message: "No existing dataset selected; database duplicate checks were not performed." });
  const tally = (key: (row: FactorCandidate) => string) => {
    const counts = new Map<string, number>();
    candidates.forEach((row) => counts.set(key(row), (counts.get(key(row)) ?? 0) + 1));
    return Object.fromEntries(counts);
  };
  const validationPassed = !messages.some((m) => m.severity === "error") && !rejectedRows.length && !warningRows.length && acceptedRows.length > 0;
  return {
    ...parsed, messages, candidates, acceptedRows, warningRows, rejectedRows, duplicateRows,
    counts: {
      accepted: acceptedRows.length, warning: warningRows.length, rejected: rejectedRows.length, duplicate: duplicateRows.length,
      bySheet: tally((r) => r.source.sheet), byCategory: tally((r) => r.categoryPath || "(missing)"),
      byUnit: tally((r) => r.canonicalUnit ?? (r.rawUnit || "(missing)")),
    },
    proposedFactorSet: { ...parsed.metadata, name: [parsed.metadata.publisher, parsed.metadata.year, parsed.metadata.release].filter(Boolean).join(" "), sourceType: "OFFICIAL_DEFRA_DESNZ" },
    existingDatasetChecked: existing !== undefined, validationPassed, commitAllowed: false,
    commitBlockedReasons: [
      "Factor import is preview-only: durable source provenance, gas/kind representation, dataset idempotency and platform approval must be designed before persistence.",
      ...(!validationPassed ? ["Resolve validation errors, mappings and warnings before approval."] : []),
    ],
  };
}
