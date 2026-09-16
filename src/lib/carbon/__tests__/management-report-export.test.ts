/**
 * Phase 5B — the export's tests.
 *
 * Every reconciliation below reads the *built workbook* rather than an
 * intermediate model, so what is asserted is the artefact a reader actually
 * receives. The expected figures are taken from the same `ManagementReport`
 * the page renders — `report.kpis`, `report.sites`, `report.trend` and so on —
 * so these tests fail if the export ever starts computing a figure of its own
 * instead of serialising the authoritative one.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildManagementReport, HEADLINE_BASIS, type ManagementReport } from "../management-report";
import { buildManagementReportWorkbook, managementReportFileName, NOT_REPORTED } from "../management-report-export";
import { CAT1, CAT6, input } from "./management-report-fixture";

const HEADLINE = "Headline accounting";
const COMPARISON = "Comparison with";
const COMPARISON_TOTAL = `Total (${HEADLINE_BASIS})`;

function report(overrides: Parameters<typeof input>[0] = {}): ManagementReport {
  return buildManagementReport(input(overrides));
}

function book(reportData: ManagementReport): ExcelJS.Workbook {
  return buildManagementReportWorkbook(reportData);
}

/** Every cell of a sheet as a plain value, for locating a row by its label. */
function rows(workbook: ExcelJS.Workbook, sheetName: string): unknown[][] {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) throw new Error(`No sheet named ${sheetName}`);
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    out.push(Array.from({ length: Math.max(0, values.length - 1) }, (_, i) => values[i + 1] ?? null));
  });
  return out;
}

/** The first row on a sheet whose first cell matches, for label-addressed lookups. */
function rowStartingWith(workbook: ExcelJS.Workbook, sheetName: string, label: string): unknown[] {
  const found = rows(workbook, sheetName).find((row) => row[0] === label);
  if (!found) throw new Error(`No row starting "${label}" on ${sheetName}`);
  return found;
}

/**
 * Headline and comparison share scope labels on the Summary sheet, so a row is
 * addressed within its own section rather than by first match.
 */
function sectionRow(workbook: ExcelJS.Workbook, sheetName: string, section: string, label: string): unknown[] {
  const all = rows(workbook, sheetName);
  const start = all.findIndex((row) => typeof row[0] === "string" && row[0].startsWith(section));
  if (start < 0) throw new Error(`No section "${section}" on ${sheetName}`);
  const found = all.slice(start).find((row) => row[0] === label);
  if (!found) throw new Error(`No row "${label}" under "${section}" on ${sheetName}`);
  return found;
}

const headline = (wb: ExcelJS.Workbook, label: string) => sectionRow(wb, "Summary", HEADLINE, label);
const comparison = (wb: ExcelJS.Workbook, label: string) => sectionRow(wb, "Summary", COMPARISON, label);
const textOf = (wb: ExcelJS.Workbook, sheetName: string) => rows(wb, sheetName).flat().join(" ");
const tonnes = (kg: number) => kg / 1000;

describe("the export is a serialisation of the Phase 5A report", () => {
  it("writes one sheet per section of the report page", () => {
    expect(book(report()).worksheets.map((ws) => ws.name)).toEqual([
      "Summary",
      "Sites",
      "Scope 3",
      "Sources",
      "Monthly trend",
      "Data quality & methodology",
    ]);
  });

  it("generates a real, readable workbook", async () => {
    const buffer = await book(report()).xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as ArrayBuffer);
    expect(reopened.getWorksheet("Summary")).toBeDefined();
    // The figures survive the file round-trip, not just the in-memory model.
    expect(headline(reopened, "Total emissions")[1]).toBe(8);
  });

  it("carries the report context a reader needs once the file has left the app", () => {
    const data = report();
    const wb = book(data);
    expect(rowStartingWith(wb, "Summary", "Organisation")[1]).toBe(data.organisationName);
    expect(rowStartingWith(wb, "Summary", "Reporting period")[1]).toBe(data.periodLabel);
    expect(rowStartingWith(wb, "Summary", "Comparison period")[1]).toBe(data.previousPeriodLabel);
    expect(rowStartingWith(wb, "Summary", "Reporting period status")[1]).toBe(data.periodState.label);
    expect(rowStartingWith(wb, "Summary", "Generated")[1]).toBe("2026-03-01 00:00 UTC");
    expect(rowStartingWith(wb, "Summary", "Headline basis")[1]).toBe("Scope 1 + Scope 2 (location-based) + Scope 3");
  });

  it("records the site filter when one is active, and says so when none is", () => {
    expect(rowStartingWith(book(report()), "Summary", "Site filter")[1]).toBe("All sites in your access");
    const filtered = report({ siteFilterName: "Alpha Works", selectedSiteId: "alpha" });
    expect(rowStartingWith(book(filtered), "Summary", "Site filter")[1]).toBe("Alpha Works");
  });
});

describe("headline accounting reconciles with the screen", () => {
  it("writes every KPI at the value the report model holds", () => {
    const data = report();
    const wb = book(data);
    for (const kpi of data.kpis) {
      expect(headline(wb, kpi.label)[1]).toBe(tonnes(kpi.kgCo2e!));
    }
    // And those are the Phase 5A figures, not a recomputation.
    expect(headline(wb, "Total emissions")[1]).toBe(8);
    expect(headline(wb, "Scope 1 — direct")[1]).toBe(1.5);
    expect(headline(wb, "Scope 3 — value chain")[1]).toBe(4);
  });

  it("reconciles Scope 2 location-based and market-based independently", () => {
    const wb = book(report());
    expect(headline(wb, "Scope 2 — location-based")[1]).toBe(2.5);
    expect(headline(wb, "Scope 2 — market-based")[1]).toBe(1.9);
  });

  it("marks market-based as a companion so it can never be added to the total", () => {
    const wb = book(report());
    expect(headline(wb, "Scope 2 — market-based")[2]).toBe("No — companion view");
    expect(headline(wb, "Scope 2 — location-based")[2]).toBe("Yes");
    expect(headline(wb, "Total emissions")[2]).toBe("Headline total");
  });

  it("never double-counts Scope 2: the in-headline lines sum to the headline total", () => {
    const data = report();
    const wb = book(data);
    const total = headline(wb, "Total emissions")[1] as number;
    const addends = data.kpis
      .filter((kpi) => kpi.inHeadline && kpi.key !== "total")
      .map((kpi) => headline(wb, kpi.label)[1] as number);
    expect(addends).toHaveLength(3);
    expect(addends.reduce((sum, value) => sum + value, 0)).toBe(total);
    // Adding the market-based companion would overstate the inventory, which
    // is precisely why it is excluded from that sum.
    expect(total + (headline(wb, "Scope 2 — market-based")[1] as number)).not.toBe(total);
  });

  it("writes an absent market-based figure as words, never as zero", () => {
    const wb = book(report({ marketBasedAvailable: false }));
    expect(headline(wb, "Scope 2 — market-based")[1]).toBe(NOT_REPORTED);
  });
});

describe("site breakdown reconciles", () => {
  it("writes every site at the report model's own figures", () => {
    const data = report();
    const wb = book(data);
    for (const site of data.sites) {
      const row = rowStartingWith(wb, "Sites", site.siteName);
      expect(row[2]).toBe(tonnes(site.scope1));
      expect(row[3]).toBe(tonnes(site.scope2Location));
      expect(row[4]).toBe(tonnes(site.scope3));
      expect(row[5]).toBe(tonnes(site.total));
      expect(row[6]).toBe(site.sharePercent);
      expect(row[9]).toBe(site.periodState.label);
    }
  });

  it("sums the site totals back to the headline", () => {
    const data = report();
    const wb = book(data);
    const total = data.sites.reduce((sum, site) => sum + (rowStartingWith(wb, "Sites", site.siteName)[5] as number), 0);
    expect(total).toBe(headline(wb, "Total emissions")[1]);
  });

  it("keeps the market-based companion out of the site grid entirely", () => {
    const header = rows(book(report()), "Sites")[0].join(" | ");
    expect(header).toContain("Scope 2 location-based (tCO₂e)");
    expect(header).not.toContain("market");
  });
});

describe("Scope 3 breakdown reconciles and stays honest", () => {
  it("writes each modelled category at the report model's figure and state", () => {
    const data = report();
    const quantified = data.scope3Categories.find((c) => c.category === CAT1)!;
    const row = rowStartingWith(book(data), "Scope 3", CAT1);
    expect(row[1]).toBe(tonnes(quantified.kgCo2e!));
    expect(row[2]).toBe(quantified.sharePercent);
    expect(row[3]).toBe("Quantified");
  });

  it("writes a category with no data as words and a state, never as a zero", () => {
    const row = rowStartingWith(book(report()), "Scope 3", CAT6);
    expect(row[1]).toBe(NOT_REPORTED);
    expect(row[1]).not.toBe(0);
    expect(row[3]).toBe("No data this period");
  });

  it("keeps a genuine zero distinguishable from no data", () => {
    const row = rowStartingWith(book(report({ scope3Totals: { [CAT1]: 4000, [CAT6]: 0 } })), "Scope 3", CAT6);
    expect(row[1]).toBe(0);
    expect(row[3]).toBe("Genuine zero");
  });

  it("names the unassessed categories rather than omitting them into an implied zero", () => {
    const data = report();
    expect(data.scope3NotAssessed).toBe(13);
    expect(textOf(book(data), "Scope 3")).toContain("13 further GHG Protocol Scope 3 categories are not assessed.");
  });
});

describe("major sources reconcile", () => {
  it("writes the ranked sources at the report model's figures, in its order", () => {
    const data = report();
    const sheet = rows(book(data), "Sources").slice(1, 1 + data.topSources.length);
    expect(sheet.map((row) => row[1])).toEqual(data.topSources.map((source) => source.category));
    data.topSources.forEach((source, index) => {
      expect(sheet[index][2]).toBe(source.scopeLabel);
      expect(sheet[index][3]).toBe(source.siteName);
      expect(sheet[index][4]).toBe(tonnes(source.kgCo2e));
      expect(sheet[index][5]).toBe(source.sharePercent);
    });
  });
});

describe("monthly trend reconciles and keeps gaps visible", () => {
  it("writes each reported month at the report model's figures", () => {
    const data = report();
    const wb = book(data);
    for (const month of data.trend) {
      const row = rowStartingWith(wb, "Monthly trend", month.label);
      expect(row[1]).toBe(tonnes(month.scope1!));
      expect(row[2]).toBe(tonnes(month.scope2Location!));
      expect(row[3]).toBe(tonnes(month.scope3!));
      expect(row[4]).toBe(tonnes(month.totalKg!));
      expect(row[5]).toBe("Reported");
    }
  });

  it("never silently turns a month with no data into zero", () => {
    // February received nothing; the analytics snapshot still seeds the month.
    const wb = book(report({ monthsWithData: ["2026-01"] }));
    const february = rowStartingWith(wb, "Monthly trend", "Feb 26");
    expect(february[4]).toBe(NOT_REPORTED);
    expect(february[4]).not.toBe(0);
    expect(february[5]).toBe(NOT_REPORTED);
    expect(textOf(wb, "Monthly trend")).toContain("1 month(s) received no activity data");
  });

  it("still writes a genuinely zero month as zero", () => {
    // Both months reported; February's emissions really do come to zero.
    const wb = book(
      report({
        monthly: [
          { month: "2026-01", label: "Jan 26", scope1: 1500, scope2Location: 2500, scope3: 4000, total: 8000 },
          { month: "2026-02", label: "Feb 26", scope1: 0, scope2Location: 0, scope3: 0, total: 0 },
        ],
      }),
    );
    const february = rowStartingWith(wb, "Monthly trend", "Feb 26");
    expect(february[4]).toBe(0);
    expect(february[5]).toBe("Reported");
    expect(textOf(wb, "Monthly trend")).not.toContain("received no activity data");
  });
});

describe("comparison period stays honest in the file", () => {
  it("writes a valid comparison at the report model's own delta", () => {
    const data = report();
    const wb = book(data);
    const total = data.comparison.find((row) => row.key === "total")!;
    const row = comparison(wb, COMPARISON_TOTAL);
    expect(row[1]).toBe(tonnes(total.currentKg!));
    expect(row[2]).toBe(tonnes(total.previousKg!));
    expect(row[3]).toBe(tonnes(total.delta!.deltaKg));
    expect(row[4]).toBe(total.delta!.deltaPercent);
  });

  it("states no change rather than a percentage when the comparison period has no data", () => {
    const data = report({ previousMonthsWithData: [] });
    const wb = book(data);
    const row = comparison(wb, COMPARISON_TOTAL);
    expect(data.comparable).toBe(false);
    expect(row[2]).toBe(NOT_REPORTED);
    expect(row[3]).toBe("No change stated");
    expect(row[4]).toBe("No change stated");
    expect(textOf(wb, "Summary")).toContain("no change is stated");
  });

  it("never reports a reduction when it is the current period that is missing", () => {
    const data = report({ monthsWithData: [] });
    const wb = book(data);
    const row = comparison(wb, COMPARISON_TOTAL);
    expect(row[1]).toBe(NOT_REPORTED);
    expect(row[4]).toBe("No change stated");
    expect(textOf(wb, "Summary")).toContain("would reflect missing data, not a reduction");
    expect(textOf(wb, "Summary")).not.toContain("-100");
  });

  it("carries the partly-reported caveat into the file", () => {
    const data = report({ previousMonthsWithData: ["2025-01"], previousMonthsInRange: 2 });
    expect(comparison(book(data), COMPARISON_TOTAL)[3]).not.toBe("No change stated");
    expect(textOf(book(data), "Summary")).toContain("only partly reported (1 of 2 months)");
  });

  it("states that no percentage can be given against a zero prior figure", () => {
    const data = report({ previousGroup: { scope1: 0, scope2Location: 2000, scope2Market: 1500, scope3: 3000, total: 5000 } });
    const scope1 = data.comparison.find((row) => row.key === "scope1")!;
    expect(scope1.delta!.deltaPercent).toBeNull();
    expect(comparison(book(data), "Scope 1 — direct")[4]).toBe(NOT_REPORTED);
  });
});

describe("provenance and placeholder factors", () => {
  it("lists the factor datasets that produced the figures", () => {
    const row = rowStartingWith(book(report()), "Data quality & methodology", "DEFRA/DESNZ 2024");
    expect(row[1]).toBe("2024");
    expect(row[2]).toBe("SCOPE_1");
    expect(row[3]).toBe("Imported dataset");
  });

  it("names the data-quality tier the way the screen does, not as a raw enum", () => {
    const wb = book(report());
    expect(rowStartingWith(wb, "Data quality & methodology", "Tier 1 — primary, measured")[1]).toBe(8);
    expect(textOf(wb, "Data quality & methodology")).not.toContain("TIER_1");
  });

  it("records the calculation engine and reporting boundary", () => {
    const wb = book(report());
    expect(rowStartingWith(wb, "Data quality & methodology", "Calculation engine")[1]).toBe("calc-engine-v1");
    expect(rowStartingWith(wb, "Data quality & methodology", "Reporting boundary")[1]).toBe("Synthetic Group — operational control.");
  });

  it("preserves the placeholder-factor warning rather than presenting figures as final", () => {
    const data = report({
      factorSources: [{ source: "Placeholder UK set", vintage: "2024", scope: "SCOPE_1", placeholder: true }],
    });
    const wb = book(data);
    const text = textOf(wb, "Data quality & methodology");
    expect(data.methodology.placeholderFactorsUsed).toBe(true);
    expect(text).toContain("Placeholder dataset");
    expect(text).toContain("Warning: placeholder emission factors are in use");
    expect(text).toContain("not verified, assured or suitable for formal disclosure");
    expect(rowStartingWith(wb, "Summary", "Basis of preparation")[1]).toBe(data.methodology.assurance);
  });

  it("never claims verification or assurance the domain does not record", () => {
    const text = textOf(book(report()), "Data quality & methodology");
    expect(text).toContain("No independent verification or assurance decision is recorded");
    expect(text).not.toMatch(/\bassured\b(?!,)/);
  });

  it("states completeness honestly when the collection plan requires nothing", () => {
    const wb = book(report({ collectionStatuses: [] }));
    expect(rowStartingWith(wb, "Data quality & methodology", "Received %")[1]).toBe("Not applicable — nothing required");
  });

  it("writes the collection-plan counts the report model holds", () => {
    const data = report();
    const wb = book(data);
    expect(rowStartingWith(wb, "Data quality & methodology", "Required cells")[1]).toBe(data.completeness.required);
    expect(rowStartingWith(wb, "Data quality & methodology", "Received")[1]).toBe(data.completeness.received);
    expect(rowStartingWith(wb, "Data quality & methodology", "Not yet received")[1]).toBe(data.completeness.missing);
  });

  it("carries the outstanding items the report model reports", () => {
    const data = report({ flaggedCount: 2 });
    const wb = book(data);
    for (const item of data.outstanding) {
      expect(rowStartingWith(wb, "Data quality & methodology", item.label)[1]).toBe(item.count);
    }
    expect(data.outstanding.some((item) => item.kind === "flagged")).toBe(true);
  });
});

describe("a closed reporting period still exports", () => {
  it("exports a fully closed period and labels it as closed", () => {
    const data = report({
      reportingPeriods: [
        { siteId: "alpha", month: "2026-01", state: "CLOSED" },
        { siteId: "alpha", month: "2026-02", state: "CLOSED" },
        { siteId: "beta", month: "2026-01", state: "CLOSED" },
        { siteId: "beta", month: "2026-02", state: "CLOSED" },
      ],
    });
    const wb = book(data);
    expect(data.periodState.kind).toBe("CLOSED");
    expect(rowStartingWith(wb, "Summary", "Reporting period status")[1]).toBe(data.periodState.label);
    // Closing changes no figure: the export is a read, not a mutation.
    expect(headline(wb, "Total emissions")[1]).toBe(8);
  });
});

describe("the file name is useful and safe", () => {
  it("names the period it covers", () => {
    expect(managementReportFileName(report())).toBe("carbon-management-report-2026-01-to-2026-02.xlsx");
  });

  it("names the site when the report is filtered to one", () => {
    expect(managementReportFileName(report({ siteFilterName: "Alpha Works", selectedSiteId: "alpha" }))).toBe(
      "carbon-management-report-alpha-works-2026-01-to-2026-02.xlsx",
    );
  });

  it("keeps path separators and other unsafe characters out of the name", () => {
    const name = managementReportFileName(report({ siteFilterName: 'A/B\\C:*?"<>| Depot', selectedSiteId: "alpha" }));
    expect(name).toMatch(/^carbon-management-report-[a-z0-9-]+-2026-01-to-2026-02\.xlsx$/);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it("is deterministic for the same selection", () => {
    expect(managementReportFileName(report())).toBe(managementReportFileName(report()));
  });
});

describe("an empty period exports without inventing figures", () => {
  it("writes words rather than zeros across the whole workbook", () => {
    const data = report({
      group: { scope1: 0, scope2Location: 0, scope2Market: 0, scope3: 0, total: 0 },
      previousGroup: { scope1: 0, scope2Location: 0, scope2Market: 0, scope3: 0, total: 0 },
      sites: [],
      previousSitesById: {},
      monthsWithData: [],
      previousMonthsWithData: [],
      sourceRows: [],
      scope3Totals: {},
      dataQuality: [],
      marketBasedAvailable: false,
      collectionStatuses: [],
      flaggedCount: 0,
    });
    expect(data.empty).toBe(true);
    const wb = book(data);
    expect(headline(wb, "Total emissions")[1]).toBe(NOT_REPORTED);
    expect(rowStartingWith(wb, "Monthly trend", "Jan 26")[4]).toBe(NOT_REPORTED);
    expect(textOf(wb, "Data quality & methodology")).toContain("Nothing outstanding for this period");
  });
});
