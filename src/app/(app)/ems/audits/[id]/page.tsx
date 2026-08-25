import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, findTenantEmsAudit } from "@/lib/repositories/ems-repository";
import { getAuditChecklist } from "@/lib/ems/audits/checklist-service";
import { listAuditFindings } from "@/lib/ems/audits/finding-service";
import { getAuditReportRevision } from "@/lib/ems/audits/report-service";
import { AuditExecutionWorkspace } from "./audit-detail-forms";

export const dynamic = "force-dynamic";

/** Not a component — a plain helper, so `Date.now()` here isn't a render-purity concern. */
function isOverdue(dueDate: Date | null, closed: boolean): boolean {
  return !!dueDate && dueDate.getTime() < Date.now() && !closed;
}

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, id).catch(() => null);
  if (!audit) notFound();

  const [detail, checklist, findings, report, members] = await Promise.all([
    prisma.emsAudit.findUnique({
      where: { id: audit.id },
      include: { lead: { include: { user: { select: { name: true } } } }, team: { include: { membership: { include: { user: { select: { name: true } } } } } } },
    }),
    getAuditChecklist(context, audit.id),
    listAuditFindings(context, audit.id),
    getAuditReportRevision(context, audit.id).catch(() => null),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  if (!detail) notFound();

  const memberOptions = members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }));
  const auditingTeam = detail.team.filter((m) => m.role === "LEAD_AUDITOR" || m.role === "AUDITOR");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{detail.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {detail.type} · Lead: {detail.lead.user.name ?? detail.leadMembershipId} · Status: {detail.status}
        </p>
      </div>

      <AuditExecutionWorkspace
        auditId={detail.id}
        auditStatus={detail.status}
        checklist={
          checklist
            ? {
                id: checklist.id,
                version: checklist.version,
                status: checklist.status,
                items: checklist.items.map((item) => ({
                  id: item.id,
                  question: item.question,
                  criteriaReference: item.criteriaReference,
                  expectedEvidence: item.expectedEvidence,
                  response: item.response
                    ? {
                        result: item.response.result,
                        notes: item.response.notes,
                        auditorName: item.response.auditor?.user.name ?? item.response.auditorMembershipId ?? "Unknown",
                      }
                    : null,
                })),
              }
            : null
        }
        findings={findings.map((f) => ({
          id: f.id,
          classification: f.classification,
          status: f.status,
          statement: f.statement,
          objectiveEvidence: f.objectiveEvidence,
          criterionReference: f.criterionReference,
          ownerName: f.ownerMembershipId ? memberOptions.find((m) => m.id === f.ownerMembershipId)?.name ?? f.ownerMembershipId : null,
          dueDate: f.dueDate ? f.dueDate.toISOString().slice(0, 10) : null,
          overdue: isOverdue(f.dueDate, f.status === "CLOSED"),
        }))}
        report={report ? { status: report.status, issuedAt: report.issuedAt ? report.issuedAt.toISOString().slice(0, 10) : null, checksumSha256: report.checksumSha256 } : null}
        auditingTeam={auditingTeam.map((m) => ({ id: m.membershipId, name: m.membership.user.name ?? m.membershipId }))}
        members={memberOptions}
      />
    </div>
  );
}
