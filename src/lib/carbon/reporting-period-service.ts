import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { requireSiteInScope, toTenantRepositoryContext, auditActorFor } from "@/lib/repositories/carbon-repository";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { LegalHoldError } from "@/lib/retention/legal-hold-service";
import type { ReportingPeriodState } from "@prisma/client";

function monthStartFor(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error("A valid accounting date is required.");
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Read-only: historical data is OPEN until somebody explicitly closes it. */
export async function getReportingPeriod(context: OrganisationContext, siteId: string, accountingDate: Date) {
  requirePermission(context, "carbon.view");
  await requireSiteInScope(context, siteId);
  const monthStart = monthStartFor(accountingDate);
  const period = await prisma.reportingPeriod.findUnique({
    where: { organisationId_siteId_monthStart: { organisationId: context.organisationId, siteId, monthStart } },
  });
  return period ?? { id: null, organisationId: context.organisationId, siteId, monthStart, state: "OPEN" as const };
}

/** Backend primitive only. Phase 4-iii supplies the close/reopen UX. */
export async function setReportingPeriodState(
  context: OrganisationContext,
  input: { siteId: string; accountingDate: Date; state: ReportingPeriodState; reason: string },
) {
  requirePermission(context, "carbon.entry.approve");
  if (input.state !== "OPEN" && input.state !== "CLOSED") throw new Error("Invalid reporting period state.");
  if (!input.reason.trim()) throw new Error("A reporting period transition requires a reason.");
  const monthStart = monthStartFor(input.accountingDate);
  const ctx = toTenantRepositoryContext(context);
  return prisma.$transaction(async (tx) => {
    await requireSiteInScope(context, input.siteId, tx);
    // Same lock as every accounting write; also works before a period row exists.
    await tx.$queryRaw`SELECT carbon_lock_accounting_site(${ctx.organisationId}::text, ${input.siteId}::text)::text`;
    const key = { organisationId: ctx.organisationId, siteId: input.siteId, monthStart };
    const previous = await tx.reportingPeriod.findUnique({ where: { organisationId_siteId_monthStart: key } });
    if (previous?.state === input.state) return previous;
    if (previous?.state === "CLOSED" && input.state === "OPEN") {
      const hold = await tx.legalHold.findFirst({ where: {
        organisationId: ctx.organisationId, status: "ACTIVE",
        OR: [{ resourceType: null, resourceId: null }, { resourceType: "reporting_period", resourceId: previous.id }],
      } });
      if (hold) throw new LegalHoldError("This reporting period is under an active legal hold.");
    }
    const period = await tx.reportingPeriod.upsert({
      where: { organisationId_siteId_monthStart: key },
      create: { ...key, state: input.state },
      update: { state: input.state },
    });
    await recordAuditEvent(tx, ctx, {
      eventType: input.state === "CLOSED" ? "reporting_period.closed" : "reporting_period.opened",
      resourceType: "reporting_period", resourceId: period.id,
      summary: `Reporting period ${monthStart.toISOString().slice(0, 7)} ${input.state.toLowerCase()} at site ${input.siteId}`,
      ...auditActorFor(ctx), correlationId: ctx.correlationId,
      before: { state: previous?.state ?? "OPEN" },
      after: { state: input.state, siteId: input.siteId, monthStart: monthStart.toISOString(), reason: input.reason.trim(), membershipId: context.membershipId },
    });
    return period;
  });
}
