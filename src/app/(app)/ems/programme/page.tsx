import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import {
  listEmsProgrammes,
  listScopeVersions,
  listStandardRequirementMaps,
} from "@/lib/ems/foundation/programme-service";
import {
  listContextIssues,
  listInterestedParties,
  listEmsRiskOpportunities,
} from "@/lib/ems/foundation/context-service";
import { listChangeAssessments } from "@/lib/ems/foundation/change-service";
import { FoundationWorkspace } from "./foundation-workspace";

export const dynamic = "force-dynamic";

export default async function EmsProgrammePage({
  searchParams,
}: {
  searchParams: Promise<{ programmeId?: string }>;
}) {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const { programmeId: requestedProgrammeId } = await searchParams;
  const canManage = hasPermission(context, "ems.programme.manage");

  const [programmes, members, entities, sites] = await Promise.all([
    listEmsProgrammes(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.entity.findMany({
      where: { organisationId: context.organisationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.site.findMany({
      where: { organisationId: context.organisationId, isActive: true },
      select: { id: true, name: true, entityId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const selectedProgramme =
    programmes.find((p) => p.id === requestedProgrammeId) ??
    programmes.find((p) => p.status === "ACTIVE") ??
    programmes[0] ??
    null;

  const [scopeVersions, requirementMaps, contextIssues, interestedParties, risks, changes] = selectedProgramme
    ? await Promise.all([
        listScopeVersions(context, selectedProgramme.id),
        listStandardRequirementMaps(context, selectedProgramme.id),
        listContextIssues(context, selectedProgramme.id),
        listInterestedParties(context, selectedProgramme.id),
        listEmsRiskOpportunities(context, selectedProgramme.id),
        listChangeAssessments(context, selectedProgramme.id),
      ])
    : [[], [], [], [], [], []];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">EMS programme &amp; scope</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Programme status, scope boundary, organisational context, interested parties, risks/opportunities and
          change control — the foundation records introduced in task T23.
        </p>
      </div>

      <FoundationWorkspace
        canManage={canManage}
        programmes={programmes.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          standardsProfile: p.standardsProfile,
          standardsProfileVersion: p.standardsProfileVersion,
          certificationIntent: p.certificationIntent,
          currentScopeVersionId: p.currentScopeVersionId,
          createdAt: p.createdAt.toISOString(),
        }))}
        selectedProgrammeId={selectedProgramme?.id ?? null}
        members={members.map((m) => ({ id: m.id, name: m.user.name }))}
        entities={entities}
        sites={sites}
        scopeVersions={scopeVersions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          statement: v.statement,
          status: v.status,
          exclusions: v.exclusions,
          exclusionsRationale: v.exclusionsRationale,
          effectiveDate: v.effectiveDate?.toISOString() ?? null,
          entities: v.entities.map((e) => ({ id: e.entity.id, name: e.entity.name })),
          sites: v.sites.map((s) => ({ id: s.site.id, name: s.site.name })),
          activities: v.activities.map((a) => ({ id: a.id, description: a.description, siteName: a.site?.name ?? null })),
        }))}
        requirementMaps={requirementMaps.map((r) => ({
          id: r.id,
          standardProfile: r.standardProfile,
          requirementKey: r.requirementKey,
          implementationStatus: r.implementationStatus,
          gapStatus: r.gapStatus,
        }))}
        contextIssues={contextIssues.map((c) => ({
          id: c.id,
          type: c.type,
          title: c.title,
          description: c.description,
          direction: c.direction,
          significance: c.significance,
          reviewDate: c.reviewDate?.toISOString() ?? null,
        }))}
        interestedParties={interestedParties.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          influence: p.influence,
          isActive: p.isActive,
          requirements: p.requirements.map((r) => ({
            id: r.id,
            summary: r.summary,
            sourceReference: r.sourceReference,
            isMandatory: r.isMandatory,
          })),
        }))}
        risks={risks.map((r) => ({
          id: r.id,
          kind: r.kind,
          category: r.category,
          description: r.description,
          consequence: r.consequence,
          likelihood: r.likelihood,
          status: r.status,
          ratingScaleVersion: r.ratingScaleVersion,
          initialRating: r.initialRating as Record<string, unknown>,
          residualRating: r.residualRating as Record<string, unknown> | null,
        }))}
        changes={changes.map((c) => ({
          id: c.id,
          proposedChange: c.proposedChange,
          triggerType: c.triggerType,
          status: c.status,
          decision: c.decision,
          assessment: c.assessment,
          effectivenessReview: c.effectivenessReview,
        }))}
      />
    </div>
  );
}
