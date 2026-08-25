import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { listManagementReviews, getManagementReview, listManagementReviewInputDefinitions, listOpenPriorActions } from "@/lib/ems/review/review-service";
import { listManagementReviewAgendaTemplates } from "@/lib/ems/review/agenda-service";
import { listPersonProfiles } from "@/lib/ems/competence/person-service";
import { listActionProgrammes } from "@/lib/ems/actions/action-service";
import { prisma } from "@/lib/prisma";
import { ManagementReviewWorkspace, type ManagementReviewRow, type AgendaTemplateOption, type InputDefinitionOption, type OpenPriorActionRowView } from "./review-forms";

export const dynamic = "force-dynamic";

export default async function ManagementReviewsPage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const [reviews, agendaTemplates, inputDefinitions, members, persons, programmes] = await Promise.all([
    listManagementReviews(context),
    listManagementReviewAgendaTemplates(context),
    listManagementReviewInputDefinitions(context),
    prisma.organisationMembership.findMany({
      where: { organisationId: context.organisationId, status: "ACTIVE" },
      include: { user: { select: { name: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    listPersonProfiles(context, { isActive: true }).catch(() => []),
    listActionProgrammes(context),
  ]);

  const memberNameById = new Map(members.map((m) => [m.id, m.user.name ?? m.id]));
  const programmeNameById = new Map(programmes.map((p) => [p.id, p.title]));

  const reviewRows: ManagementReviewRow[] = await Promise.all(
    reviews.map(async (review) => {
      const [detail, openActions] = await Promise.all([
        getManagementReview(context, review.id),
        listOpenPriorActions(context, review.id),
      ]);
      if (!detail) throw new Error("Review disappeared mid-request.");

      return {
        id: detail.id,
        reference: detail.reference,
        status: detail.status,
        periodStart: detail.periodStart.toISOString().slice(0, 10),
        periodEnd: detail.periodEnd.toISOString().slice(0, 10),
        cutoffDate: detail.cutoffDate.toISOString().slice(0, 10),
        scheduledDate: detail.scheduledDate.toISOString().slice(0, 10),
        heldDate: detail.heldDate ? detail.heldDate.toISOString().slice(0, 10) : null,
        chairName: memberNameById.get(detail.chairMembershipId) ?? detail.chairMembershipId,
        coordinatorName: memberNameById.get(detail.coordinatorMembershipId) ?? detail.coordinatorMembershipId,
        agendaTemplateName: detail.agendaTemplateVersion.template.name,
        agendaTemplateVersion: detail.agendaTemplateVersion.version,
        agendaItems: detail.agendaTemplateVersion.items.map((item) => ({
          id: item.id,
          order: item.order,
          title: item.title,
          description: item.description,
          inputDefinitionKey: item.inputDefinitionKey,
        })),
        attendees: detail.attendees.map((attendee) => ({
          id: attendee.id,
          personId: attendee.personId,
          personName: attendee.person.displayName ?? attendee.personId,
          role: attendee.role,
          invited: attendee.invited,
          attended: attendee.attended,
          notes: attendee.notes,
        })),
        inputLinks: detail.inputLinks.map((link) => ({
          id: link.id,
          inputDefinitionKey: link.inputDefinitionKey,
          sourceType: link.sourceType,
          sourceRecordId: link.sourceRecordId,
          sourceVersionLabel: link.sourceVersionLabel,
          isStale: link.isStale,
          linkedAt: link.linkedAt.toISOString(),
        })),
        openPriorActions: openActions.map((action): OpenPriorActionRowView => ({
          actionItemId: action.actionItemId,
          title: action.title,
          programmeName: programmeNameById.get(action.programmeId) ?? action.programmeId,
          status: action.status,
          dueDate: action.dueDate.toISOString().slice(0, 10),
          ownerName: memberNameById.get(action.ownerMembershipId) ?? action.ownerMembershipId,
        })),
      };
    }),
  );

  const templateOptions: AgendaTemplateOption[] = agendaTemplates.flatMap((template) =>
    template.versions
      .filter((version) => version.status === "APPROVED" || version.status === "ACTIVE")
      .map((version) => ({
        id: version.id,
        label: `${template.name} v${version.version} (${version.status})`,
      })),
  );

  const inputDefinitionOptions: InputDefinitionOption[] = inputDefinitions.map((definition) => ({
    id: definition.id,
    key: definition.key,
    label: definition.label,
    sourceType: definition.sourceType,
    required: definition.required,
    isActive: definition.isActive,
  }));

  const memberOptions = members.map((member) => ({ id: member.id, name: member.user.name ?? member.id }));
  const personOptions = persons.map((person) => ({
    id: person.id,
    name: person.displayName ?? person.membership?.user.name ?? person.id,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Management review cycle and agenda</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Schedule and reschedule management reviews, manage attendees and their responsibilities, link exact-version
          review inputs, and see open prior actions ahead of each review. Packs, minutes, decisions and closure are
          handled elsewhere once a review is held.
        </p>
      </div>

      <ManagementReviewWorkspace
        reviews={reviewRows}
        templateOptions={templateOptions}
        inputDefinitionOptions={inputDefinitionOptions}
        members={memberOptions}
        persons={personOptions}
      />
    </div>
  );
}
