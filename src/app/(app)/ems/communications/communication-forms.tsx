"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createCommunicationPlanAction,
  recordCommunicationAction,
  retireCommunicationPlanAction,
  uploadCommunicationEvidenceAction,
  type CommunicationActionState,
} from "./actions";

const emptyState: CommunicationActionState = { error: null, message: null };

type MemberOption = { id: string; name: string };
type DocumentOption = { id: string; label: string };
type RecordRow = {
  id: string;
  occurredAt: string;
  audience: string;
  parties: string;
  contentSummary: string;
  approverMembershipId: string | null;
  approvedAt: string | null;
  responseFollowUp: string | null;
};
type PlanRow = {
  id: string;
  subject: string;
  audience: string;
  triggerFrequency: string;
  method: string;
  approvalRequired: boolean;
  status: string;
  ownerName: string;
  records: RecordRow[];
};

function Feedback({ state }: { state: CommunicationActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function CreatePlan({ members }: { members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createCommunicationPlanAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add communication plan</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="comms-plan-subject">Subject</Label><Input id="comms-plan-subject" name="subject" required placeholder="Synthetic annual environmental update" /></div>
            <div><Label htmlFor="comms-plan-audience">Audience</Label><Select id="comms-plan-audience" name="audience" defaultValue="INTERNAL"><option value="INTERNAL">Internal</option><option value="EXTERNAL">External</option><option value="BOTH">Both</option></Select></div>
            <div><Label htmlFor="comms-plan-trigger-frequency">Trigger / frequency</Label><Input id="comms-plan-trigger-frequency" name="triggerFrequency" required placeholder="Annually" /></div>
            <div><Label htmlFor="comms-plan-method">Method</Label><Input id="comms-plan-method" name="method" required placeholder="Email bulletin" /></div>
            <div><Label htmlFor="comms-plan-owner">Responsible owner</Label><Select id="comms-plan-owner" name="ownerMembershipId" required defaultValue=""><option value="">Select…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></div>
            <div className="flex items-end gap-2"><Label className="flex items-center gap-2"><input type="checkbox" name="approvalRequired" value="true" className="h-4 w-4" /> Requires approval before use</Label></div>
            <div className="sm:col-span-2"><Label htmlFor="comms-plan-source-requirements">Source requirements (optional)</Label><Textarea id="comms-plan-source-requirements" name="sourceRequirements" rows={2} /></div>
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending || members.length === 0}>{pending ? "Creating…" : "Create plan"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RecordForm({ planId, audience, approvalRequired, members, documents }: { planId?: string; audience?: string; approvalRequired: boolean; members: MemberOption[]; documents: DocumentOption[] }) {
  const [state, action, pending] = useActionState(recordCommunicationAction, emptyState);
  const idPrefix = `comms-record-${planId ?? "adhoc"}`;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      {planId && <input type="hidden" name="planId" value={planId} />}
      <p className="text-sm font-medium">Record communication{approvalRequired ? " (approval required)" : ""}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`${idPrefix}-occurred-at`}>Occurred on</Label><Input id={`${idPrefix}-occurred-at`} name="occurredAt" type="date" required /></div>
        <div><Label htmlFor={`${idPrefix}-audience`}>Audience</Label><Select id={`${idPrefix}-audience`} name="audience" defaultValue={audience ?? "INTERNAL"}><option value="INTERNAL">Internal</option><option value="EXTERNAL">External</option><option value="BOTH">Both</option></Select></div>
      </div>
      <div><Label htmlFor={`${idPrefix}-parties`}>Parties / audience reached</Label><Input id={`${idPrefix}-parties`} name="parties" required /></div>
      <div><Label htmlFor={`${idPrefix}-content-summary`}>Content summary</Label><Textarea id={`${idPrefix}-content-summary`} name="contentSummary" rows={2} required /></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-content-revision`}>Approved content revision (optional)</Label><Select id={`${idPrefix}-content-revision`} name="approvedContentRevisionId" defaultValue=""><option value="">None</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.label}</option>)}</Select></div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`${idPrefix}-approver`}>Approved by</Label><Select id={`${idPrefix}-approver`} name="approverMembershipId" defaultValue=""><option value="">Not yet approved</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></div>
        <div><Label htmlFor={`${idPrefix}-approved-at`}>Approved on</Label><Input id={`${idPrefix}-approved-at`} name="approvedAt" type="date" /></div>
      </div>
      <div><Label htmlFor={`${idPrefix}-response-followup`}>Response / follow-up (optional)</Label><Textarea id={`${idPrefix}-response-followup`} name="responseFollowUp" rows={2} /></div>
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Record communication"}</Button>
    </form>
  );
}

function RecordItem({ record }: { record: RecordRow }) {
  const [state, action, pending] = useActionState(uploadCommunicationEvidenceAction, emptyState);
  return (
    <div className="rounded border border-slate-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge>{record.audience.toLowerCase()}</Badge><span>{new Date(record.occurredAt).toLocaleDateString()}</span>{record.approvedAt && <Badge tone="success">approved {new Date(record.approvedAt).toLocaleDateString()}</Badge>}</div>
      <p className="mt-1 text-slate-600">{record.parties}</p>
      <p className="mt-1 text-slate-600">{record.contentSummary}</p>
      {record.responseFollowUp && <p className="mt-1 text-slate-500">Follow-up: {record.responseFollowUp}</p>}
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="recordId" value={record.id} />
        <div><Label htmlFor={`comms-evidence-${record.id}`}>Attach evidence</Label><Input id={`comms-evidence-${record.id}`} name="file" type="file" required /></div>
        <Input name="purpose" placeholder="Purpose (optional)" />
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
        <Feedback state={state} />
      </form>
    </div>
  );
}

function PlanCard({ plan, members, documents, canManage }: { plan: PlanRow; members: MemberOption[]; documents: DocumentOption[]; canManage: boolean }) {
  const [retireState, retireAction, retiring] = useActionState(retireCommunicationPlanAction, emptyState);
  return (
    <Card>
      <CardContent id={`comms-${plan.id}`} className="scroll-mt-24 space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{plan.subject}</h3>
          <Badge>{plan.audience.toLowerCase()}</Badge>
          <Badge tone={plan.status === "ACTIVE" ? "success" : "neutral"}>{plan.status.toLowerCase()}</Badge>
          {plan.approvalRequired && <Badge tone="danger">approval required</Badge>}
        </div>
        <p className="text-sm text-slate-600">{plan.method} · {plan.triggerFrequency} · owner {plan.ownerName}</p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Records</p>
          {plan.records.length === 0 ? <p className="mt-1 text-sm text-slate-500">No communications recorded.</p> : <div className="mt-2 space-y-2">{plan.records.map((record) => <RecordItem key={record.id} record={record} />)}</div>}
        </div>
        {canManage && plan.status === "ACTIVE" && (
          <>
            <RecordForm planId={plan.id} audience={plan.audience} approvalRequired={plan.approvalRequired} members={members} documents={documents} />
            <form action={retireAction} onSubmit={(event) => { if (!window.confirm("Retire this plan?")) event.preventDefault(); }}>
              <input type="hidden" name="planId" value={plan.id} />
              <Button type="submit" variant="secondary" disabled={retiring}>{retiring ? "Retiring…" : "Retire plan"}</Button>
              <Feedback state={retireState} />
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CommunicationsWorkspace({ plans, members, documents, canManage }: { plans: PlanRow[]; members: MemberOption[]; documents: DocumentOption[]; canManage: boolean }) {
  return (
    <div className="space-y-8">
      {canManage && <CreatePlan members={members} />}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Communication plans</h2>
        {plans.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No communication plans yet.</CardContent></Card> : plans.map((plan) => <PlanCard key={plan.id} plan={plan} members={members} documents={documents} canManage={canManage} />)}
      </div>
      {canManage && (
        <Card>
          <CardHeader><CardTitle>Ad hoc communication (no plan)</CardTitle></CardHeader>
          <CardContent><RecordForm approvalRequired members={members} documents={documents} /></CardContent>
        </Card>
      )}
    </div>
  );
}
