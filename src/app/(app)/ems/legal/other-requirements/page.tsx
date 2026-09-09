import { readableEvidenceIds } from "@/lib/documents/classification-access";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission, PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { listOtherRequirementSources } from "@/lib/ems/legal/other-requirement-service";
import { OtherRequirementSourceWorkspace } from "./other-requirement-forms";

export const dynamic = "force-dynamic";

export default async function OtherRequirementSourcesPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [sources, members] = await Promise.all([
    listOtherRequirementSources(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);

  const sourceIds = sources.map((source) => source.id);
  const [evidenceLinks, assessments] =
    sourceIds.length === 0
      ? [[], []]
      : await Promise.all([
          prisma.evidenceLink.findMany({
            where: { organisationId: context.organisationId, resourceType: "other_requirement_source", resourceId: { in: sourceIds } },
            include: { evidence: { select: { id: true, filename: true } } },
            orderBy: { linkedAt: "desc" },
          }),
          prisma.applicabilityAssessment.findMany({
            where: { organisationId: context.organisationId, otherRequirementSourceId: { in: sourceIds } },
            select: { otherRequirementSourceId: true },
          }),
        ]);

  const evidenceBySource = new Map<string, Array<{ id: string; filename: string }>>();
  const allowedEvidence = await readableEvidenceIds(context, evidenceLinks.map(link => link.evidence.id));
  for (const link of evidenceLinks) {
    if (!allowedEvidence.has(link.evidence.id)) continue;
    const current = evidenceBySource.get(link.resourceId) ?? [];
    current.push(link.evidence);
    evidenceBySource.set(link.resourceId, current);
  }
  const assessmentCountBySource = new Map<string, number>();
  for (const assessment of assessments) {
    if (!assessment.otherRequirementSourceId) continue;
    assessmentCountBySource.set(
      assessment.otherRequirementSourceId,
      (assessmentCountBySource.get(assessment.otherRequirementSourceId) ?? 0) + 1,
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Other requirements and manual legal sources</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Record permits, consents, regulator notices, contracts, customer requirements, and voluntary commitments that
          do not come through the automated legal-source sync. Each source&apos;s type and issuing authority stay explicit,
          supporting files use the same controlled evidence as every other EMS record, and a source with a next-review
          or expiry date stays visible until someone acts on it. Once assessed for applicability on the{" "}
          <a href="/ems/legal/applicability" className="text-blue-700 underline">applicability workflow</a> page, a manual
          source follows the identical assessment, obligation-versioning, and approval rules as an automated legal instrument.
        </p>
      </div>

      <OtherRequirementSourceWorkspace
        sources={sources.map((source) => ({
          id: source.id,
          type: source.type,
          title: source.title,
          issuingParty: source.issuingParty,
          reference: source.reference,
          description: source.description,
          status: source.status,
          ownerName: source.owner.user.name ?? source.ownerMembershipId,
          issuedAt: source.issuedAt ? source.issuedAt.toISOString() : null,
          effectiveFrom: source.effectiveFrom ? source.effectiveFrom.toISOString() : null,
          expiryDate: source.expiryDate ? source.expiryDate.toISOString() : null,
          nextReviewAt: source.nextReviewAt ? source.nextReviewAt.toISOString() : null,
          createdAt: source.createdAt.toISOString(),
          evidence: evidenceBySource.get(source.id) ?? [],
          applicabilityAssessmentCount: assessmentCountBySource.get(source.id) ?? 0,
        }))}
        members={members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }))}
        canManage={hasPermission(context, "ems.legal_source.manage")}
      />
    </div>
  );
}
