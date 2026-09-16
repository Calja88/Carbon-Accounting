import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext, findTenantManagementReview } from "@/lib/repositories/ems-repository";
import { getManagementReviewPack } from "@/lib/ems/review/pack-service";
import { listManagementReviewDecisions, listManagementReviewMinuteRevisions, listManagementReviewActionLinks } from "@/lib/ems/review/minutes-service";
import { listActionItems } from "@/lib/ems/actions/action-service";
import {
  ManagementReviewClosurePackWorkspace,
  type ReviewSummary,
  type PackView,
  type DecisionView,
  type MinuteRevisionView,
  type ActionLinkView,
  type ActionOption,
  type MemberOption,
} from "./review-detail-forms";

export const dynamic = "force-dynamic";

export default async function ManagementReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
  const review = await findTenantManagementReview(ctx, id).catch(() => null);
  if (!review) notFound();

  const [detail, pack, decisions, minuteRevisions, members] = await Promise.all([
    prisma.managementReview.findUnique({
      where: { id: review.id },
      include: {
        chair: { include: { user: { select: { name: true } } } },
        coordinator: { include: { user: { select: { name: true } } } },
        agendaTemplateVersion: { include: { template: true } },
        attendees: { include: { person: true } },
      },
    }),
    getManagementReviewPack(context, review.id).catch((error) => {
      if (error instanceof PermissionDeniedError) notFound();
      throw error;
    }),
    listManagementReviewDecisions(context, review.id),
    listManagementReviewMinuteRevisions(context, review.id),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  if (!detail) notFound();

  const memberNameById = new Map(members.map((m) => [m.id, m.user.name ?? m.id]));

  const actionLinksByDecision = new Map<string, Awaited<ReturnType<typeof listManagementReviewActionLinks>>>();
  for (const decision of decisions) {
    actionLinksByDecision.set(decision.id, await listManagementReviewActionLinks(context, decision.id));
  }

  const actionItems = await listActionItems(context).catch(() => []);

  const canManage = hasPermission(context, "ems.management_review.manage");
  const canApprove = hasPermission(context, "ems.management_review.approve");

  const reviewSummary: ReviewSummary = {
    id: detail.id,
    reference: detail.reference,
    status: detail.status,
    periodStart: detail.periodStart.toISOString().slice(0, 10),
    periodEnd: detail.periodEnd.toISOString().slice(0, 10),
    cutoffDate: detail.cutoffDate.toISOString().slice(0, 10),
    scheduledDate: detail.scheduledDate.toISOString().slice(0, 10),
    heldDate: detail.heldDate ? detail.heldDate.toISOString().slice(0, 10) : null,
    chairName: detail.chair.user.name ?? detail.chairMembershipId,
    coordinatorName: detail.coordinator.user.name ?? detail.coordinatorMembershipId,
    agendaTemplateName: detail.agendaTemplateVersion.template.name,
    agendaTemplateVersion: detail.agendaTemplateVersion.version,
    attendeeCount: detail.attendees.length,
  };

  const packView: PackView | null = pack
    ? {
        id: pack.id,
        status: pack.status,
        cutoffDate: pack.cutoffDate.toISOString().slice(0, 10),
        generatorVersion: pack.generatorVersion,
        generatedAt: pack.generatedAt ? pack.generatedAt.toISOString() : null,
        checksumSha256: pack.checksumSha256,
        issuedAt: pack.issuedAt ? pack.issuedAt.toISOString() : null,
        payload: pack.payload as Record<string, unknown> | null,
        inputSnapshots: pack.inputSnapshots.map((snapshot) => ({
          id: snapshot.id,
          inputDefinitionKey: snapshot.inputDefinitionKey,
          sourceType: snapshot.sourceType,
          sourceRecordId: snapshot.sourceRecordId,
          sourceVersionLabel: snapshot.sourceVersionLabel,
          summary: snapshot.summary === null || snapshot.summary === undefined ? null : JSON.stringify(snapshot.summary),
          isStale: snapshot.isStale,
        })),
        aiNarratives: pack.aiNarratives.map((narrative) => ({
          id: narrative.id,
          content: narrative.content,
          status: narrative.status,
          generatedAt: narrative.generatedAt.toISOString(),
          reviewedAt: narrative.reviewedAt ? narrative.reviewedAt.toISOString() : null,
          rejectionReason: narrative.rejectionReason,
        })),
      }
    : null;

  const decisionViews: DecisionView[] = decisions.map((decision) => ({
    id: decision.id,
    inputDefinitionKey: decision.inputDefinitionKey,
    decisionType: decision.decisionType,
    text: decision.text,
    rationale: decision.rationale,
    ownerName: decision.ownerMembershipId ? memberNameById.get(decision.ownerMembershipId) ?? decision.ownerMembershipId : null,
    targetDate: decision.targetDate ? decision.targetDate.toISOString().slice(0, 10) : null,
    recordedAt: decision.recordedAt.toISOString(),
    actionLinks: (actionLinksByDecision.get(decision.id) ?? []).map((link): ActionLinkView => ({
      id: link.id,
      actionItemId: link.actionItemId,
      actionItemTitle:
        actionItems.find((item) => item.id === link.actionItemId)?.title ?? link.actionItemId,
      actionItemStatus:
        actionItems.find((item) => item.id === link.actionItemId)?.status ?? "UNKNOWN",
    })),
  }));

  const minuteRevisionViews: MinuteRevisionView[] = minuteRevisions.map((revision) => ({
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    supersedesRevisionId: revision.supersedesRevisionId,
    addendumReason: revision.addendumReason,
    preparedAt: revision.preparedAt.toISOString(),
    approvedAt: revision.approvedAt ? revision.approvedAt.toISOString() : null,
    checksumSha256: revision.checksumSha256,
  }));

  const actionOptions: ActionOption[] = actionItems.map((item) => ({ id: item.id, title: item.title, status: item.status }));
  const memberOptions: MemberOption[] = members.map((m) => ({ id: m.id, name: m.user.name ?? m.id }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Management review: {reviewSummary.reference}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Pack, minutes, decisions, action links and closure for this review. Approval, addenda and closure state are
          shown below; nothing here alters an already-issued pack or approved minutes.
        </p>
        {pack?.status === "ISSUED" && Boolean((pack.payload as { board?: unknown } | null)?.board) && <a className="bd-button bd-button--primary mt-4" href={`/ems/management-reviews/${id}/pack`}>View issued management pack</a>}
      </div>

      <ManagementReviewClosurePackWorkspace
        review={reviewSummary}
        pack={packView}
        decisions={decisionViews}
        minuteRevisions={minuteRevisionViews}
        actionOptions={actionOptions}
        members={memberOptions}
        canManage={canManage}
        canApprove={canApprove}
      />
    </div>
  );
}
