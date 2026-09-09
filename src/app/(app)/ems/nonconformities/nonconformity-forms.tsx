"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createNonconformityFromSourceAction,
  linkAdditionalSourceAction,
  recordContainmentAction,
  reviewContainmentAdequacyAction,
  closeNonconformityAction,
  reopenNonconformityAction,
  createNonconformityClassificationAction,
  assignNonconformityClassificationAction,
  upsertNonconformityClosurePolicyAction,
  recordRootCauseAnalysisAction,
  approveRootCauseAnalysisAction,
  createCorrectiveActionAction,
  setCorrectiveActionStatusAction,
  completeCorrectiveActionAction,
  verifyCorrectiveActionAction,
  reopenCorrectiveActionAction,
  uploadCorrectiveActionEvidenceAction,
  requestEffectivenessReviewAction,
  performEffectivenessReviewAction,
  type NonconformityActionState,
} from "./actions";

const emptyState: NonconformityActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type NonconformityListRow = {
  id: string;
  reference: string;
  sourceType: string;
  status: string;
  requirementReference: string;
  createdAt: string;
  ownerName: string | null;
  overdue: boolean;
};

const SOURCE_TYPES = ["AUDIT_FINDING", "INCIDENT", "COMPLIANCE_EVALUATION_ITEM", "CONTROL_CHECK", "COMPLAINT", "MANUAL"] as const;
const ROOT_CAUSE_METHODS = ["FIVE_WHYS", "FISHBONE", "FAULT_TREE", "OTHER"] as const;

function correctiveActionTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "VERIFIED" || status === "COMPLETED") return "success";
  if (status === "CANCELLED") return "neutral";
  if (status === "REOPENED") return "warning";
  return "info";
}

function Feedback({ state }: { state: NonconformityActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export function CreateNonconformityForm({
  complianceObligations,
  operationalControls,
  classifications,
  members,
}: {
  complianceObligations: Option[];
  operationalControls: Option[];
  classifications: Option[];
  members: Option[];
}) {
  const [state, formAction, pending] = useActionState(createNonconformityFromSourceAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Create a nonconformity</h2>
        <p className="text-sm text-slate-500">
          Every nonconformity must record where it came from and which requirement it relates to. For a source with no
          record of its own (a complaint, or a manual observation) enter a reference note describing it instead.
        </p>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" required placeholder="NC-2026-004" />
          </div>
          <div>
            <Label htmlFor="sourceType">Source type</Label>
            <Select id="sourceType" name="sourceType" defaultValue="MANUAL">
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sourceId">Source record id</Label>
            <Input id="sourceId" name="sourceId" placeholder="Audit finding / incident / evaluation item / control check id" />
          </div>
          <div>
            <Label htmlFor="sourceReferenceNote">Source reference note</Label>
            <Input id="sourceReferenceNote" name="sourceReferenceNote" placeholder="Required for complaint/manual sources" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="statement">Statement</Label>
            <Textarea id="statement" name="statement" required rows={3} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="requirementReference">Requirement reference</Label>
            <Input id="requirementReference" name="requirementReference" required placeholder="Clause, obligation, or control this fails against" />
          </div>
          <div>
            <Label htmlFor="complianceObligationId">Compliance obligation (optional)</Label>
            <Select id="complianceObligationId" name="complianceObligationId" defaultValue="">
              <option value="">—</option>
              {complianceObligations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="operationalControlId">Operational control (optional)</Label>
            <Select id="operationalControlId" name="operationalControlId" defaultValue="">
              <option value="">—</option>
              {operationalControls.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="classificationId">Classification (optional)</Label>
            <Select id="classificationId" name="classificationId" defaultValue="">
              <option value="">—</option>
              {classifications.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ownerMembershipId">Owner (optional)</Label>
            <Select id="ownerMembershipId" name="ownerMembershipId" defaultValue="">
              <option value="">—</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="dueDate">Due date (optional)</Label>
            <Input id="dueDate" name="dueDate" type="date" />
          </div>
          <div className="sm:col-span-2">
            <Feedback state={state} />
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create nonconformity"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function NonconformityList({ nonconformities }: { nonconformities: NonconformityListRow[] }) {
  if (nonconformities.length === 0) return <p className="text-sm text-slate-500">No nonconformities recorded yet.</p>;
  return (
    <ul className="space-y-2">
      {nonconformities.map((nc) => (
        <li key={nc.id}>
          <Link href={`/ems/nonconformities/${nc.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
            <div>
              <p className="font-medium text-slate-900">{nc.reference}</p>
              <p className="text-sm text-slate-500">
                {nc.sourceType.replace(/_/g, " ")} · {nc.requirementReference}
                {nc.ownerName && ` · Owner: ${nc.ownerName}`}
                {nc.overdue && <span className="ml-1 font-semibold text-red-600">(overdue)</span>}
              </p>
            </div>
            <Badge>{nc.status}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function LinkAdditionalSourceForm({ nonconformityId }: { nonconformityId: string }) {
  const [state, formAction, pending] = useActionState(linkAdditionalSourceAction, emptyState);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <div>
        <Label htmlFor="link-sourceType">Additional source type</Label>
        <Select id="link-sourceType" name="sourceType" defaultValue="MANUAL">
          {SOURCE_TYPES.map((type) => (
            <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="link-sourceId">Source record id</Label>
        <Input id="link-sourceId" name="sourceId" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="link-sourceReferenceNote">Source reference note</Label>
        <Input id="link-sourceReferenceNote" name="sourceReferenceNote" placeholder="Required for complaint/manual sources" />
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Linking…" : "Link as duplicate source"}</Button>
      </div>
    </form>
  );
}

export function RecordContainmentForm({ nonconformityId, members }: { nonconformityId: string; members: Option[] }) {
  const [state, formAction, pending] = useActionState(recordContainmentAction, emptyState);
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <div className="sm:col-span-2">
        <Label htmlFor="actionTaken">Containment action taken</Label>
        <Textarea id="actionTaken" name="actionTaken" required rows={2} />
      </div>
      <div>
        <Label htmlFor="actionTakenAt">When</Label>
        <Input id="actionTakenAt" name="actionTakenAt" type="datetime-local" required />
      </div>
      <div>
        <Label htmlFor="containment-owner">Owner</Label>
        <Select id="containment-owner" name="ownerMembershipId" required defaultValue="">
          <option value="" disabled>Choose an owner</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Feedback state={state} />
        <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record containment"}</Button>
      </div>
    </form>
  );
}

export function ReviewContainmentAdequacyForm({ nonconformityId, containmentId }: { nonconformityId: string; containmentId: string }) {
  const [state, formAction, pending] = useActionState(reviewContainmentAdequacyAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <input type="hidden" name="containmentId" value={containmentId} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="adequate" className="h-4 w-4 rounded border-slate-300" /> Adequate
      </label>
      <Input name="notes" placeholder="Review notes" className="max-w-xs" />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save adequacy review"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function CloseNonconformityButton({ nonconformityId }: { nonconformityId: string }) {
  const [state, formAction, pending] = useActionState(closeNonconformityAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <Button type="submit" disabled={pending}>{pending ? "Closing…" : "Close nonconformity"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function ReopenNonconformityForm({ nonconformityId }: { nonconformityId: string }) {
  const [state, formAction, pending] = useActionState(reopenNonconformityAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <Input name="reason" required placeholder="Reason for reopening" className="max-w-xs" />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Reopening…" : "Reopen"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function AssignClassificationForm({ nonconformityId, classifications }: { nonconformityId: string; classifications: Option[] }) {
  const [state, formAction, pending] = useActionState(assignNonconformityClassificationAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="nonconformityId" value={nonconformityId} />
      <Select name="classificationId" required defaultValue="">
        <option value="" disabled>Choose classification</option>
        {classifications.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Saving…" : "Assign classification"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export type RootCauseAnalysisRow = {
  id: string;
  method: string;
  conclusion: string;
  approvedAt: string | null;
};

export function RootCauseSection({
  nonconformityId,
  analyses,
  canManage,
}: {
  nonconformityId: string;
  analyses: RootCauseAnalysisRow[];
  canManage: boolean;
}) {
  const [recordState, recordAction, recordPending] = useActionState(recordRootCauseAnalysisAction, emptyState);
  const [approveState, approveAction, approvePending] = useActionState(approveRootCauseAnalysisAction, emptyState);
  const hasApproved = analyses.some((a) => a.approvedAt);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Root cause analysis</h2>
        <p className="text-sm text-slate-500">
          Recording an analysis never implies approval — only an approved analysis moves the nonconformity forward.
        </p>
        <ul className="space-y-2 text-sm">
          {analyses.map((a) => (
            <li key={a.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{a.method.replace(/_/g, " ")}</span>
                {a.approvedAt ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Awaiting approval</Badge>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.conclusion}</p>
              {canManage && !a.approvedAt && (
                <form action={approveAction} className="mt-2">
                  <input type="hidden" name="rootCauseAnalysisId" value={a.id} />
                  <input type="hidden" name="nonconformityId" value={nonconformityId} />
                  <Button type="submit" size="sm" variant="secondary" disabled={approvePending}>{approvePending ? "Approving…" : "Approve"}</Button>
                </form>
              )}
            </li>
          ))}
          {analyses.length === 0 && <p className="text-slate-500">No root-cause analysis recorded yet.</p>}
        </ul>
        <Feedback state={approveState} />
        {canManage && !hasApproved && (
          <form action={recordAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="nonconformityId" value={nonconformityId} />
            <div>
              <Label htmlFor="rca-method">Method</Label>
              <Select id="rca-method" name="method" defaultValue="FIVE_WHYS">
                {ROOT_CAUSE_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rca-analysis">Analysis</Label>
              <Textarea id="rca-analysis" name="analysisPayload" required rows={3} placeholder="Synthetic example only." />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rca-contributors">Contributing factors (optional)</Label>
              <Input id="rca-contributors" name="contributors" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="rca-conclusion">Conclusion</Label>
              <Textarea id="rca-conclusion" name="conclusion" required rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Feedback state={recordState} />
              <Button type="submit" disabled={recordPending}>{recordPending ? "Recording…" : "Record root-cause analysis"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export type CorrectiveActionRow = {
  id: string;
  description: string;
  completionCriteria: string | null;
  ownerName: string;
  dueDate: string;
  overdue: boolean;
  status: string;
  completionEvidenceNote: string | null;
  reopenReason: string | null;
  evidence: { id: string; filename: string }[];
};

export function CorrectiveActionSection({
  nonconformityId,
  actions,
  members,
  canCreate,
  canManage,
}: {
  nonconformityId: string;
  actions: CorrectiveActionRow[];
  members: Option[];
  canCreate: boolean;
  canManage: boolean;
}) {
  const [createState, createFormAction, createPending] = useActionState(createCorrectiveActionAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Corrective actions</h2>
        <ul className="space-y-3 text-sm">
          {actions.map((action) => (
            <CorrectiveActionCard key={action.id} action={action} nonconformityId={nonconformityId} canManage={canManage} />
          ))}
          {actions.length === 0 && <p className="text-slate-500">No corrective actions yet.</p>}
        </ul>
        {canCreate && (
          <form action={createFormAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="nonconformityId" value={nonconformityId} />
            <div className="sm:col-span-2">
              <Label htmlFor="ca-description">Description</Label>
              <Textarea id="ca-description" name="description" required rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ca-criteria">Completion criteria (optional)</Label>
              <Input id="ca-criteria" name="completionCriteria" />
            </div>
            <div>
              <Label htmlFor="ca-owner">Owner</Label>
              <Select id="ca-owner" name="ownerMembershipId" required defaultValue="">
                <option value="" disabled>Choose an owner</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ca-due">Due date</Label>
              <Input id="ca-due" name="dueDate" type="date" required />
            </div>
            <div className="sm:col-span-2">
              <Feedback state={createState} />
              <Button type="submit" disabled={createPending}>{createPending ? "Creating…" : "Add corrective action"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function CorrectiveActionCard({ action, nonconformityId, canManage }: { action: CorrectiveActionRow; nonconformityId: string; canManage: boolean }) {
  const [statusState, statusAction, statusPending] = useActionState(setCorrectiveActionStatusAction, emptyState);
  const [cancelState, cancelAction, cancelPending] = useActionState(setCorrectiveActionStatusAction, emptyState);
  const [completeState, completeAction, completePending] = useActionState(completeCorrectiveActionAction, emptyState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyCorrectiveActionAction, emptyState);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenCorrectiveActionAction, emptyState);
  const [evidenceState, evidenceAction, evidencePending] = useActionState(uploadCorrectiveActionEvidenceAction, emptyState);

  return (
    <li className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-800">{action.description}</span>
        <Badge tone={correctiveActionTone(action.status)}>{action.status}</Badge>
      </div>
      <p className="text-slate-500">
        Owner: {action.ownerName} · Due {action.dueDate}
        {action.overdue && <span className="ml-1 font-semibold text-red-600">(overdue)</span>}
      </p>
      {action.completionCriteria && <p className="text-xs text-slate-500">Completion criteria: {action.completionCriteria}</p>}
      {action.completionEvidenceNote && <p className="text-xs text-slate-500">Completion evidence: {action.completionEvidenceNote}</p>}
      {action.reopenReason && <p className="text-xs text-amber-700">Reopened: {action.reopenReason}</p>}

      {action.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs">
          {action.evidence.map((e) => (
            <li key={e.id}>
              <a className="text-blue-600 hover:underline" href={`/api/ems/evidence/${e.id}`}>{e.filename}</a>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {["OPEN", "REOPENED"].includes(action.status) && (
            <form action={statusAction}>
              <input type="hidden" name="correctiveActionId" value={action.id} />
              <input type="hidden" name="nonconformityId" value={nonconformityId} />
              <input type="hidden" name="status" value="IN_PROGRESS" />
              <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>{statusPending ? "Saving…" : "Start"}</Button>
            </form>
          )}
          {["OPEN", "IN_PROGRESS", "REOPENED"].includes(action.status) && (
            <form action={cancelAction}>
              <input type="hidden" name="correctiveActionId" value={action.id} />
              <input type="hidden" name="nonconformityId" value={nonconformityId} />
              <input type="hidden" name="status" value="CANCELLED" />
              <Button type="submit" size="sm" variant="secondary" disabled={cancelPending}>{cancelPending ? "Cancelling…" : "Cancel"}</Button>
            </form>
          )}
          {["OPEN", "IN_PROGRESS", "REOPENED"].includes(action.status) && (
            <form action={completeAction} className="flex items-center gap-2">
              <input type="hidden" name="correctiveActionId" value={action.id} />
              <input type="hidden" name="nonconformityId" value={nonconformityId} />
              <Input name="completionEvidenceNote" placeholder="Completion evidence" className="w-56" required />
              <Button type="submit" size="sm" disabled={completePending}>{completePending ? "Completing…" : "Complete"}</Button>
            </form>
          )}
          {action.status === "COMPLETED" && (
            <form action={verifyAction}>
              <input type="hidden" name="correctiveActionId" value={action.id} />
              <input type="hidden" name="nonconformityId" value={nonconformityId} />
              <Button type="submit" size="sm" variant="secondary" disabled={verifyPending}>{verifyPending ? "Verifying…" : "Verify"}</Button>
            </form>
          )}
          {["COMPLETED", "VERIFIED", "CANCELLED"].includes(action.status) && (
            <form action={reopenAction} className="flex items-center gap-2">
              <input type="hidden" name="correctiveActionId" value={action.id} />
              <input type="hidden" name="nonconformityId" value={nonconformityId} />
              <Input name="reopenReason" placeholder="Reason for reopening" className="w-48" required />
              <Button type="submit" size="sm" variant="secondary" disabled={reopenPending}>{reopenPending ? "Reopening…" : "Reopen"}</Button>
            </form>
          )}
          <form action={evidenceAction} className="flex items-center gap-2">
            <input type="hidden" name="correctiveActionId" value={action.id} />
            <input type="hidden" name="nonconformityId" value={nonconformityId} />
            <input type="file" name="file" required className="text-xs" />
            <Button type="submit" size="sm" variant="secondary" disabled={evidencePending}>{evidencePending ? "Uploading…" : "Upload evidence"}</Button>
          </form>
        </div>
      )}
      <Feedback state={statusState} />
      <Feedback state={cancelState} />
      <Feedback state={completeState} />
      <Feedback state={verifyState} />
      <Feedback state={reopenState} />
      <Feedback state={evidenceState} />
    </li>
  );
}

export type EffectivenessReviewRow = {
  id: string;
  criteria: string;
  reviewDate: string;
  result: string;
  decision: string;
};

export function EffectivenessReviewSection({
  nonconformityId,
  reviewCycle,
  reviews,
  nonconformityStatus,
  canRequest,
  canReview,
}: {
  nonconformityId: string;
  reviewCycle: number;
  reviews: EffectivenessReviewRow[];
  nonconformityStatus: string;
  canRequest: boolean;
  canReview: boolean;
}) {
  const [requestState, requestAction, requestPending] = useActionState(requestEffectivenessReviewAction, emptyState);
  const [performState, performAction, performPending] = useActionState(performEffectivenessReviewAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Effectiveness review</h2>
        <p className="text-sm text-slate-500">
          A partially-effective or ineffective result never closes the nonconformity — it reopens the workflow instead.
        </p>
        <ul className="space-y-2 text-sm">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{r.reviewDate}</span>
                <Badge tone={r.result === "EFFECTIVE" ? "success" : "danger"}>{r.result.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-slate-700">{r.decision}</p>
            </li>
          ))}
          {reviews.length === 0 && <p className="text-slate-500">No effectiveness review recorded yet.</p>}
        </ul>
        {canRequest && nonconformityStatus === "ACTIONS_IN_PROGRESS" && (
          <form action={requestAction}>
            <input type="hidden" name="nonconformityId" value={nonconformityId} />
            <Feedback state={requestState} />
            <Button type="submit" disabled={requestPending}>{requestPending ? "Requesting…" : "Request effectiveness review"}</Button>
          </form>
        )}
        {canReview && nonconformityStatus === "EFFECTIVENESS_REVIEW" && (
          <form action={performAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="reviewCycle" value={reviewCycle} />
            <input type="hidden" name="nonconformityId" value={nonconformityId} />
            <div className="sm:col-span-2">
              <Label htmlFor="ev-criteria">Review criteria</Label>
              <Textarea id="ev-criteria" name="criteria" required rows={2} />
            </div>
            <div>
              <Label htmlFor="ev-date">Review date</Label>
              <Input id="ev-date" name="reviewDate" type="date" required />
            </div>
            <div>
              <Label htmlFor="ev-result">Result</Label>
              <Select id="ev-result" name="result" defaultValue="EFFECTIVE">
                <option value="EFFECTIVE">Effective</option>
                <option value="PARTIALLY_EFFECTIVE">Partially effective</option>
                <option value="INEFFECTIVE">Ineffective</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ev-decision">Decision</Label>
              <Textarea id="ev-decision" name="decision" required rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Feedback state={performState} />
              <Button type="submit" disabled={performPending}>{performPending ? "Saving…" : "Record effectiveness review"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function NonconformityPolicyWorkspace({
  classifications,
  policy,
}: {
  classifications: { id: string; key: string; label: string; rank: number }[];
  policy: { requireContainment: boolean; requireRootCauseApproval: boolean; requireCorrectiveActionsComplete: boolean; requireEffectivenessReview: boolean };
}) {
  const [classState, classAction, classPending] = useActionState(createNonconformityClassificationAction, emptyState);
  const [policyState, policyAction, policyPending] = useActionState(upsertNonconformityClosurePolicyAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Nonconformity configuration</h2>

        <div>
          <h3 className="text-sm font-semibold text-slate-700">Classifications</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {classifications.map((c) => <li key={c.id}>{c.rank}. {c.label} ({c.key})</li>)}
          </ul>
          <form action={classAction} className="mt-3 grid gap-2 sm:grid-cols-3">
            <Input name="key" placeholder="key" required />
            <Input name="label" placeholder="Label" required />
            <Input name="rank" type="number" placeholder="Rank" required />
            <div className="sm:col-span-3">
              <Feedback state={classState} />
              <Button type="submit" size="sm" variant="secondary" disabled={classPending}>{classPending ? "Adding…" : "Add classification"}</Button>
            </div>
          </form>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-700">Mandatory close steps</h3>
          <p className="text-sm text-slate-500">
            Each step enabled here is checked live, on every close attempt, against the actual root-cause, corrective
            action and effectiveness-review records below — closing fails with a specific reason whenever a required
            step is missing or incomplete.
          </p>
          <form action={policyAction} className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireContainment" defaultChecked={policy.requireContainment} className="h-4 w-4 rounded border-slate-300" /> Require adequate containment
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireRootCauseApproval" defaultChecked={policy.requireRootCauseApproval} className="h-4 w-4 rounded border-slate-300" /> Require root cause approval
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireCorrectiveActionsComplete" defaultChecked={policy.requireCorrectiveActionsComplete} className="h-4 w-4 rounded border-slate-300" /> Require corrective actions complete
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireEffectivenessReview" defaultChecked={policy.requireEffectivenessReview} className="h-4 w-4 rounded border-slate-300" /> Require effectiveness review
            </label>
            <Feedback state={policyState} />
            <Button type="submit" variant="secondary" disabled={policyPending}>{policyPending ? "Saving…" : "Save closure policy"}</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
