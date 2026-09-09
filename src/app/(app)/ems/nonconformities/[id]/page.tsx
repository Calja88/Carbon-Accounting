import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  getNonconformity,
  listNonconformityClassifications,
  NONCONFORMITY_MANAGE_PERMISSION,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { CORRECTIVE_ACTION_MANAGE_PERMISSION, listCorrectiveActionEvidence } from "@/lib/ems/nonconformity/corrective-action-service";
import { EFFECTIVENESS_REVIEW_PERMISSION } from "@/lib/ems/nonconformity/effectiveness-service";
import {
  LinkAdditionalSourceForm,
  RecordContainmentForm,
  ReviewContainmentAdequacyForm,
  CloseNonconformityButton,
  ReopenNonconformityForm,
  AssignClassificationForm,
  RootCauseSection,
  CorrectiveActionSection,
  EffectivenessReviewSection,
  type CorrectiveActionRow,
} from "../nonconformity-forms";

export const dynamic = "force-dynamic";

/** Not a component — a plain helper, so `Date.now()` here isn't a render-purity concern. */
function isOverdue(dueDate: Date | null, closed: boolean): boolean {
  return !!dueDate && dueDate.getTime() < Date.now() && !closed;
}

export default async function NonconformityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  let nonconformity;
  try {
    nonconformity = await getNonconformity(context, id);
  } catch (error) {
    if (error instanceof TenantOwnershipError) redirect("/ems/nonconformities");
    throw error;
  }

  const [classifications, members, evidenceByAction] = await Promise.all([
    listNonconformityClassifications(context),
    prisma.organisationMembership.findMany({ where: { organisationId: context.organisationId, status: "ACTIVE" }, include: { user: { select: { name: true } } } }),
    Promise.all(nonconformity.correctiveActions.map((action) => listCorrectiveActionEvidence(context, action.id).then((evidence) => [action.id, evidence] as const))),
  ]);
  const evidenceById = new Map(evidenceByAction);

  const canManage = hasPermission(context, NONCONFORMITY_MANAGE_PERMISSION);
  const canManageCorrectiveActions = hasPermission(context, CORRECTIVE_ACTION_MANAGE_PERMISSION);
  const canReviewEffectiveness = hasPermission(context, EFFECTIVENESS_REVIEW_PERMISSION);

  const memberName = (membershipId: string | null) => (membershipId ? members.find((m) => m.id === membershipId)?.user.name ?? membershipId : "Unassigned");
  const closedActionStatuses = new Set(["COMPLETED", "VERIFIED", "CANCELLED"]);
  const correctiveActionRows: CorrectiveActionRow[] = nonconformity.correctiveActions.map((action) => ({
    id: action.id,
    description: action.description,
    completionCriteria: action.completionCriteria,
    ownerName: memberName(action.ownerMembershipId),
    dueDate: action.dueDate.toISOString().slice(0, 10),
    overdue: isOverdue(action.dueDate, closedActionStatuses.has(action.status)),
    status: action.status,
    completionEvidenceNote: action.completionEvidenceNote,
    reopenReason: action.reopenReason,
    evidence: (evidenceById.get(action.id) ?? []).map((e) => ({ id: e.id, filename: e.filename })),
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{nonconformity.reference}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {nonconformity.sourceType.replace(/_/g, " ")} · created {nonconformity.createdAt.toISOString().slice(0, 10)} · Owner: {memberName(nonconformity.ownerMembershipId)}
            {nonconformity.dueDate && (
              <>
                {" "}
                · Due {nonconformity.dueDate.toISOString().slice(0, 10)}
                {isOverdue(nonconformity.dueDate, nonconformity.status === "CLOSED") && (
                  <span className="ml-1 font-semibold text-red-600">(overdue)</span>
                )}
              </>
            )}
          </p>
        </div>
        <Badge>{nonconformity.status}</Badge>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div>
            <p className="text-sm font-medium text-slate-700">Statement</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{nonconformity.statement}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Requirement reference</p>
            <p className="text-sm text-slate-600">{nonconformity.requirementReference}</p>
          </div>
          {nonconformity.sourceReferenceNote && (
            <div>
              <p className="text-sm font-medium text-slate-700">Source reference note</p>
              <p className="text-sm text-slate-600">{nonconformity.sourceReferenceNote}</p>
            </div>
          )}
          {canManage && (
            <AssignClassificationForm nonconformityId={nonconformity.id} classifications={classifications.map((c) => ({ id: c.id, name: c.label }))} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Sources ({nonconformity.sourceLinks.length})</h2>
          <p className="text-sm text-slate-500">
            Every source ever linked to this nonconformity, including duplicates — nothing here overwrites the original.
          </p>
          <ul className="space-y-1 text-sm">
            {nonconformity.sourceLinks.map((link) => (
              <li key={link.id} className="rounded-lg border border-slate-200 p-2">
                {link.isPrimary && <Badge tone="warning">Primary</Badge>} {link.sourceType.replace(/_/g, " ")}
                {link.sourceId ? ` · ${link.sourceId}` : ""}
                {link.sourceReferenceNote ? ` · ${link.sourceReferenceNote}` : ""}
              </li>
            ))}
          </ul>
          {canManage && <LinkAdditionalSourceForm nonconformityId={nonconformity.id} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Containment</h2>
          <ul className="space-y-2 text-sm">
            {nonconformity.containmentRecords.map((record) => (
              <li key={record.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-slate-700">{record.actionTaken}</p>
                <p className="text-slate-500">
                  {record.adequacyReviewed ? (record.adequate ? "Reviewed: adequate" : "Reviewed: not adequate") : "Adequacy not yet reviewed"}
                </p>
                {canManage && !record.adequacyReviewed && (
                  <div className="mt-2">
                    <ReviewContainmentAdequacyForm nonconformityId={nonconformity.id} containmentId={record.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && ["OPEN", "CONTAINED", "REOPENED"].includes(nonconformity.status) && (
            <RecordContainmentForm nonconformityId={nonconformity.id} members={members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }))} />
          )}
        </CardContent>
      </Card>

      <RootCauseSection
        nonconformityId={nonconformity.id}
        analyses={nonconformity.rootCauseAnalyses.map((a) => ({
          id: a.id,
          method: a.method,
          conclusion: a.conclusion,
          approvedAt: a.approvedAt ? a.approvedAt.toISOString().slice(0, 10) : null,
        }))}
        canManage={canManage}
      />

      <CorrectiveActionSection
        nonconformityId={nonconformity.id}
        actions={correctiveActionRows}
        members={members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }))}
        canCreate={canManageCorrectiveActions}
        canManage={canManageCorrectiveActions}
      />

      <EffectivenessReviewSection
          reviewCycle={nonconformity.reviewCycle}
        nonconformityId={nonconformity.id}
        reviews={nonconformity.effectivenessReviews.map((r) => ({
          id: r.id,
          criteria: r.criteria,
          reviewDate: r.reviewDate.toISOString().slice(0, 10),
          result: r.result,
          decision: r.decision,
        }))}
        nonconformityStatus={nonconformity.status}
        canRequest={canManage}
        canReview={canReviewEffectiveness}
      />

      {canManage && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold text-slate-900">Closure</h2>
            {["OPEN", "CONTAINED", "EFFECTIVENESS_REVIEW"].includes(nonconformity.status) && <CloseNonconformityButton nonconformityId={nonconformity.id} />}
            {nonconformity.status === "CLOSED" && <ReopenNonconformityForm nonconformityId={nonconformity.id} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
