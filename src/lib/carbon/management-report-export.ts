/**
 * Phase 5B — the Management Carbon Report's workbook export.
 *
 * This module adds no arithmetic. It takes the *same* `ManagementReport` the
 * Phase 5A page renders and writes it out; every figure below is a field read
 * off that object, so the workbook cannot disagree with the screen. The only
 * transformation is kg → tonnes for presentation, done once in `tonnes()`.
 *
 * The two Phase 5A honesty rules survive the trip to a file, where they matter
 * more rather than less — a spreadsheet outlives the screen it came from and
 * gets re-read by people who never saw the report:
 *
 *  1. Missing is never zero. A null figure writes the words "Not reported",
 *     never `0`, so nobody can sum a gap into an inventory.
 *  2. Scope 2 location-based and market-based are companion views, never
 *     addends. Every scope line carries an explicit "In headline total"
 *     column, and market-based is the one that says No.
 */
import ExcelJS from "exceljs";
import { HEADLINE_BASIS, SCOPE3_STATE_LABEL, type ManagementReport } from "@/lib/carbon/management-report";
import { TONNES_CO2E } from "@/lib/format";

/** What a null figure reads as. Never a zero, never an empty cell. */
export const NOT_REPORTED = "Not reported";

const TONNES_FORMAT = "#,##0.00";
const PERCENT_FORMAT = '0.0"%"';
const SIGNED_TONNES_FORMAT = "+#,##0.00;-#,##0.00;0.00";
const SIGNED_PERCENT_FORMAT = '+0.0"%";-0.0"%";0.0"%"';

type Cell = number | string;

/** kg → tCO₂e, or the words for an absent figure. The one conversion in this file. */
function tonnes(kg: number | null | undefined): Cell {
  return kg === null || kg === undefined || !Number.isFinite(kg) ? NOT_REPORTED : kg / 1000;
}

function percent(value: number | null | undefined): Cell {
  return value === null || value === undefined || !Number.isFinite(value) ? NOT_REPORTED : value;
}

function timestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** Anything that is not a-z, 0-9 or a hyphen cannot reach the filename. */
function slug(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "site";
}

/**
 * A deterministic, filesystem-safe name. Two exports of the same report for
 * the same selection produce the same name, so a reviewer can tell at a glance
 * which period and which site filter a file on their desk covers.
 */
export function managementReportFileName(report: ManagementReport): string {
  const from = report.trend[0]?.month ?? "period";
  const to = report.trend[report.trend.length - 1]?.month ?? from;
  const site = report.siteFilterName ? `-${slug(report.siteFilterName)}` : "";
  return `carbon-management-report${site}-${from}-to-${to}.xlsx`;
}

function sheet(workbook: ExcelJS.Workbook, name: string, frozenRows: number): ExcelJS.Worksheet {
  return workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: frozenRows }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
}

function widths(ws: ExcelJS.Worksheet, ...values: number[]): void {
  values.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
}

function headerRow(ws: ExcelJS.Worksheet, values: string[]): ExcelJS.Row {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.alignment = { vertical: "middle", wrapText: true };
  return row;
}

/** Applies a numeric format only where a number was actually written. */
function format(row: ExcelJS.Row, columns: number[], numFmt: string): void {
  for (const column of columns) {
    const cell = row.getCell(column);
    if (typeof cell.value === "number") cell.numFmt = numFmt;
  }
}

function sectionTitle(ws: ExcelJS.Worksheet, title: string): void {
  const row = ws.addRow([title]);
  row.font = { bold: true, size: 12 };
}

/**
 * The whole report as a workbook. One sheet per section of the page, in the
 * order the page presents them, so a reader who has seen the report knows
 * where to look.
 */
export function buildManagementReportWorkbook(report: ManagementReport): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Carbon Ledger";
  workbook.created = new Date(report.capturedAt);
  workbook.title = `Carbon management report — ${report.organisationName} — ${report.periodLabel}`;

  summarySheet(workbook, report);
  sitesSheet(workbook, report);
  scope3Sheet(workbook, report);
  sourcesSheet(workbook, report);
  trendSheet(workbook, report);
  methodologySheet(workbook, report);

  return workbook;
}

function summarySheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Summary", 1);
  widths(ws, 34, 22, 22, 18, 16, 64);

  sectionTitle(ws, "Carbon management report");
  ws.addRow([]);

  // Context first: this file will be read long after, and somewhere else.
  const context: [string, string][] = [
    ["Organisation", report.organisationName],
    ["Reporting period", report.periodLabel],
    ["Comparison period", report.previousPeriodLabel],
    ["Site filter", report.siteFilterName ?? "All sites in your access"],
    ["Reporting period status", report.periodState.label],
    ["Generated", timestamp(report.capturedAt)],
    ["Headline basis", HEADLINE_BASIS],
    ["Basis of preparation", report.methodology.assurance],
  ];
  for (const [label, value] of context) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    ws.mergeCells(row.number, 2, row.number, 6);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }

  ws.addRow([]);
  sectionTitle(ws, `Headline accounting (${TONNES_CO2E})`);
  headerRow(ws, ["Line", TONNES_CO2E, "In headline total", "", "", "Note"]);
  for (const kpi of report.kpis) {
    const row = ws.addRow([
      kpi.label,
      tonnes(kpi.kgCo2e),
      // Stated per line rather than left to a footnote: this is the column
      // that stops somebody adding market-based onto the total.
      kpi.key === "total" ? "Headline total" : kpi.inHeadline ? "Yes" : "No — companion view",
      "",
      "",
      kpi.note ?? "",
    ]);
    format(row, [2], TONNES_FORMAT);
    if (kpi.key === "total") row.font = { bold: true };
  }

  ws.addRow([]);
  sectionTitle(ws, `Comparison with ${report.previousPeriodLabel}`);
  headerRow(ws, [
    "Line",
    `This period (${TONNES_CO2E})`,
    `Comparison (${TONNES_CO2E})`,
    `Change (${TONNES_CO2E})`,
    "Change %",
    "Note",
  ]);
  for (const line of report.comparison) {
    // A null delta means the two periods are not comparable. Phase 5A decided
    // that once; the export states it rather than computing a percentage of
    // its own, which is exactly how a missing period becomes a "100% reduction".
    const row = ws.addRow([
      line.label,
      tonnes(line.currentKg),
      tonnes(line.previousKg),
      line.delta ? tonnes(line.delta.deltaKg) : "No change stated",
      line.delta ? percent(line.delta.deltaPercent) : "No change stated",
      line.note ?? "",
    ]);
    format(row, [2, 3], TONNES_FORMAT);
    format(row, [4], SIGNED_TONNES_FORMAT);
    format(row, [5], SIGNED_PERCENT_FORMAT);
  }
  if (report.comparisonNote) ws.addRow([report.comparisonNote]).font = { italic: true };
}

function sitesSheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Sites", 1);
  // Scope 2 market-based is deliberately absent: every column here adds up to
  // the headline, and a companion column in the same grid invites a wrong sum.
  headerRow(ws, [
    "Site",
    "Entity",
    `Scope 1 (${TONNES_CO2E})`,
    `Scope 2 location-based (${TONNES_CO2E})`,
    `Scope 3 (${TONNES_CO2E})`,
    `Total (${TONNES_CO2E})`,
    "Share of total",
    `Change vs comparison (${TONNES_CO2E})`,
    "Change %",
    "Reporting period status",
  ]);
  widths(ws, 30, 26, 16, 24, 16, 16, 14, 24, 14, 30);

  for (const site of report.sites) {
    const row = ws.addRow([
      site.siteName,
      site.entityName,
      tonnes(site.scope1),
      tonnes(site.scope2Location),
      tonnes(site.scope3),
      tonnes(site.total),
      percent(site.sharePercent),
      tonnes(site.delta.deltaKg),
      percent(site.delta.deltaPercent),
      site.periodState.label,
    ]);
    format(row, [3, 4, 5, 6], TONNES_FORMAT);
    format(row, [7], PERCENT_FORMAT);
    format(row, [8], SIGNED_TONNES_FORMAT);
    format(row, [9], SIGNED_PERCENT_FORMAT);
  }
}

function scope3Sheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Scope 3", 1);
  headerRow(ws, ["Scope 3 category", TONNES_CO2E, "Share of total", "State"]);
  widths(ws, 46, 16, 14, 24);

  for (const category of report.scope3Categories) {
    const row = ws.addRow([
      category.category,
      tonnes(category.kgCo2e),
      percent(category.sharePercent),
      SCOPE3_STATE_LABEL[category.state],
    ]);
    format(row, [2], TONNES_FORMAT);
    format(row, [3], PERCENT_FORMAT);
  }

  // The unmodelled categories are named as unassessed rather than omitted —
  // an absent row reads as a zero to anyone totalling the column.
  if (report.scope3NotAssessed > 0) {
    ws.addRow([]);
    ws.addRow([`${report.scope3NotAssessed} further GHG Protocol Scope 3 categories are not assessed.`]).font = { italic: true };
    ws.addRow([report.methodology.scope3Note]).font = { italic: true };
  }
}

function sourcesSheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Sources", 1);
  headerRow(ws, ["Rank", "Source", "Scope", "Site", TONNES_CO2E, "Share of total"]);
  widths(ws, 8, 44, 12, 30, 16, 14);

  report.topSources.forEach((source, index) => {
    const row = ws.addRow([
      index + 1,
      source.category,
      source.scopeLabel,
      source.siteName,
      tonnes(source.kgCo2e),
      percent(source.sharePercent),
    ]);
    format(row, [5], TONNES_FORMAT);
    format(row, [6], PERCENT_FORMAT);
  });

  if (report.topSources.length > 0) {
    ws.addRow([]);
    ws.addRow([
      "",
      "Largest sources by site, scope and category. Location-based Scope 2 only, so these reconcile with the headline total.",
    ]).font = { italic: true };
  }
}

function trendSheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Monthly trend", 1);
  headerRow(ws, [
    "Month",
    `Scope 1 (${TONNES_CO2E})`,
    `Scope 2 location-based (${TONNES_CO2E})`,
    `Scope 3 (${TONNES_CO2E})`,
    `Total (${TONNES_CO2E})`,
    "Status",
  ]);
  widths(ws, 14, 16, 24, 16, 16, 18);

  for (const month of report.trend) {
    // An unreported month writes the words, not a zero. A reported month whose
    // emissions genuinely come to zero writes 0, and the Status column is what
    // tells the two apart.
    const row = ws.addRow([
      month.label,
      tonnes(month.scope1),
      tonnes(month.scope2Location),
      tonnes(month.scope3),
      tonnes(month.totalKg),
      month.reported ? "Reported" : NOT_REPORTED,
    ]);
    format(row, [2, 3, 4, 5], TONNES_FORMAT);
  }

  const unreported = report.trend.filter((month) => !month.reported);
  if (unreported.length > 0) {
    ws.addRow([]);
    ws.addRow([
      `${unreported.length} month(s) received no activity data and are absent from the figures above, not zero: ${unreported
        .map((m) => m.label)
        .join(", ")}.`,
    ]).font = { italic: true };
  }
}

function methodologySheet(workbook: ExcelJS.Workbook, report: ManagementReport): void {
  const ws = sheet(workbook, "Data quality & methodology", 0);
  widths(ws, 40, 30, 20, 20);

  sectionTitle(ws, "Data quality");
  headerRow(ws, ["Tier", TONNES_CO2E, "Share of total"]);
  for (const tier of report.dataQuality) {
    const row = ws.addRow([tier.tier, tonnes(tier.kgCo2e), percent(tier.percent)]);
    format(row, [2], TONNES_FORMAT);
    format(row, [3], PERCENT_FORMAT);
  }

  ws.addRow([]);
  sectionTitle(ws, "Completeness");
  headerRow(ws, ["Measure", "Value"]);
  const received = report.completeness.receivedPercent;
  const completenessRows: [string, Cell][] = [
    ["Required cells", report.completeness.required],
    ["Authorised exclusions", report.completeness.excluded],
    ["Received", report.completeness.received],
    // Nothing required means there is no denominator — an honest blank rather
    // than a 0% or a 100% invented from an empty plan.
    ["Received %", received === null ? "Not applicable — nothing required" : `${received.toFixed(1)}%`],
    ["Counted in the totals above", report.completeness.countedInTotals],
    ["Not yet received", report.completeness.missing],
  ];
  for (const [label, value] of completenessRows) ws.addRow([label, value]);
  ws.addRow(["Basis", report.completeness.basis]).getCell(2).alignment = { wrapText: true };

  if (report.completeness.rows.length > 0) {
    ws.addRow([]);
    headerRow(ws, ["Collection state", "Cells"]);
    for (const row of report.completeness.rows) ws.addRow([row.label, row.count]);
  }

  ws.addRow([]);
  sectionTitle(ws, "Outstanding data");
  if (report.outstanding.length === 0) {
    ws.addRow(["Nothing outstanding for this period in your scope."]);
  } else {
    headerRow(ws, ["Item", "Count", "What it means"]);
    for (const item of report.outstanding) {
      ws.addRow([item.label, item.count, item.detail]).getCell(3).alignment = { wrapText: true };
    }
  }

  ws.addRow([]);
  sectionTitle(ws, "Methodology");
  const methodology: [string, string][] = [
    ["Reporting boundary", report.methodology.boundary],
    ["Headline basis", report.methodology.headlineBasis],
    ["Scope 2", report.methodology.scope2Basis],
    ["Scope 3", report.methodology.scope3Note],
    ["Calculation engine", report.methodology.engineVersions.join(", ") || "Not recorded"],
    ["Basis of preparation", report.methodology.assurance],
  ];
  for (const [label, value] of methodology) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    ws.mergeCells(row.number, 2, row.number, 4);
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }

  ws.addRow([]);
  sectionTitle(ws, "Emission factor datasets used");
  headerRow(ws, ["Source", "Vintage", "Scope", "Dataset state"]);
  for (const factor of report.methodology.factorSources) {
    // Phase 3-vii publication is not implemented, so a placeholder set is
    // never dressed up as official here either.
    ws.addRow([factor.source, factor.vintage, factor.scope, factor.placeholder ? "Placeholder dataset" : "Imported dataset"]);
  }
  if (report.methodology.factorSources.length === 0) ws.addRow(["No factor dataset was used in this period."]);
  if (report.methodology.placeholderFactorsUsed) {
    ws.addRow([]);
    ws.addRow([
      "Warning: placeholder emission factors are in use. These figures are provisional management information and are not verified, assured or suitable for formal disclosure.",
    ]).font = { bold: true };
  }
}
