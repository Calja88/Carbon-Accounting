import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import {
  listComplianceEvaluationProgrammes,
  listComplianceEvaluations,
  listOverdueOrUnevaluatedObligations,
} from "@/lib/ems/legal/evaluation-service";
import { ComplianceEvaluationWorkspace } from "./evaluation-forms";

export const dynamic = "force-dynamic";

export default async function ComplianceEvaluationsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [programmes, evaluations, overdueObligations, entities, sites, members] = await Promise.all([
    listComplianceEvaluationProgrammes(context),
    listComplianceEvaluations(context),
    listOverdueOrUnevaluatedObligations(context),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Compliance evaluations</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Schedule and evidence whether this organisation is actually meeting its active compliance obligations. Every
          item outcome is a recorded human decision with a rationale — nothing is auto-decided. A completed evaluation
          can be issued once every item has an outcome; issuing freezes the report against the exact obligation versions
          it evaluated. A noncompliant or partially compliant item can request a nonconformity or corrective-action
          link — a request only, not an automatic record.
        </p>
      </div>

      <ComplianceEvaluationWorkspace
        programmes={programmes.map((programme) => ({
          id: programme.id,
          name: programme.name,
          status: programme.status,
          leadName: programme.lead.user.name ?? programme.leadMembershipId,
          periodStart: programme.periodStart.toISOString(),
          periodEnd: programme.periodEnd.toISOString(),
          evaluationCount: programme.evaluations.length,
        }))}
        evaluations={evaluations.map((evaluation) => ({
          id: evaluation.id,
          programmeName: evaluation.programme.name,
          leadName: evaluation.lead.user.name ?? evaluation.leadMembershipId,
          status: evaluation.status,
          periodStart: evaluation.periodStart.toISOString(),
          periodEnd: evaluation.periodEnd.toISOString(),
          issuedAt: evaluation.issuedAt ? evaluation.issuedAt.toISOString() : null,
          scopes: evaluation.scopes.map((scope) => ({
            id: scope.id,
            label: scope.entity?.name ?? scope.site?.name ?? "Unknown scope",
            kind: (scope.entityId ? "entity" : "site") as "entity" | "site",
          })),
          items: evaluation.items.map((item) => ({
            id: item.id,
            status: item.status,
            rationale: item.rationale,
            evaluatorName: item.evaluator?.user.name ?? null,
            evaluatedAt: item.evaluatedAt ? item.evaluatedAt.toISOString() : null,
            followUpDate: item.followUpDate ? item.followUpDate.toISOString() : null,
            obligationVersionId: item.obligationVersionId,
            obligationTitle: item.obligationVersion.title,
            obligationVersion: item.obligationVersion.version,
            instrumentTitle: item.obligationVersion.instrument?.title ?? item.obligationVersion.otherRequirementSource?.title ?? "Manual other-requirement source",
            findingLinks: item.findingLinks.map((link) => ({
              id: link.id,
              linkType: link.linkType,
              referenceNote: link.referenceNote,
              requestedAt: link.requestedAt.toISOString(),
            })),
          })),
        }))}
        overdueObligations={overdueObligations.map((row) => ({
          obligationVersionId: row.obligationVersionId,
          title: row.title,
          version: row.version,
          reviewDueDate: row.reviewDueDate ? row.reviewDueDate.toISOString() : null,
          reviewOverdue: row.reviewOverdue,
          neverEvaluated: row.neverEvaluated,
        }))}
        members={memberOptions}
        entities={entities.map((entity) => ({ id: entity.id, name: entity.name }))}
        sites={sites.map((site) => ({ id: site.id, name: site.name }))}
        canPerform={hasPermission(context, "ems.compliance_evaluation.perform")}
      />
    </div>
  );
}
