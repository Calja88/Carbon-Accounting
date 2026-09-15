/**
 * Proves the demonstration product footprint is a genuine output of the
 * unmodified LCA engine, not a number written into a page.
 *
 * Pure: no Prisma, no database, no mocks of the engine. It drives
 * `calculateAssessment` over the same bill of materials the seed writes, and
 * asserts the things a presenter will actually say out loud — the headline,
 * its denominator, the stage split reconciling to the total, the hotspot
 * order, the contribution percentages, and the scenario saving with the
 * baseline left alone.
 */
import { describe, expect, it } from "vitest";
import { LcaItemType, LcaLifecycleStage } from "@prisma/client";
import { calculateAssessment } from "@/lib/lca/engine/engine";
import { analyseContributions, compareScenario } from "@/lib/lca/analysis";
import { engineRowsToAnalysisRows } from "@/lib/lca/calculation-service";
import {
  BATCH_CARDS,
  BOM,
  DEMO_FACTORS,
  FUNCTIONAL_UNIT_CARDS,
  SCENARIO_CHANGES,
  STAGES,
  bomCsv,
  buildEngineAssessment,
  demoFactor,
} from "./lca-demo-fixture";

/** Every line's expected contribution across the batch, computed independently of the engine. */
const EXPECTED_LINE_KGCO2E: Record<string, number> = {
  "PVC card body core": 235 * 3.1,
  "PET-G overlay laminate": 34 * 2.9,
  "Offset litho ink and varnish": 9.5 * 3.4,
  "Contactless chip module": 11 * 45,
  "Aluminium etched antenna": 5.2 * 12,
  "Hot-melt laminating adhesive": 3.6 * 2.6,
  // Freight work is mass in tonnes x distance in km, then x the t.km factor.
  "Inbound freight — chip modules and antennae": 0.0162 * 19400 * 0.016 + 0.0162 * 320 * 0.107,
  "Inbound freight — card substrate and overlay": 0.269 * 780 * 0.107,
  "Site electricity — printing, lamination, punching, personalisation": 3150 * 0.207,
  "Site electricity — upstream losses": 3150 * 0.045,
  "Natural gas — lamination press heating": 1240 * 0.183,
  "Production scrap to energy recovery": 21 * 0.9,
  "Carton board — card carriers and outer cases": 62 * 0.8,
  "LDPE shrink film and pallet wrap": 19 * 2.1,
  "Outbound freight — finished cards to customer": 0.381 * 410 * 0.107,
};

const EXPECTED_MODEL_TOTAL = Object.values(EXPECTED_LINE_KGCO2E).reduce((sum, value) => sum + value, 0);
const FUNCTIONAL_UNITS_IN_MODEL = BATCH_CARDS / FUNCTIONAL_UNIT_CARDS;

function contributionsFor(variant: "baseline" | "scenario") {
  const output = calculateAssessment(buildEngineAssessment(variant));
  return {
    output,
    contributions: analyseContributions(engineRowsToAnalysisRows(output)),
    byLine: totalsByLine(output),
  };
}

/**
 * Sums result rows back onto the inventory line they came from. A multi-leg
 * freight line produces one row per leg, each carrying the same
 * `inventoryItemId`, so this is how a line total is read.
 */
function totalsByLine(output: ReturnType<typeof calculateAssessment>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of output.rows) {
    const index = Number((row.inventoryItemId ?? "").replace("item-", ""));
    const name = BOM[index]?.name;
    if (!name) throw new Error("A result row did not map back to an inventory line: " + row.itemName);
    totals.set(name, (totals.get(name) ?? 0) + row.allocatedKgCo2e.toNumber());
  }
  return totals;
}

describe("demo fixture specification", () => {
  it("has enough inventory for the demo without being unreadable", () => {
    expect(BOM.length).toBeGreaterThanOrEqual(8);
    expect(BOM.length).toBeLessThanOrEqual(15);
    expect(new Set(BOM.map((line) => line.name)).size).toBe(BOM.length);
  });

  it("covers five lifecycle stages, each with at least one line", () => {
    expect(STAGES).toHaveLength(5);
    for (const stage of STAGES) {
      expect(BOM.filter((line) => line.stage === stage.key).length).toBeGreaterThan(0);
    }
  });

  it("gives every line either a factor or transport legs, and never both", () => {
    for (const line of BOM) {
      const isTransport = line.itemType === LcaItemType.TRANSPORT;
      expect(Boolean(line.factorKey)).toBe(!isTransport);
      expect((line.legs ?? []).length > 0).toBe(isTransport);
      for (const leg of line.legs ?? []) expect(() => demoFactor(leg.factorKey)).not.toThrow();
      if (line.factorKey) expect(() => demoFactor(line.factorKey as string)).not.toThrow();
    }
  });

  it("keeps every factor key unique and every factor carrying its provenance", () => {
    expect(new Set(DEMO_FACTORS.map((f) => f.key)).size).toBe(DEMO_FACTORS.length);
    expect(new Set(DEMO_FACTORS.map((f) => `${f.category}/${f.subtypeKey}`)).size).toBe(DEMO_FACTORS.length);
    for (const factor of DEMO_FACTORS) {
      expect(factor.region).toBeTruthy();
      expect(factor.referenceYear).toBeGreaterThan(2000);
      expect(factor.dataSource).toMatch(/Illustrative/);
    }
  });

  it("produces a downloadable bill of materials that names itself as synthetic", () => {
    const csv = bomCsv().toString("utf8");
    expect(csv).toContain("SYNTHETIC DEMONSTRATION BILL OF MATERIALS");
    // Header line, two comment lines and one row per inventory line.
    expect(csv.trim().split("\n")).toHaveLength(BOM.length + 3);
    for (const line of BOM) expect(csv).toContain(line.name);
  });
});

describe("baseline calculation (real engine)", () => {
  const { output, contributions, byLine } = contributionsFor("baseline");

  it("calculates every inventory line as quantity x factor", () => {
    expect([...byLine.keys()].sort()).toEqual(Object.keys(EXPECTED_LINE_KGCO2E).sort());
    for (const [name, expected] of Object.entries(EXPECTED_LINE_KGCO2E)) {
      expect(byLine.get(name), `no result for "${name}"`).toBeCloseTo(expected, 6);
    }
  });

  it("produces one result row per line, plus one per extra freight leg", () => {
    const legCount = BOM.reduce((sum, line) => sum + Math.max(0, (line.legs ?? []).length - 1), 0);
    expect(output.rows).toHaveLength(BOM.length + legCount);
    expect(output.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("aggregates to the expected model total", () => {
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(EXPECTED_MODEL_TOTAL, 6);
  });

  it("resolves the functional unit and divides by it", () => {
    expect(output.totals.functionalUnitResolved).toBe(true);
    expect(output.totals.functionalUnitsInModel.toNumber()).toBe(FUNCTIONAL_UNITS_IN_MODEL);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBeCloseTo(
      EXPECTED_MODEL_TOTAL / FUNCTIONAL_UNITS_IN_MODEL,
      6,
    );
  });

  it("reconciles the lifecycle-stage split back to the overall result", () => {
    const stageTotal = contributions.byStage.reduce((sum, stage) => sum + stage.kgCo2e, 0);
    expect(stageTotal).toBeCloseTo(EXPECTED_MODEL_TOTAL, 6);
    expect(contributions.byStage.reduce((sum, stage) => sum + stage.percent, 0)).toBeCloseTo(100, 6);

    const expectedByStage = new Map<LcaLifecycleStage, number>();
    for (const line of BOM) {
      const stage = STAGES.find((s) => s.key === line.stage)?.stage as LcaLifecycleStage;
      expectedByStage.set(stage, (expectedByStage.get(stage) ?? 0) + EXPECTED_LINE_KGCO2E[line.name]);
    }
    for (const [stage, expected] of expectedByStage) {
      expect(contributions.byStage.find((c) => c.key === stage)?.kgCo2e).toBeCloseTo(expected, 6);
    }
  });

  it("orders the hotspots largest first and reconciles their percentages", () => {
    const top5 = contributions.hotspots.slice(0, 5);
    const expectedOrder = Object.entries(EXPECTED_LINE_KGCO2E)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    expect(top5.map((h) => h.label)).toEqual(expectedOrder);

    for (const hotspot of top5) {
      expect(hotspot.percent).toBeCloseTo((hotspot.kgCo2e / EXPECTED_MODEL_TOTAL) * 100, 6);
      // Every hotspot must name the stage it sits in, or it cannot be acted on.
      expect(hotspot.sublabel).toBeTruthy();
    }
    expect(contributions.byItem.reduce((sum, item) => sum + item.percent, 0)).toBeCloseTo(100, 6);
  });

  it("reads every breakdown against the same footprint, so one page has one meaning of %", () => {
    // Suppliers partition the whole inventory (with an explicit unattributed
    // group), so their shares add to 100%.
    expect(contributions.bySupplier.reduce((sum, c) => sum + c.percent, 0)).toBeCloseTo(100, 6);
    // Materials are a subset — energy, freight and waste are not materials —
    // so they add to less than 100%, each still a share of the whole.
    const materialPercent = contributions.byMaterial.reduce((sum, c) => sum + c.percent, 0);
    expect(materialPercent).toBeGreaterThan(0);
    expect(materialPercent).toBeLessThan(100);
    for (const material of contributions.byMaterial) {
      expect(material.percent).toBeCloseTo((material.kgCo2e / EXPECTED_MODEL_TOTAL) * 100, 6);
    }
  });

  it("carries the placeholder flag through to every result row", () => {
    expect(output.rows.every((row) => row.isPlaceholderFactor)).toBe(true);
  });
});

describe("lower-carbon scenario (real engine)", () => {
  const baseline = contributionsFor("baseline");
  const scenario = contributionsFor("scenario");

  const expectedScenarioTotal =
    EXPECTED_MODEL_TOTAL -
    (235 * 3.1 - 235 * 1.9) -
    (3150 * 0.207 - 3150 * 0.04);

  it("changes only the two lines the scenario says it changes", () => {
    const changed = SCENARIO_CHANGES.map((change) => change.lineName);
    expect([...scenario.byLine.keys()].sort()).toEqual([...baseline.byLine.keys()].sort());
    for (const [name, after] of scenario.byLine) {
      const before = baseline.byLine.get(name) as number;
      if (changed.includes(name)) expect(after).not.toBeCloseTo(before, 6);
      else expect(after).toBeCloseTo(before, 6);
    }
  });

  it("reports the saving in kgCO2e and as a percentage", () => {
    expect(scenario.output.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(expectedScenarioTotal, 6);

    const basePerFu = baseline.output.totals.headlinePerFunctionalUnitKgCo2e.toNumber();
    const scenarioPerFu = scenario.output.totals.headlinePerFunctionalUnitKgCo2e.toNumber();
    expect(basePerFu - scenarioPerFu).toBeCloseTo(
      (EXPECTED_MODEL_TOTAL - expectedScenarioTotal) / FUNCTIONAL_UNITS_IN_MODEL,
      6,
    );
    // A saving worth showing, and one that has not swallowed the whole footprint.
    const percent = ((basePerFu - scenarioPerFu) / basePerFu) * 100;
    expect(percent).toBeGreaterThan(10);
    expect(percent).toBeLessThan(60);
  });

  it("names only the changed lines as the drivers of the difference", () => {
    // A real scenario is an independent copy, so its inventory rows carry
    // their own ids. Re-id the scenario rows to reproduce that here.
    const baselineRows = engineRowsToAnalysisRows(baseline.output);
    const scenarioRows = engineRowsToAnalysisRows(scenario.output).map((row) => ({
      ...row,
      inventoryItemId: `clone-${row.inventoryItemId}`,
    }));

    const comparison = compareScenario(
      baselineRows,
      scenarioRows,
      baseline.output.totals.headlinePerFunctionalUnitKgCo2e,
      scenario.output.totals.headlinePerFunctionalUnitKgCo2e,
    );

    const moved = comparison.driversByItem.filter((d) => Math.abs(d.deltaKgCo2e) > 1e-9);
    expect(moved.map((d) => d.label).sort()).toEqual(SCENARIO_CHANGES.map((c) => c.lineName).sort());
    expect(moved.reduce((sum, d) => sum + d.deltaKgCo2e, 0)).toBeCloseTo(
      expectedScenarioTotal - EXPECTED_MODEL_TOTAL,
      6,
    );
    expect(comparison.perFunctionalUnitReduction).toBeCloseTo(
      (EXPECTED_MODEL_TOTAL - expectedScenarioTotal) / FUNCTIONAL_UNITS_IN_MODEL,
      6,
    );
    // Stage drivers must reconcile with the same change.
    const stageMoved = comparison.driversByStage.filter((d) => Math.abs(d.deltaKgCo2e) > 1e-9);
    expect(stageMoved.reduce((sum, d) => sum + d.deltaKgCo2e, 0)).toBeCloseTo(
      expectedScenarioTotal - EXPECTED_MODEL_TOTAL,
      6,
    );
  });

  it("compares on the same functional unit", () => {
    expect(scenario.output.totals.functionalUnitsInModel.toNumber()).toBe(
      baseline.output.totals.functionalUnitsInModel.toNumber(),
    );
    expect(scenario.output.totals.functionalUnitResolved).toBe(true);
  });

  it("leaves the baseline result untouched when the scenario is calculated", () => {
    const recomputed = calculateAssessment(buildEngineAssessment("baseline"));
    expect(recomputed.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(EXPECTED_MODEL_TOTAL, 6);
    expect(baseline.output.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(EXPECTED_MODEL_TOTAL, 6);
  });
});

describe("incomplete data", () => {
  it("refuses to price a line with no factor, and says so rather than counting it as zero", () => {
    const assessment = buildEngineAssessment("baseline");
    const target = assessment.items.find((item) => item.name === "Contactless chip module");
    if (!target) throw new Error("fixture changed: the chip module line is missing");
    target.factor = null;

    const output = calculateAssessment(assessment);
    expect(output.diagnostics.some((d) => d.code === "NO_FACTOR" && d.itemName === "Contactless chip module")).toBe(true);
    expect(output.rows.some((row) => row.itemName === "Contactless chip module")).toBe(false);
    expect(output.totals.headlineModelKgCo2e.toNumber()).toBeCloseTo(
      EXPECTED_MODEL_TOTAL - EXPECTED_LINE_KGCO2E["Contactless chip module"],
      6,
    );
  });

  it("cannot produce a per-functional-unit figure without a modelled output", () => {
    const assessment = buildEngineAssessment("baseline");
    assessment.functionalUnit.modelledOutputQuantity = assessment.functionalUnit.modelledOutputQuantity.times(0);

    const output = calculateAssessment(assessment);
    expect(output.totals.functionalUnitResolved).toBe(false);
    expect(output.totals.headlinePerFunctionalUnitKgCo2e.toNumber()).toBe(0);
    expect(output.totals.functionalUnitNote).toBeTruthy();
  });
});
