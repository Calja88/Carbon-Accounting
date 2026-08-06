import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function row(values: (string | number)[]): string {
  return values.map((v) => csvEscape(String(v))).join(",") + "\n";
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id },
    include: {
      calculationLinks: {
        include: {
          calculation: {
            include: {
              activityEntry: {
                include: { activityDataPoint: true, site: { include: { entity: true } }, enteredBy: true },
              },
              calculatedBy: true,
            },
          },
        },
      },
    },
  });

  if (!snapshot) {
    return new NextResponse("Report not found", { status: 404 });
  }

  const header = row([
    "Entity",
    "Site",
    "Data point code",
    "Data point",
    "Period start",
    "Period end",
    "Raw value",
    "Raw unit",
    "Canonical value",
    "Canonical unit",
    "Scope",
    "Basis",
    "Factor value (kgCO2e per unit)",
    "Factor unit",
    "Factor source",
    "Factor vintage",
    "Formula applied",
    "Result (kgCO2e)",
    "Data quality tier",
    "Entry status",
    "Entered by",
    "Entered at",
    "Calculated by",
    "Calculated at",
  ]);

  const lines = snapshot.calculationLinks.map((link) => {
    const c = link.calculation;
    const e = c.activityEntry;
    return row([
      e.site.entity.name,
      e.site.name,
      e.activityDataPoint.code,
      e.activityDataPoint.dataPointName,
      e.periodStart.toISOString().slice(0, 10),
      e.periodEnd.toISOString().slice(0, 10),
      e.rawValue.toString(),
      e.rawUnit,
      e.canonicalValue.toString(),
      e.canonicalUnit,
      c.scope,
      c.basis,
      c.factorValueSnapshot.toString(),
      c.factorUnitSnapshot,
      c.factorSourceSnapshot,
      c.factorVintageSnapshot,
      c.formulaApplied,
      c.resultKgCo2e.toString(),
      c.dataQualityTier,
      e.status,
      e.enteredBy.name,
      e.enteredAt.toISOString(),
      c.calculatedBy?.name ?? "system",
      c.calculatedAt.toISOString(),
    ]);
  });

  const csv = header + lines.join("");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="paragon-id-uk-audit-trail-v${snapshot.version}.csv"`,
    },
  });
}
