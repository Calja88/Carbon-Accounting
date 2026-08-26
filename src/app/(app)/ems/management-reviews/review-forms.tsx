"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  scheduleManagementReviewAction,
  rescheduleManagementReviewAction,
  startInputCollectionAction,
  addManagementReviewAttendeeAction,
  removeManagementReviewAttendeeAction,
  linkManagementReviewInputAction,
  removeManagementReviewInputLinkAction,
  upsertManagementReviewInputDefinitionAction,
  deactivateManagementReviewInputDefinitionAction,
  type ReviewActionState,
} from "./actions";

const emptyState: ReviewActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type AgendaTemplateOption = { id: string; label: string };
export type InputDefinitionOption = {
  id: string;
  key: string;
  label: string;
  sourceType: string;
  required: boolean;
  isActive: boolean;
};

export type AgendaItemView = { id: string; order: number; title: string; description: string | null; inputDefinitionKey: string | null };
export type AttendeeView = {
  id: string;
  personId: string;
  personName: string;
  role: string;
  invited: boolean;
  attended: boolean | null;
  notes: string | null;
};
export type InputLinkView = {
  id: string;
  inputDefinitionKey: string;
  sourceType: string;
  sourceRecordId: string;
  sourceVersionLabel: string | null;
  isStale: boolean;
  linkedAt: string;
};
export type OpenPriorActionRowView = {
  actionItemId: string;
  title: string;
  programmeName: string;
  status: string;
  dueDate: string;
  ownerName: string;
};

export type ManagementReviewRow = {
  id: string;
  reference: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  cutoffDate: string;
  scheduledDate: string;
  heldDate: string | null;
  chairName: string;
  coordinatorName: string;
  agendaTemplateName: string;
  agendaTemplateVersion: number;
  agendaItems: AgendaItemView[];
  attendees: AttendeeView[];
  inputLinks: InputLinkView[];
  openPriorActions: OpenPriorActionRowView[];
};

function Feedback({ state }: { state: ReviewActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function reviewStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "PLANNED") return "warning";
  if (status === "INPUT_COLLECTION") return "info";
  if (status === "PACK_ISSUED" || status === "MINUTES_DRAFT") return "info";
  if (status === "HELD") return "success";
  if (status === "APPROVED" || status === "CLOSED") return "neutral";
  return "neutral";
}

function isOverdue(row: ManagementReviewRow): boolean {
  if (row.heldDate) return false;
  if (row.status !== "PLANNED" && row.status !== "INPUT_COLLECTION") return false;
  return new Date(row.scheduledDate).getTime() < Date.now();
}

function actionStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "BLOCKED") return "danger";
  if (status === "IN_PROGRESS") return "info";
  if (status === "REOPENED") return "warning";
  return "warning";
}

function ScheduleReviewForm({ templateOptions, members }: { templateOptions: AgendaTemplateOption[]; members: Option[] }) {
  const [state, action, pending] = useActionState(scheduleManagementReviewAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <h3 className="font-medium text-slate-900">Schedule a management review</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="schedule-reference">Reference</Label>
          <Input id="schedule-reference" name="reference" required placeholder="Synthetic example: MR-2026-Q3" />
        </div>
        <div>
          <Label htmlFor="schedule-agendaTemplateVersionId">Agenda template version</Label>
          <Select id="schedule-agendaTemplateVersionId" name="agendaTemplateVersionId" required defaultValue="">
            <option value="" disabled>Choose an approved or active version</option>
            {templateOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="schedule-periodStart">Period start</Label>
          <Input id="schedule-periodStart" type="date" name="periodStart" required />
        </div>
        <div>
          <Label htmlFor="schedule-periodEnd">Period end</Label>
          <Input id="schedule-periodEnd" type="date" name="periodEnd" required />
        </div>
        <div>
          <Label htmlFor="schedule-cutoffDate">Cutoff date</Label>
          <Input id="schedule-cutoffDate" type="date" name="cutoffDate" required />
        </div>
        <div>
          <Label htmlFor="schedule-scheduledDate">Scheduled date</Label>
          <Input id="schedule-scheduledDate" type="date" name="scheduledDate" required />
        </div>
        <div>
          <Label htmlFor="schedule-chairMembershipId">Chair</Label>
          <Select id="schedule-chairMembershipId" name="chairMembershipId" required defaultValue="">
            <option value="" disabled>Choose a chair</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="schedule-coordinatorMembershipId">Coordinator</Label>
          <Select id="schedule-coordinatorMembershipId" name="coordinatorMembershipId" required defaultValue="">
            <option value="" disabled>Choose a coordinator</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Scheduling..." : "Schedule review"}</Button>
    </form>
  );
}

function RescheduleForm({ reviewId }: { reviewId: string }) {
  const [state, action, pending] = useActionState(rescheduleManagementReviewAction, emptyState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <div>
        <Label htmlFor={`scheduledDate-${reviewId}`}>New date</Label>
        <Input id={`scheduledDate-${reviewId}`} type="date" name="scheduledDate" required />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving..." : "Reschedule"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function StartInputCollectionButton({ reviewId }: { reviewId: string }) {
  const [state, action, pending] = useActionState(startInputCollectionAction, emptyState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Starting..." : "Start input collection"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function AttendeesPanel({ reviewId, attendees, persons }: { reviewId: string; attendees: AttendeeView[]; persons: Option[] }) {
  const [addState, addAction, addPending] = useActionState(addManagementReviewAttendeeAction, emptyState);
  const [removeState, removeAction] = useActionState(removeManagementReviewAttendeeAction, emptyState);
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-700">Attendees and responsibilities</h4>
      {attendees.length === 0 ? (
        <p className="text-sm text-slate-500">No attendees added yet.</p>
      ) : (
        <ul className="space-y-1">
          {attendees.map((attendee) => (
            <li key={attendee.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-slate-900">{attendee.personName}</span>{" "}
                <Badge tone="neutral">{attendee.role}</Badge>
                {attendee.notes && <span className="ml-2 text-slate-500">{attendee.notes}</span>}
              </span>
              <form action={removeAction}>
                <input type="hidden" name="attendeeId" value={attendee.id} />
                <Button type="submit" variant="ghost" size="sm">Remove</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <div>
          <Label htmlFor={`personId-${reviewId}`}>Person</Label>
          <Select id={`personId-${reviewId}`} name="personId" required defaultValue="">
            <option value="" disabled>Choose a person</option>
            {persons.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`role-${reviewId}`}>Role</Label>
          <Select id={`role-${reviewId}`} name="role" defaultValue="MEMBER">
            <option value="CHAIR">Chair</option>
            <option value="COORDINATOR">Coordinator</option>
            <option value="MEMBER">Member</option>
            <option value="GUEST">Guest</option>
          </Select>
        </div>
        <div className="grow">
          <Label htmlFor={`attendeeNotes-${reviewId}`}>Notes</Label>
          <Input id={`attendeeNotes-${reviewId}`} name="notes" placeholder="Optional" />
        </div>
        <Button type="submit" disabled={addPending}>{addPending ? "Adding..." : "Add attendee"}</Button>
      </form>
      <Feedback state={addState} />
      {removeState.error && <p role="alert" className="text-sm text-red-600">{removeState.error}</p>}
    </div>
  );
}

function InputLinksPanel({
  reviewId,
  inputLinks,
  inputDefinitionOptions,
}: {
  reviewId: string;
  inputLinks: InputLinkView[];
  inputDefinitionOptions: InputDefinitionOption[];
}) {
  const [linkState, linkAction, linkPending] = useActionState(linkManagementReviewInputAction, emptyState);
  const [removeState, removeAction] = useActionState(removeManagementReviewInputLinkAction, emptyState);
  const linkedKeys = new Set(inputLinks.map((link) => link.inputDefinitionKey));
  const missingRequired = inputDefinitionOptions.filter((def) => def.isActive && def.required && !linkedKeys.has(def.key));

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-slate-700">Review inputs</h4>
      {missingRequired.length > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Missing required inputs: {missingRequired.map((def) => def.label).join(", ")}
        </p>
      )}
      {inputLinks.length === 0 ? (
        <p className="text-sm text-slate-500">No inputs linked yet.</p>
      ) : (
        <ul className="space-y-1">
          {inputLinks.map((link) => (
            <li key={link.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-slate-900">{link.inputDefinitionKey}</span>{" "}
                <span className="text-slate-500">
                  {link.sourceType} · {link.sourceVersionLabel ?? link.sourceRecordId}
                </span>{" "}
                {link.isStale && <Badge tone="warning">Stale</Badge>}
              </span>
              <form action={removeAction}>
                <input type="hidden" name="linkId" value={link.id} />
                <Button type="submit" variant="ghost" size="sm">Remove</Button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={linkAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <div>
          <Label htmlFor={`inputDefinitionKey-${reviewId}`}>Input definition</Label>
          <Select id={`inputDefinitionKey-${reviewId}`} name="inputDefinitionKey" required defaultValue="">
            <option value="" disabled>Choose an input</option>
            {inputDefinitionOptions.filter((def) => def.isActive).map((def) => (
              <option key={def.id} value={def.key}>{def.label}{def.required ? " (required)" : ""}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`sourceRecordId-${reviewId}`}>Exact source record ID</Label>
          <Input id={`sourceRecordId-${reviewId}`} name="sourceRecordId" placeholder="Optional — newest is used if blank" />
        </div>
        <Button type="submit" disabled={linkPending}>{linkPending ? "Linking..." : "Link input"}</Button>
      </form>
      <Feedback state={linkState} />
      {removeState.error && <p role="alert" className="text-sm text-red-600">{removeState.error}</p>}
    </div>
  );
}

function AgendaItemsView({ items }: { items: AgendaItemView[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-700">Pinned agenda</h4>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        {items.map((item) => (
          <li key={item.id}>
            <span className="font-medium text-slate-900">{item.title}</span>
            {item.description && <span className="text-slate-500"> — {item.description}</span>}
            {item.inputDefinitionKey && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{item.inputDefinitionKey}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function OpenPriorActionsView({ actions }: { actions: OpenPriorActionRowView[] }) {
  if (actions.length === 0) return <p className="text-sm text-slate-500">No open prior actions.</p>;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-slate-700">Open prior actions</h4>
      <ul className="space-y-1">
        {actions.map((action) => (
          <li key={action.actionItemId} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
            <span>
              <span className="font-medium text-slate-900">{action.title}</span>{" "}
              <span className="text-slate-500">({action.programmeName}) — owner {action.ownerName}, due {action.dueDate}</span>
            </span>
            <Badge tone={actionStatusTone(action.status)}>{action.status}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewCard({
  review,
  inputDefinitionOptions,
  persons,
}: {
  review: ManagementReviewRow;
  inputDefinitionOptions: InputDefinitionOption[];
  persons: Option[];
}) {
  const overdue = isOverdue(review);
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{review.reference}</h3>
            <p className="text-sm text-slate-500">
              {review.agendaTemplateName} v{review.agendaTemplateVersion} · Chair {review.chairName} · Coordinator {review.coordinatorName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {overdue && <Badge tone="danger">Overdue</Badge>}
            <Badge tone={reviewStatusTone(review.status)}>{review.status.replace(/_/g, " ")}</Badge>
            <Link
              href={`/ems/management-reviews/${review.id}`}
              className="text-sm font-medium text-slate-900 underline underline-offset-2"
            >
              Pack, minutes &amp; decisions
            </Link>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-4">
          <div><dt className="text-slate-500">Period</dt><dd>{review.periodStart} – {review.periodEnd}</dd></div>
          <div><dt className="text-slate-500">Cutoff</dt><dd>{review.cutoffDate}</dd></div>
          <div><dt className="text-slate-500">Scheduled</dt><dd>{review.scheduledDate}</dd></div>
          <div><dt className="text-slate-500">Held</dt><dd>{review.heldDate ?? "—"}</dd></div>
        </dl>

        {(review.status === "PLANNED" || review.status === "INPUT_COLLECTION") && (
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
            <RescheduleForm reviewId={review.id} />
            {review.status === "PLANNED" && <StartInputCollectionButton reviewId={review.id} />}
          </div>
        )}

        <div className="grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
          <AttendeesPanel reviewId={review.id} attendees={review.attendees} persons={persons} />
          <InputLinksPanel reviewId={review.id} inputLinks={review.inputLinks} inputDefinitionOptions={inputDefinitionOptions} />
        </div>

        <div className="grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
          <AgendaItemsView items={review.agendaItems} />
          <OpenPriorActionsView actions={review.openPriorActions} />
        </div>
      </CardContent>
    </Card>
  );
}

function InputDefinitionsPanel({ options }: { options: InputDefinitionOption[] }) {
  const [upsertState, upsertAction, upsertPending] = useActionState(upsertManagementReviewInputDefinitionAction, emptyState);
  const [deactivateState, deactivateAction] = useActionState(deactivateManagementReviewInputDefinitionAction, emptyState);
  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <h3 className="font-medium text-slate-900">Review input definitions</h3>
      <p className="text-sm text-slate-500">
        The catalogue of inputs a review can link — labels and required flags are editable per organisation; source
        type selects which module resolves the exact record.
      </p>
      {options.length > 0 && (
        <ul className="space-y-1">
          {options.map((option) => (
            <li key={option.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-slate-900">{option.label}</span>{" "}
                <span className="text-slate-500">({option.key} · {option.sourceType})</span>{" "}
                {option.required && <Badge tone="info">Required</Badge>}
                {!option.isActive && <Badge tone="neutral">Inactive</Badge>}
              </span>
              {option.isActive && (
                <form action={deactivateAction}>
                  <input type="hidden" name="id" value={option.id} />
                  <Button type="submit" variant="ghost" size="sm">Deactivate</Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <form action={upsertAction} className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="inputDef-key">Key</Label>
          <Input id="inputDef-key" name="key" required placeholder="e.g. compliance_status" />
        </div>
        <div>
          <Label htmlFor="inputDef-label">Label</Label>
          <Input id="inputDef-label" name="label" required placeholder="e.g. Compliance status" />
        </div>
        <div>
          <Label htmlFor="inputDef-sourceType">Source type</Label>
          <Select id="inputDef-sourceType" name="sourceType" required defaultValue="">
            <option value="" disabled>Choose a source type</option>
            <option value="COMPLIANCE_EVALUATION">Compliance evaluation</option>
            <option value="ACTION_PROGRAMME">Action programme</option>
            <option value="AUDIT_REPORT">Audit report</option>
            <option value="CORRECTIVE_ACTION">Corrective action</option>
            <option value="COMPETENCE_GAP">Competence gap</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="inputDef-periodRule">Period rule</Label>
          <Input id="inputDef-periodRule" name="periodRule" placeholder="Optional" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="required" defaultChecked /> Required for a complete review
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={upsertPending}>{upsertPending ? "Saving..." : "Save input definition"}</Button>
        </div>
      </form>
      <Feedback state={upsertState} />
      {deactivateState.error && <p role="alert" className="text-sm text-red-600">{deactivateState.error}</p>}
    </div>
  );
}

export function ManagementReviewWorkspace({
  reviews,
  templateOptions,
  inputDefinitionOptions,
  members,
  persons,
}: {
  reviews: ManagementReviewRow[];
  templateOptions: AgendaTemplateOption[];
  inputDefinitionOptions: InputDefinitionOption[];
  members: Option[];
  persons: Option[];
}) {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <Link href="/ems/management-reviews/agenda-templates" className="font-medium text-slate-900 underline underline-offset-2">
            Manage agenda templates
          </Link>{" "}
          — draft, approve, activate and version the agenda before scheduling a review against it.
        </p>
      </div>

      <ScheduleReviewForm templateOptions={templateOptions} members={members} />

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Review register</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-slate-500">No management reviews scheduled yet.</p>
        ) : (
          reviews.map((review) => (
            <ReviewCard key={review.id} review={review} inputDefinitionOptions={inputDefinitionOptions} persons={persons} />
          ))
        )}
      </div>

      <InputDefinitionsPanel options={inputDefinitionOptions} />
    </div>
  );
}
