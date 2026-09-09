import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { requireFrozenReportAccess } from "@/lib/rbac/carbon-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";

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

  let context;
  try {
    context = await requireOrganisationContext();
    requireFrozenReportAccess(context, true);
  } catch (err) {
    if (err instanceof PermissionDeniedError) return new NextResponse("Report not found", { status: 404 });
    if (err instanceof OrganisationAccessError) return new NextResponse("Sign in first.", { status: 401 });
    throw err;
  }
  const ctx = toTenantRepositoryContext(context);

  // Tenant-scoped at the initial lookup, and every linked Calculation is
  // filtered by the same organisationId again below — a snapshot can never
  // carry a foreign-tenant calculation into this export (spec §4: "No
  // report snapshot ... may combine more than one Organisation").
  const snapshot = await prisma.reportSnapshot.findFirst({
    where: tenantWhere(ctx, { id }),
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

  if (!snapshot || snapshot.calculationLinks.some(link => link.calculation.organisationId !== context.organisationId || link.calculation.activityEntry.organisationId !== context.organisationId)) {
    return new NextResponse("Report not found", { status: 404 });
  }

  const header = row([
    "Entity",
    "Site",
    "Data point code",
    "Data point",
    "Scope 3 category",
    "Supplier (if applicable)",
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
    "Derived from Scope 1/2 calculation",
  ]);

  const lines = snapshot.calculationLinks.map((link) => {
    const c = link.calculation;
    const e = c.activityEntry;
    return row([
      e.site.entity.name,
      e.site.name,
      e.activityDataPoint.code,
      e.activityDataPoint.dataPointName,
      c.scope3Category ?? "",
      e.supplierName ?? "",
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
      c.derivedFromCalculationId ?? "",
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
