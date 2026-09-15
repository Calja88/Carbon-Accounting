import { createHash } from "node:crypto";
import { BOARD1 } from "./board1";
/** Actual UTF-8 bytes, not fake hashes or empty blobs. Convert to PDF only if a real file is generated. */
export function buildSyntheticEvidence() {
  const records = [
    ["invoice", "Synthetic energy invoice", "Period: January 2026. Fictional metered energy transaction for fixture reconciliation."],
    ["meter-reading", "Synthetic meter reading", "A fictional observation used to trace a demo activity entry."],
    ["inspection", "Containment inspection checklist", "Checks: containment clear; condition recorded; inspection owner named. DEM-CTL-002 revision 2."],
    ["procedure", "Containment inspection procedure revision 2", "Demo Site Manager performs monthly checks and records condition, owner and review evidence."],
    ["evaluation", "Internal requirement evaluation note", "DEM-OBL-004 revision 2. Review the supplied inspection records. This is a fictional internal requirement, not legal advice."],
    ["audit-observation", "Synthetic audit observation", "DEM-FND-006: inspection ownership is not consistently recorded in the fictional sample."],
    ["completion", "Corrective action completion note", "A named owner and inspection schedule have been recorded for the demonstration action. Independent effectiveness review remains required."],
    ["effectiveness", "Effectiveness review evidence", "Criteria: repeat inspection has a named owner, a recorded condition and retained checklist. This file is synthetic evidence; a separate authorised demo reviewer records the outcome."],
  ];
  return records.map(([key, title, body]) => {
    const bytes = Buffer.from(`${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\n${title}\n\n${body}\nNo real person, signature, certificate or company result is represented.\n`, "utf8");
    return { key, name: `BOARD-1-${key}.txt`, mime: "text/plain", bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
}
