/**
 * The checked-in sample file exists so the Phase 3-ii preview UI can be
 * exercised in a browser before the official workbook arrives. It is
 * documented as producing one row of each kind, so that claim is asserted
 * here — otherwise a later change to the normaliser would quietly turn the
 * sample into something that no longer demonstrates what the doc says.
 *
 * It is synthetic. The values are not official conversion factors.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUkGovFactors } from "../parse-uk-gov-factors";
import { validateFactorImport } from "../validate-factor-import";

const FIXTURE = "scripts/factors/synthetic-preview-sample.csv";

describe("synthetic preview sample", () => {
  it("previews as one row of every kind, and still cannot be committed", async () => {
    const parsed = await parseUkGovFactors(readFileSync(FIXTURE), "synthetic-preview-sample.csv");
    const preview = validateFactorImport(parsed);

    expect(preview.counts).toMatchObject({ accepted: 3, warning: 1, rejected: 2, duplicate: 1 });
    expect(preview.totalRowsScanned).toBe(8);
    expect(preview.metadata).toEqual({ publisher: "Synthetic fixture (not official)", year: 2026, release: "sample-v1" });

    expect(preview.warningRows[0].messages.map((m) => m.code).sort())
      .toEqual(["MAPPING_REQUIRED", "MISSING_REGION"]);
    expect(preview.rejectedRows.flatMap((r) => r.messages.map((m) => m.code)))
      .toEqual(expect.arrayContaining(["UNKNOWN_UNIT", "MISSING_VALUE"]));
    expect(preview.duplicateRows[0].messages[0].code).toBe("DUPLICATE_WITHIN_FILE");

    // A file that parses is still never an authorisation to write.
    expect(preview.commitAllowed).toBe(false);
    expect(preview.validationPassed).toBe(false);
  });
});
