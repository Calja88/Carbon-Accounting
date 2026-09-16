/** Local, database-free calibration. Prints metadata and counts, never factor rows. */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseUkGovFactors } from "../../src/lib/factors/import/parse-uk-gov-factors";
import { validateFactorImport } from "../../src/lib/factors/import/validate-factor-import";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Supply the local official workbook path.");
  const preview = validateFactorImport(await parseUkGovFactors(await readFile(file), basename(file)));
  const reasons: Record<string, number> = {};
  const categories: Record<string, Record<string, number>> = {};
  for (const row of preview.candidates) {
    for (const message of row.messages) reasons[message.code] = (reasons[message.code] ?? 0) + 1;
    const category = row.source.fields.level1 ?? "(explicit tabular format)";
    const counts = categories[category] ??= {};
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    sourceFileName: preview.sourceFileName, fileHash: preview.fileHash, metadata: preview.metadata,
    sheets: preview.sheets, totalRowsScanned: preview.totalRowsScanned,
    candidates: preview.candidates.length,
    counts: { accepted: preview.counts.accepted, warning: preview.counts.warning,
      rejected: preview.counts.rejected, duplicate: preview.counts.duplicate },
    conflictRows: preview.candidates.filter((row) => row.messages.some((m) => m.code === "CONFLICT_WITHIN_FILE")).length,
    reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])),
    categories, byUnit: preview.counts.byUnit,
    importReasons: [...new Set(preview.messages.map((m) => m.code))],
    validationPassed: preview.validationPassed, commitAllowed: preview.commitAllowed,
    commitBlockedReasons: preview.commitBlockedReasons,
  }, null, 2));
}

main().catch(() => { console.error("Calibration failed. Check the local path and workbook; no import was attempted."); process.exitCode = 1; });
