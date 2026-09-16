/**
 * The BOARD demo's real operating-site identities over synthetic data.
 *
 * Asserted against the fixture and the alignment rules themselves — no
 * database — so a change that would put the old synthetic names back, make a
 * site's source configuration implausible, or make the alignment non-idempotent
 * fails here rather than on the demo screen. The live database figures are
 * verified separately by `scripts/board-demo/verify-collection-plan.ts`.
 */
import { describe, expect, it } from "vitest";
import { BOARD1, SOURCE_DOCUMENTS, buildCarbonTargets, buildSubmissionObligations, sourceDocumentBody } from "../../scripts/board-demo/board1";
import { COLLECTION_PLAN } from "../../scripts/board-demo/collection-plan-fixture";
import { applyLegacyRenames } from "../../scripts/board-demo/site-identity-fixture";

const HULL = "Paragon ID — Hull";
const RAYLEIGH = "Thames Technology — Rayleigh";
const MILTON_KEYNES = "RFID Discovery — Milton Keynes";

/** Every superseded synthetic identity, in the wording the demo used to carry. */
const RETIRED_NAMES = ["North Works", "East Cards", "Central Digital", "Northstar Identification"];

describe("the demo's site identities", () => {
  it("names the three real operating sites", () => {
    expect(BOARD1.sites.map((site) => site.name)).toEqual([HULL, RAYLEIGH, MILTON_KEYNES]);
  });

  it("keeps the fixture keys that every persisted reference is anchored to", () => {
    // Renaming must not move an id: the keys drive the identity map, the
    // per-source external keys and the seed's own site lookups.
    expect(BOARD1.sites.map((site) => site.key)).toEqual(["north-works", "east-cards", "central-digital"]);
    const externalKeys = buildSubmissionObligations().map((obligation) => obligation.externalKey);
    expect(externalKeys).toContain("BOARD-1:north-works:2026-01:gas");
    expect(new Set(externalKeys).size).toBe(384);
  });

  it("no longer presents any of the retired synthetic names", () => {
    const presented = [
      BOARD1.organisation,
      ...BOARD1.sites.flatMap((site) => [site.name, site.activity]),
      ...COLLECTION_PLAN.map((row) => row.site),
    ].join("\n");
    for (const retired of RETIRED_NAMES) expect(presented).not.toContain(retired);
  });
});

describe("the demo's group identity", () => {
  it("uses the presentation identity", () => {
    expect(BOARD1.organisation).toBe("Paragon ID UK — DEMONSTRATION");
  });

  it("still declares itself a demonstration, so real names cannot read as live production", () => {
    expect(BOARD1.organisation).toContain("DEMONSTRATION");
    expect(BOARD1.disclosure).toBe("Synthetic demonstration — not company performance");
  });
});

describe("source configuration stays plausible for what each site actually does", () => {
  const sourcesFor = (site: string) =>
    COLLECTION_PLAN.filter((row) => row.site === site).map((row) => row.sourceCode).sort();

  it("collects from exactly the three real sites, and nothing else", () => {
    expect(new Set(COLLECTION_PLAN.map((row) => row.site))).toEqual(new Set([HULL, RAYLEIGH, MILTON_KEYNES]));
    expect(COLLECTION_PLAN).toHaveLength(8);
  });

  it("gives the Hull manufacturing site its gas, electricity, fleet and substrate", () => {
    expect(sourcesFor(HULL)).toEqual([
      "BOARD1-board1_purchased_goods",
      "BOARD1-grid_electricity",
      "BOARD1-mobile_combustion_fuel",
      "BOARD1-stationary_combustion_natural_gas",
    ]);
  });

  it("gives the Rayleigh metal-card site its gas and electricity", () => {
    expect(sourcesFor(RAYLEIGH)).toEqual(["BOARD1-grid_electricity", "BOARD1-stationary_combustion_natural_gas"]);
  });

  it("leaves the Milton Keynes office-only operation with electricity and travel", () => {
    expect(sourcesFor(MILTON_KEYNES)).toEqual(["BOARD1-board1_business_travel", "BOARD1-grid_electricity"]);
  });

  it("never gives the office-only SaaS site a manufacturing source", () => {
    // RFID Discovery is an office. Combustion, fleet fuel or substrate there
    // would be a fabricated operation, not a naming change.
    const manufacturing = ["BOARD1-stationary_combustion_natural_gas", "BOARD1-mobile_combustion_fuel", "BOARD1-board1_purchased_goods"];
    for (const code of manufacturing) expect(sourcesFor(MILTON_KEYNES)).not.toContain(code);
    expect(BOARD1.sites.find((site) => site.key === "central-digital")!.scope1Share).toBe(0);
  });

  it("collects travel quarterly, so the non-monthly cadence is still exercised", () => {
    const quarterly = COLLECTION_PLAN.filter((row) => row.frequency === "QUARTERLY");
    expect(quarterly).toEqual([{ site: MILTON_KEYNES, sourceCode: "BOARD1-board1_business_travel", frequency: "QUARTERLY" }]);
  });
});

describe("the accounting story is untouched by the rename", () => {
  it("still produces 384 obligations and the agreed group totals", () => {
    expect(buildSubmissionObligations()).toHaveLength(384);
    expect(BOARD1.currentKg).toBe(1248000);
    expect(BOARD1.previousKg).toBe(1560000);
    expect(BOARD1.marketBasedScope2Kg).toBe(216000);
  });

  it("keeps every site's scope shares, so the site breakdown adds up exactly as before", () => {
    const sum = (pick: (site: (typeof BOARD1.sites)[number]) => number) =>
      BOARD1.sites.reduce((total, site) => total + pick(site), 0);
    expect(sum((site) => site.scope1Share)).toBeCloseTo(1, 12);
    expect(sum((site) => site.scope2Share)).toBeCloseTo(1, 12);
    expect(sum((site) => site.scope3Share)).toBeCloseTo(1, 12);

    const targets = buildCarbonTargets();
    expect(targets).toHaveLength(48); // 2 years x 8 months x 3 sites
    const current2026 = targets
      .filter((target) => target.year === 2026)
      .reduce((total, target) => total + target.totalKg, 0);
    expect(current2026).toBeCloseTo(BOARD1.currentKg, 6);
  });
});

describe("the synthetic source documents", () => {
  // Their bytes are content-addressed and re-derived by verifyAllInvariants, so
  // a site name that reached the fixture but not these would fail the replay.
  it("name the site they document, from the fixture rather than a second literal", () => {
    expect(sourceDocumentBody("invoice", "37500", "kWh")).toContain(`Site: ${HULL}.`);
    expect(sourceDocumentBody("meter", "15000", "kWh")).toContain(`Site: ${RAYLEIGH}.`);
  });

  it("are pinned to the sites whose electricity they evidence", () => {
    expect(SOURCE_DOCUMENTS.invoice.siteKey).toBe("north-works");
    expect(SOURCE_DOCUMENTS.meter.siteKey).toBe("east-cards");
  });

  it("keep their synthetic disclosure and carry no retired name", () => {
    for (const body of [sourceDocumentBody("invoice", "37500", "kWh"), sourceDocumentBody("meter", "15000", "kWh")]) {
      expect(body).toContain(BOARD1.disclosure);
      expect(body).toContain("No real person, signature, certificate or company result is represented.");
      for (const retired of RETIRED_NAMES) expect(body).not.toContain(retired);
    }
  });
});

describe("the alignment rules", () => {
  it("rewrites every retired name to its real site identity", () => {
    expect(applyLegacyRenames("North Works materials handling")).toBe(`${HULL} materials handling`);
    expect(applyLegacyRenames("A second, distinct containment gap (East Cards) surfaced after closure."))
      .toBe(`A second, distinct containment gap (${RAYLEIGH}) surfaced after closure.`);
    expect(applyLegacyRenames("Central Digital is an office")).toBe(`${MILTON_KEYNES} is an office`);
  });

  it("resolves the group name before the bare one, so neither is mangled", () => {
    expect(applyLegacyRenames("Northstar Identification — DEMONSTRATION")).toBe(BOARD1.organisation);
    expect(applyLegacyRenames("Northstar internal policy (fictional, not a statutory obligation)"))
      .toBe("Paragon ID UK internal policy (fictional, not a statutory obligation)");
  });

  it("is idempotent — a second run finds nothing left to rewrite", () => {
    const samples = [
      "North Works materials handling",
      "The corrective action only covered North Works; East Cards needs the same named ownership.",
      "Northstar Identification — DEMONSTRATION",
      "Northstar internal policy (fictional, not a statutory obligation)",
      "Central Digital",
    ];
    for (const sample of samples) {
      const once = applyLegacyRenames(sample);
      expect(applyLegacyRenames(once)).toBe(once);
      for (const retired of RETIRED_NAMES) expect(once).not.toContain(retired);
    }
  });

  it("leaves text that never mentioned a site alone", () => {
    const untouched = "Synthetic demonstration — not company performance";
    expect(applyLegacyRenames(untouched)).toBe(untouched);
  });
});
