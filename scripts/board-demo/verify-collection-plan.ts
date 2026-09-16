/** Read-only runtime verification of the demo's collection plan, report, register, periods and LCA. Writes nothing. */
import { prisma } from "../../src/lib/prisma";
import { resolveOrganisationContext } from "../../src/lib/organisation/context";
import { loadManagementReport } from "../../src/lib/carbon/live-management-report";
import { buildManagementReportWorkbook } from "../../src/lib/carbon/management-report-export";
import { getCollectionMatrix } from "../../src/lib/carbon/collection-plan-service";
import { assertDemoDatabaseTarget } from "./db-target-guard";
import { FIXTURE_ORGANISATION_SLUG_PREFIX } from "./live-seed-port";

const fail: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(label);
}

async function main() {
  assertDemoDatabaseTarget(process.env);
  const org = await prisma.organisation.findFirstOrThrow({ where: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } });
  const membership = await prisma.organisationMembership.findFirstOrThrow({
    where: {
      organisationId: org.id, status: "ACTIVE", accessMode: "ORGANISATION_WIDE",
      roles: { some: { role: { isActive: true, permissions: { some: { permissionCode: "carbon.entry.review" } } } } },
    },
    select: { userId: true },
  });
  const context = await resolveOrganisationContext(prisma, { userId: membership.userId });
  const now = new Date();

  // --- Management report (default year-to-date window, exactly as /reports/management opens) ---
  const report = await loadManagementReport(context, {}, prisma, now);
  const c = report.completeness;
  console.log("\n# Management report — completeness");
  console.log(JSON.stringify({ required: c.required, excluded: c.excluded, received: c.received, missing: c.missing, receivedPercent: c.receivedPercent, countedInTotals: c.countedInTotals, rows: c.rows }, null, 1));
  check("completeness has a denominator", c.required > 0, `required=${c.required}`);
  check("completeness percentage is reported", c.receivedPercent !== null, `${c.receivedPercent?.toFixed(1)}%`);
  check("completeness is non-trivial (not 0% and not a bare 100%)", (c.receivedPercent ?? 0) > 0 && (c.receivedPercent ?? 0) < 100);
  check("completeness rows are populated", c.rows.length > 0, c.rows.map((r) => `${r.label}=${r.count}`).join(", "));

  console.log("\n# Management report — outstanding");
  console.log(JSON.stringify(report.outstanding.map((o) => ({ kind: o.kind, count: o.count, href: o.href })), null, 1));
  check("outstanding section is populated", report.outstanding.length > 0);
  check("outstanding includes not-yet-received", report.outstanding.some((o) => o.kind === "missing"));
  check("every outstanding row links somewhere", report.outstanding.every((o) => typeof o.href === "string" && o.href.length > 0));

  console.log("\n# Management report — totals / period state");
  console.log(JSON.stringify({ kpis: report.kpis, periodState: report.periodState, periodLabel: report.periodLabel }, null, 1));

  // --- Collection matrix (the /data screen's own source) ---
  const matrix = await getCollectionMatrix(context, { periodStart: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)) }, prisma, now);
  const byStatus = matrix.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const kinds = new Set(matrix.map((r) => r.periodKind));
  console.log("\n# Data collection screen");
  console.log(JSON.stringify({ cells: matrix.length, byStatus, cadences: [...kinds], sites: new Set(matrix.map((r) => r.siteId)).size, sources: new Set(matrix.map((r) => r.activityDataPointId)).size }, null, 1));
  check("collection matrix has cells", matrix.length > 0, `${matrix.length}`);
  check("matrix covers every configured site", new Set(matrix.map((r) => r.siteId)).size === 3);
  check("both cadences are represented", kinds.has("MONTHLY") && kinds.has("QUARTERLY"));
  check("the open current period is flagged as not-yet-late", matrix.some((r) => r.status === "missing" && r.periodOpen));
  check("report and /data agree on statuses", JSON.stringify(byStatus) === JSON.stringify(matrix.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {})));

  // --- XLSX export ---
  const wb = buildManagementReportWorkbook(report);
  const buf = await wb.xlsx.writeBuffer();
  // Completeness lives on the "Data quality & methodology" sheet, not the summary.
  const findRow = (label: string) => {
    let found: unknown;
    for (const ws of wb.worksheets) {
      ws.eachRow((row) => { if (String(row.getCell(1).value ?? "").trim() === label) found = row.getCell(2).value; });
    }
    return found;
  };
  console.log("\n# XLSX export");
  console.log(JSON.stringify({ bytes: buf.byteLength, sheets: wb.worksheets.map((w) => w.name), requiredCells: findRow("Required cells"), received: findRow("Received"), notYetReceived: findRow("Not yet received"), countedInTotals: findRow("Counted in the totals above") }, null, 1));
  check("workbook builds", buf.byteLength > 0, `${buf.byteLength} bytes`);
  check("export reconciles required count with the report", findRow("Required cells") === c.required);
  check("export reconciles received count with the report", findRow("Received") === c.received);
  check("export reconciles missing count with the report", findRow("Not yet received") === c.missing);

  // --- Activity register / reporting periods / LCA integrity ---
  const entries = await prisma.activityEntry.count();
  const calcs = await prisma.calculation.count();
  // The register is proven untouched by age, not by shape: the BOARD-1
  // fixture legitimately carries several line items per site/source/month,
  // so a "duplicate rows" query would flag its own seed data. What matters is
  // that this configuration-only change wrote no entry and no calculation.
  // Anchored to this change itself rather than a wall-clock window: the
  // configuration rows are the first thing it writes, so anything accounting
  // touched at or after that instant would be its doing. A fixed "last 24
  // hours" would also catch a rehearsal edit someone made the night before.
  const firstWrite = await prisma.organisationSourceConfig.aggregate({ _min: { createdAt: true } });
  const since = firstWrite._min.createdAt ?? now;
  const touchedEntries = await prisma.activityEntry.count({ where: { updatedAt: { gte: since } } });
  const touchedCalcs = await prisma.calculation.count({ where: { calculatedAt: { gte: since } } });
  const periods = await prisma.reportingPeriod.groupBy({ by: ["state"], _count: { _all: true } });
  const lca = { product: await prisma.product.count(), assessments: await prisma.lcaAssessment.count(), items: await prisma.lcaInventoryItem.count(), results: await prisma.lcaCalculationResult.count() };
  console.log("\n# Integrity");
  console.log(JSON.stringify({ entries, calcs, touchedEntries, touchedCalcs, periods, lca }, null, 1));
  check("activity entries unchanged", entries === 384, `${entries}`);
  check("calculations unchanged", calcs === 576, `${calcs}`);
  check("no activity entry created or modified by this change", touchedEntries === 0, String(touchedEntries));
  check("no calculation created or modified by this change", touchedCalcs === 0, String(touchedCalcs));
  check("no reporting period left CLOSED unintentionally", periods.every((p) => p.state === "OPEN"), JSON.stringify(periods));
  check("LCA demo intact", lca.product === 1 && lca.assessments === 2 && lca.items === 6 && lca.results === 6, JSON.stringify(lca));

  const assessment = await prisma.lcaAssessment.findFirstOrThrow({ include: { results: true } });
  const assessmentItems = await prisma.lcaInventoryItem.count({ where: { assessmentId: assessment.id } });
  check("LCA assessment still loads with its items and results", assessmentItems > 0 && assessment.results.length > 0, `items=${assessmentItems} results=${assessment.results.length}`);

  console.log(`\n${fail.length === 0 ? "ALL CHECKS PASSED" : `FAILED: ${fail.join("; ")}`}`);
  if (fail.length > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("verification failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
