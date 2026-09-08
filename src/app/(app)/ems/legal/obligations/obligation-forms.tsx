"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createComplianceObligationAction,
  createSuccessorComplianceObligationVersionAction,
  decideComplianceObligationVersionAction,
  recordObligationChangeReviewAction,
  retireComplianceObligationVersionAction,
  submitComplianceObligationVersionForReviewAction,
  updateComplianceObligationVersionDraftAction,
  type ObligationActionState,
} from "./actions";

const emptyState: ObligationActionState = { error: null, message: null };

type Option = { id: string; name: string };

type ScopeSummary = { id: string; label: string; kind: "entity" | "site" | "aspect" };

export type ObligationVersionRow = {
  id: string;
  obligationId: string;
  version: number;
  status: string;
  title: string;
  requirementSummary: string;
  instrumentTitle: string;
  applicabilityAssessmentId: string;
  ownerName: string;
  frequency: string | null;
  effectiveFrom: string | null;
  reviewDueDate: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  supersedesVersionId: string | null;
  scopes: ScopeSummary[];
  approvals: Array<{ id: string; decision: string; comment: string | null; decidedAt: string }>;
  linkedControls: Array<{ id: string; label: string }>;
};

export type ObligationRow = {
  id: string;
  activeVersionId: string | null;
  versions: ObligationVersionRow[];
};

export type ChangeEventOption = { id: string; instrumentTitle: string };

function Feedback({ state }: { state: ObligationActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "RETIRED" || status === "SUPERSEDED") return "neutral";
  if (status === "IN_REVIEW" || status === "APPROVED") return "info";
  return "warning";
}

function ScopePicker({ uid, entities, sites, aspects }: { uid: string; entities: Option[]; sites: Option[]; aspects: Option[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <Label htmlFor={`entityIds-${uid}`}>Entities</Label>
        <select id={`entityIds-${uid}`} name="entityIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`siteIds-${uid}`}>Sites</Label>
        <select id={`siteIds-${uid}`} name="siteIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`aspectIds-${uid}`}>Aspects</Label>
        <select id={`aspectIds-${uid}`} name="aspectIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
          {aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}
        </select>
      </div>
      <p className="sm:col-span-3 text-xs text-slate-500">Select at least one scope (ctrl/cmd-click for multiple).</p>
    </div>
  );
}

function DraftFields({
  uid,
  entities,
  sites,
  aspects,
  controls,
  members,
}: {
  uid: string;
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`title-${uid}`}>Title</Label>
          <Input id={`title-${uid}`} name="title" required placeholder="Synthetic example: Discharge permit condition 4.2" />
        </div>
        <div>
          <Label htmlFor={`ownerMembershipId-${uid}`}>Owner</Label>
          <Select id={`ownerMembershipId-${uid}`} name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`frequency-${uid}`}>Frequency (optional)</Label>
          <Input id={`frequency-${uid}`} name="frequency" placeholder="e.g. Quarterly" />
        </div>
        <div>
          <Label htmlFor={`triggerDescription-${uid}`}>Trigger (optional)</Label>
          <Input id={`triggerDescription-${uid}`} name="triggerDescription" placeholder="e.g. Discharge volume change" />
        </div>
        <div>
          <Label htmlFor={`effectiveFrom-${uid}`}>Effective from (optional)</Label>
          <Input id={`effectiveFrom-${uid}`} name="effectiveFrom" type="date" />
        </div>
        <div>
          <Label htmlFor={`reviewDueDate-${uid}`}>Review due (optional)</Label>
          <Input id={`reviewDueDate-${uid}`} name="reviewDueDate" type="date" />
        </div>
      </div>
      <div>
        <Label htmlFor={`requirementSummary-${uid}`}>Requirement summary</Label>
        <Textarea id={`requirementSummary-${uid}`} name="requirementSummary" required rows={3} placeholder="Synthetic requirement text only." />
      </div>
      <ScopePicker uid={uid} entities={entities} sites={sites} aspects={aspects} />
      {controls.length > 0 && (
        <div>
          <Label htmlFor={`controlIds-${uid}`}>Operational controls (optional)</Label>
          <select id={`controlIds-${uid}`} name="controlIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {controls.map((control) => <option key={control.id} value={control.id}>{control.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function CreateObligationForm({
  applicabilityAssessmentId,
  entities,
  sites,
  aspects,
  controls,
  members,
}: {
  applicabilityAssessmentId: string;
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
}) {
  const [state, action, pending] = useActionState(createComplianceObligationAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="applicabilityAssessmentId" value={applicabilityAssessmentId} />
      <DraftFields uid={`create-${applicabilityAssessmentId}`} entities={entities} sites={sites} aspects={aspects} controls={controls} members={members} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft obligation"}</Button>
    </form>
  );
}

function EditDraftForm({
  version,
  entities,
  sites,
  aspects,
  controls,
  members,
}: {
  version: ObligationVersionRow;
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
}) {
  const [state, action, pending] = useActionState(updateComplianceObligationVersionDraftAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="obligationVersionId" value={version.id} />
      <DraftFields uid={`edit-${version.id}`} entities={entities} sites={sites} aspects={aspects} controls={controls} members={members} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
    </form>
  );
}

function SubmitForReviewButton({ obligationVersionId }: { obligationVersionId: string }) {
  const [state, action, pending] = useActionState(submitComplianceObligationVersionForReviewAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="obligationVersionId" value={obligationVersionId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function DecideForm({ obligationVersionId }: { obligationVersionId: string }) {
  const [state, action, pending] = useActionState(decideComplianceObligationVersionAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="obligationVersionId" value={obligationVersionId} />
      <div>
        <Label htmlFor={`decision-${obligationVersionId}`}>Decision</Label>
        <Select id={`decision-${obligationVersionId}`} name="decision" defaultValue="APPROVED" required>
          <option value="APPROVED">Approve (makes this version active)</option>
          <option value="REJECTED">Reject</option>
          <option value="RETURNED">Return for revision</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`comment-${obligationVersionId}`}>Comment (optional)</Label>
        <Textarea id={`comment-${obligationVersionId}`} name="comment" rows={2} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record decision"}</Button>
    </form>
  );
}

function RetireButton({ obligationVersionId }: { obligationVersionId: string }) {
  const [state, action, pending] = useActionState(retireComplianceObligationVersionAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="obligationVersionId" value={obligationVersionId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Retiring…" : "Retire this obligation"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function ChangeReviewForm({ obligationVersionId, changeEvents }: { obligationVersionId: string; changeEvents: ChangeEventOption[] }) {
  const [state, action, pending] = useActionState(recordObligationChangeReviewAction, emptyState);
  if (changeEvents.length === 0) return null;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="obligationVersionId" value={obligationVersionId} />
      <div>
        <Label htmlFor={`changeEventId-${obligationVersionId}`}>Legal change event</Label>
        <Select id={`changeEventId-${obligationVersionId}`} name="changeEventId" required defaultValue="">
          <option value="" disabled>Choose a change event</option>
          {changeEvents.map((event) => <option key={event.id} value={event.id}>{event.instrumentTitle}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor={`impactAssessment-${obligationVersionId}`}>Impact assessment</Label>
        <Textarea id={`impactAssessment-${obligationVersionId}`} name="impactAssessment" required rows={2} placeholder="Synthetic example only." />
      </div>
      <div>
        <Label htmlFor={`changeReviewDecision-${obligationVersionId}`}>Recommended follow-up (optional)</Label>
        <Select id={`changeReviewDecision-${obligationVersionId}`} name="decision" defaultValue="">
          <option value="">Not yet decided</option>
          <option value="NO_CHANGE">No change needed</option>
          <option value="REVISE">Revise obligation</option>
          <option value="RETIRE">Retire obligation</option>
          <option value="SEEK_ADVICE">Seek advice</option>
        </Select>
      </div>
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Record change review"}</Button>
    </form>
  );
}

function SuccessorForm({
  obligationId,
  versionId,
  applicabilityAssessmentId,
  entities,
  sites,
  aspects,
  controls,
  members,
}: {
  obligationId: string;
  versionId: string;
  applicabilityAssessmentId: string;
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
}) {
  const [state, action, pending] = useActionState(createSuccessorComplianceObligationVersionAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="obligationId" value={obligationId} />
      <input type="hidden" name="applicabilityAssessmentId" value={applicabilityAssessmentId} />
      <DraftFields uid={`successor-${versionId}`} entities={entities} sites={sites} aspects={aspects} controls={controls} members={members} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create successor draft"}</Button>
    </form>
  );
}

function VersionCard({
  version,
  obligationId,
  entities,
  sites,
  aspects,
  controls,
  members,
  changeEvents,
  canEdit,
  canApprove,
  defaultAssessmentId,
}: {
  version: ObligationVersionRow;
  obligationId: string;
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
  changeEvents: ChangeEventOption[];
  canEdit: boolean;
  canApprove: boolean;
  defaultAssessmentId: string;
}) {
  return (
    <Card>
      <CardContent id={`obligation-version-${version.id}`} className="scroll-mt-24 space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">v{version.version} · {version.title}</p>
            <p className="text-xs text-slate-500">
              {version.instrumentTitle} · owner {version.ownerName}
              {version.approvedByUserId ? ` · approved by ${version.approvedByUserId}` : ""}
              {" · "}
              <a href={`/ems/legal/applicability#assessment-${version.applicabilityAssessmentId}`} className="text-blue-700 underline">
                source assessment
              </a>
            </p>
          </div>
          <Badge tone={statusTone(version.status)}>{version.status}</Badge>
        </div>
        <p className="text-sm text-slate-600">{version.requirementSummary}</p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scopes</p>
          {version.scopes.length === 0 ? (
            <p className="mt-1 text-sm text-amber-700">No scopes recorded.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1">
              {version.scopes.map((scope) => (
                <li key={scope.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{scope.kind}: {scope.label}</li>
              ))}
            </ul>
          )}
        </div>
        {version.linkedControls.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked controls</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {version.linkedControls.map((control) => (
                <li key={control.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">
                  <a href={`/ems/controls#control-${control.id}`} className="text-blue-700 underline">{control.label}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {version.approvals.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval history</p>
            <ul className="mt-1 space-y-1 text-xs text-slate-600">
              {version.approvals.map((approval) => (
                <li key={approval.id}>
                  {approval.decision} · {new Date(approval.decidedAt).toLocaleString("en-GB")}
                  {approval.comment ? ` · ${approval.comment}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {version.status === "DRAFT" && canEdit && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit draft</summary>
            <div className="mt-3">
              <EditDraftForm version={version} entities={entities} sites={sites} aspects={aspects} controls={controls} members={members} />
            </div>
          </details>
        )}
        {version.status === "DRAFT" && canEdit && <SubmitForReviewButton obligationVersionId={version.id} />}
        {version.status === "IN_REVIEW" && canApprove && (
          <details open>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Decide</summary>
            <div className="mt-3"><DecideForm obligationVersionId={version.id} /></div>
          </details>
        )}
        {version.status === "ACTIVE" && canApprove && <RetireButton obligationVersionId={version.id} />}
        {version.status === "ACTIVE" && canEdit && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Create successor version</summary>
            <div className="mt-3">
              <SuccessorForm
                obligationId={obligationId}
                versionId={version.id}
                applicabilityAssessmentId={defaultAssessmentId}
                entities={entities}
                sites={sites}
                aspects={aspects}
                controls={controls}
                members={members}
              />
            </div>
          </details>
        )}
        {(version.status === "ACTIVE" || version.status === "APPROVED") && canEdit && changeEvents.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Record obligation-change review</summary>
            <div className="mt-3"><ChangeReviewForm obligationVersionId={version.id} changeEvents={changeEvents} /></div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export function ObligationWorkspace({
  applicableAssessments,
  obligations,
  entities,
  sites,
  aspects,
  controls,
  members,
  changeEvents,
  canEdit,
  canApprove,
}: {
  applicableAssessments: Array<{ id: string; instrumentTitle: string }>;
  obligations: ObligationRow[];
  entities: Option[];
  sites: Option[];
  aspects: Option[];
  controls: Option[];
  members: Option[];
  changeEvents: ChangeEventOption[];
  canEdit: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="space-y-8">
      {canEdit && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Create a compliance obligation</h2>
          {applicableAssessments.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-slate-500">No APPLICABLE assessment is available yet — record one on the applicability page first.</CardContent></Card>
          ) : (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-blue-700">From an applicable assessment</summary>
              <div className="mt-3 space-y-4">
                {applicableAssessments.map((assessment) => (
                  <details key={assessment.id}>
                    <summary className="cursor-pointer text-sm text-slate-700">{assessment.instrumentTitle}</summary>
                    <div className="mt-3">
                      <CreateObligationForm
                        applicabilityAssessmentId={assessment.id}
                        entities={entities}
                        sites={sites}
                        aspects={aspects}
                        controls={controls}
                        members={members}
                      />
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Compliance obligations</h2>
        {obligations.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No compliance obligations yet.</CardContent></Card>
        ) : (
          obligations.map((obligation) => (
            <div key={obligation.id} className="space-y-3">
              {obligation.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  obligationId={obligation.id}
                  entities={entities}
                  sites={sites}
                  aspects={aspects}
                  controls={controls}
                  members={members}
                  changeEvents={changeEvents}
                  canEdit={canEdit}
                  canApprove={canApprove}
                  defaultAssessmentId={version.applicabilityAssessmentId}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
