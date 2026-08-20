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
};

const SOURCE_TYPES = ["AUDIT_FINDING", "INCIDENT", "COMPLIANCE_EVALUATION_ITEM", "CONTROL_CHECK", "COMPLAINT", "MANUAL"] as const;

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
              <p className="text-sm text-slate-500">{nc.sourceType.replace(/_/g, " ")} · {nc.requirementReference}</p>
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
            Root cause approval, corrective actions and effectiveness review are not yet implemented — enabling them here
            blocks closing entirely until that workflow (T64) exists.
          </p>
          <form action={policyAction} className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireContainment" defaultChecked={policy.requireContainment} className="h-4 w-4 rounded border-slate-300" /> Require adequate containment
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireRootCauseApproval" defaultChecked={policy.requireRootCauseApproval} className="h-4 w-4 rounded border-slate-300" /> Require root cause approval (T64)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireCorrectiveActionsComplete" defaultChecked={policy.requireCorrectiveActionsComplete} className="h-4 w-4 rounded border-slate-300" /> Require corrective actions complete (T64)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="requireEffectivenessReview" defaultChecked={policy.requireEffectivenessReview} className="h-4 w-4 rounded border-slate-300" /> Require effectiveness review (T64)
            </label>
            <Feedback state={policyState} />
            <Button type="submit" variant="secondary" disabled={policyPending}>{policyPending ? "Saving…" : "Save closure policy"}</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
