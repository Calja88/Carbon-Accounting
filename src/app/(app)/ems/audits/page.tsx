import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { listAuditProgrammes, getAuditProgrammeCoverageReport } from "@/lib/ems/audits/programme-service";
import { AuditProgrammeWorkspace, type ProgrammeRow } from "./audit-forms";

export const dynamic = "force-dynamic";

function scopeLabel(scope: {
  entity?: { name: string } | null;
  site?: { name: string } | null;
  process?: { name: string } | null;
  aspect?: { name: string } | null;
  obligationId?: string | null;
  requirementMap?: { standardProfile: string; requirementKey: string } | null;
}): string {
  if (scope.entity) return `Entity: ${scope.entity.name}`;
  if (scope.site) return `Site: ${scope.site.name}`;
  if (scope.process) return `Process: ${scope.process.name}`;
  if (scope.aspect) return `Aspect: ${scope.aspect.name}`;
  if (scope.requirementMap) return `Requirement: ${scope.requirementMap.standardProfile} ${scope.requirementMap.requirementKey}`;
  if (scope.obligationId) return "Obligation";
  return "Unknown scope";
}

export default async function AuditProgrammesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const ctx = toTenantRepositoryContext(context);

  const [programmes, entities, sites, members] = await Promise.all([
    listAuditProgrammes(context),
    prisma.entity.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.site.findMany({ where: tenantWhere(ctx, {}), orderBy: { name: "asc" } }),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));
  const memberNameById = new Map(memberOptions.map((member) => [member.id, member.name]));

  const programmeRows: ProgrammeRow[] = await Promise.all(
    programmes.map(async (programme) => {
      const detail = await prisma.auditProgramme.findUnique({
        where: { id: programme.id },
        include: {
          items: {
            include: {
              scopes: {
                include: {
                  entity: { select: { name: true } },
                  site: { select: { name: true } },
                  process: { select: { name: true } },
                  aspect: { select: { name: true } },
                  requirementMap: { select: { standardProfile: true, requirementKey: true } },
                },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          audits: {
            include: {
              lead: { include: { user: { select: { name: true } } } },
              team: { include: { membership: { include: { user: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } },
              scopes: {
                include: {
                  entity: { select: { name: true } },
                  site: { select: { name: true } },
                  process: { select: { name: true } },
                  aspect: { select: { name: true } },
                  requirementMap: { select: { standardProfile: true, requirementKey: true } },
                },
              },
            },
            orderBy: { scheduledStart: "asc" },
          },
        },
      });
      if (!detail) throw new Error("Programme disappeared mid-request.");

      const coverage = programme.status !== "DRAFT" ? await getAuditProgrammeCoverageReport(context, programme.id) : null;

      return {
        id: detail.id,
        name: detail.name,
        status: detail.status,
        riskBasis: detail.riskBasis,
        ownerName: memberNameById.get(detail.ownerMembershipId) ?? detail.ownerMembershipId,
        periodStart: detail.periodStart.toISOString().slice(0, 10),
        periodEnd: detail.periodEnd.toISOString().slice(0, 10),
        items: detail.items.map((item) => ({
          id: item.id,
          title: item.title,
          priority: item.priority,
          plannedStart: item.plannedStart.toISOString().slice(0, 10),
          plannedEnd: item.plannedEnd.toISOString().slice(0, 10),
          scopeLabels: item.scopes.map(scopeLabel),
        })),
        audits: detail.audits.map((audit) => ({
          id: audit.id,
          title: audit.title,
          type: audit.type,
          status: audit.status,
          leadName: audit.lead.user.name ?? audit.leadMembershipId,
          scheduledStart: audit.scheduledStart.toISOString().slice(0, 10),
          scheduledEnd: audit.scheduledEnd.toISOString().slice(0, 10),
          scopeLabels: audit.scopes.map(scopeLabel),
          team: audit.team.map((member) => ({
            id: member.id,
            membershipId: member.membershipId,
            memberName: member.membership.user.name ?? member.membershipId,
            role: member.role,
            independenceDeclared: member.independenceDeclared,
            conflictDeclared: member.conflictDeclared,
            conflictNotes: member.conflictNotes,
          })),
        })),
        coverage: coverage
          ? {
              sites: { totalCount: coverage.sites.totalCount, coveredCount: coverage.sites.coveredCount },
              processes: { totalCount: coverage.processes.totalCount, coveredCount: coverage.processes.coveredCount },
              aspects: { totalCount: coverage.aspects.totalCount, coveredCount: coverage.aspects.coveredCount },
              obligations: { totalCount: coverage.obligations.totalCount, coveredCount: coverage.obligations.coveredCount },
              requirements: { totalCount: coverage.requirements.totalCount, coveredCount: coverage.requirements.coveredCount },
            }
          : null,
      };
    }),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Audit programme and execution</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Plan a risk-based internal audit programme, schedule audits under it, assign a team with an explicit
          independence declaration, and track coverage across sites, processes, aspects, obligations and internal
          requirements. Checklist execution, findings and the frozen audit report are a later stage of this workflow.
        </p>
      </div>

      <AuditProgrammeWorkspace programmes={programmeRows} members={memberOptions} entities={entities.map((e) => ({ id: e.id, name: e.name }))} sites={sites.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
