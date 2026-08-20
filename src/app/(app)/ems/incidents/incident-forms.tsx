"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createEnvironmentalIncidentAction,
  assignIncidentSeverityAction,
  recordIncidentCorrectionAction,
  recordIncidentNotificationAssessmentAction,
  startIncidentInvestigationAction,
  completeIncidentResponseAction,
  closeEnvironmentalIncidentAction,
  reopenEnvironmentalIncidentAction,
  uploadIncidentEvidenceAction,
  createIncidentSeverityLevelAction,
  upsertIncidentEscalationRuleAction,
  type IncidentActionState,
} from "./actions";

const emptyState: IncidentActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type IncidentListRow = {
  id: string;
  reference: string;
  type: string;
  status: string;
  restricted: boolean;
  reportedAt: string;
};

function Feedback({ state }: { state: IncidentActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export function CreateIncidentForm({ entities, sites, processes, aspects }: { entities: Option[]; sites: Option[]; processes: Option[]; aspects: Option[] }) {
  const [state, formAction, pending] = useActionState(createEnvironmentalIncidentAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Report an incident</h2>
        <p className="text-sm text-slate-500">
          Capture the facts as first reported. Severity, notification decisions, and any correction to these facts
          are recorded separately once the incident exists — reporting here never concludes legal reportability.
        </p>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="reference">Reference</Label>
            <Input id="reference" name="reference" required placeholder="INC-2026-014" />
          </div>
          <div>
            <Label htmlFor="type">Type</Label>
            <Input id="type" name="type" required placeholder="Spill, near miss, permit exceedance…" />
          </div>
          <div>
            <Label htmlFor="occurredAt">Occurred at</Label>
            <Input id="occurredAt" name="occurredAt" type="datetime-local" />
          </div>
          <div>
            <Label htmlFor="discoveredAt">Discovered at</Label>
            <Input id="discoveredAt" name="discoveredAt" type="datetime-local" />
          </div>
          <div>
            <Label htmlFor="entityId">Entity</Label>
            <Select id="entityId" name="entityId" defaultValue="">
              <option value="">—</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="siteId">Site</Label>
            <Select id="siteId" name="siteId" defaultValue="">
              <option value="">—</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="processId">Process</Label>
            <Select id="processId" name="processId" defaultValue="">
              <option value="">—</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="aspectId">Aspect</Label>
            <Select id="aspectId" name="aspectId" defaultValue="">
              <option value="">—</option>
              {aspects.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="factualDescription">What happened (facts only)</Label>
            <Textarea id="factualDescription" name="factualDescription" required rows={3} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="immediateResponse">Immediate response taken</Label>
            <Textarea id="immediateResponse" name="immediateResponse" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="potentialReceptors">Potential receptors affected</Label>
            <Textarea id="potentialReceptors" name="potentialReceptors" rows={2} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <input id="restricted" name="restricted" type="checkbox" className="h-4 w-4 rounded border-slate-300" />
            <Label htmlFor="restricted" className="!mb-0">
              Mark as restricted/sensitive — only reporters and members with restricted-incident access can view it
            </Label>
          </div>
          <div className="sm:col-span-2">
            <Feedback state={state} />
            <Button type="submit" disabled={pending}>{pending ? "Reporting…" : "Report incident"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function IncidentList({ incidents }: { incidents: IncidentListRow[] }) {
  if (incidents.length === 0) {
    return <p className="text-sm text-slate-500">No incidents visible to you yet.</p>;
  }
  return (
    <div className="space-y-2">
      {incidents.map((incident) => (
        <Link
          key={incident.id}
          href={`/ems/incidents/${incident.id}`}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300"
        >
          <div>
            <p className="font-medium text-slate-900">{incident.reference}</p>
            <p className="text-sm text-slate-500">{incident.type} · reported {incident.reportedAt}</p>
          </div>
          <div className="flex items-center gap-2">
            {incident.restricted && <Badge tone="warning">Restricted</Badge>}
            <Badge>{incident.status}</Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}

export type SeverityLevelOption = { id: string; key: string; label: string; rank: number };

export function AssignSeverityForm({ incidentId, levels, currentLabel }: { incidentId: string; levels: SeverityLevelOption[]; currentLabel: string | null }) {
  const [state, formAction, pending] = useActionState(assignIncidentSeverityAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div>
        <Label htmlFor="severityLevelId">Severity {currentLabel ? `(current: ${currentLabel})` : ""}</Label>
        <Select id="severityLevelId" name="severityLevelId" defaultValue="" required>
          <option value="">Choose…</option>
          {levels.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Assign severity"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function StatusTransitionButton({
  incidentId,
  action,
  label,
  extraFields,
}: {
  incidentId: string;
  action: (state: IncidentActionState, formData: FormData) => Promise<IncidentActionState>;
  label: string;
  extraFields?: { name: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      {extraFields?.map((field) => (
        <div key={field.name}>
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input id={field.name} name={field.name} required className="w-64" />
        </div>
      ))}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Working…" : label}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function StartInvestigationButton({ incidentId }: { incidentId: string }) {
  return <StatusTransitionButton incidentId={incidentId} action={startIncidentInvestigationAction} label="Start investigation" />;
}

export function CompleteResponseButton({ incidentId }: { incidentId: string }) {
  return <StatusTransitionButton incidentId={incidentId} action={completeIncidentResponseAction} label="Mark response complete" />;
}

export function CloseIncidentButton({ incidentId }: { incidentId: string }) {
  return <StatusTransitionButton incidentId={incidentId} action={closeEnvironmentalIncidentAction} label="Close incident" />;
}

export function ReopenIncidentButton({ incidentId }: { incidentId: string }) {
  return (
    <StatusTransitionButton
      incidentId={incidentId}
      action={reopenEnvironmentalIncidentAction}
      label="Reopen"
      extraFields={[{ name: "reason", label: "Reopen reason" }]}
    />
  );
}

export function IncidentCorrectionForm({ incidentId }: { incidentId: string }) {
  const [state, formAction, pending] = useActionState(recordIncidentCorrectionAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-base font-semibold text-slate-900">Record a correction</h3>
        <p className="text-sm text-slate-500">
          The original report is never overwritten — a correction is appended with a reason, and both remain visible.
        </p>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="incidentId" value={incidentId} />
          <div>
            <Label htmlFor="correctedFactualDescription">Corrected facts</Label>
            <Textarea id="correctedFactualDescription" name="correctedFactualDescription" rows={2} />
          </div>
          <div>
            <Label htmlFor="correctedImmediateResponse">Corrected immediate response</Label>
            <Textarea id="correctedImmediateResponse" name="correctedImmediateResponse" rows={2} />
          </div>
          <div>
            <Label htmlFor="correctedPotentialReceptors">Corrected potential receptors</Label>
            <Textarea id="correctedPotentialReceptors" name="correctedPotentialReceptors" rows={2} />
          </div>
          <div>
            <Label htmlFor="reason">Reason for correction</Label>
            <Textarea id="reason" name="reason" required rows={2} />
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record correction"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function NotificationAssessmentForm({ incidentId, reviewers }: { incidentId: string; reviewers: Option[] }) {
  const [state, formAction, pending] = useActionState(recordIncidentNotificationAssessmentAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-base font-semibold text-slate-900">Notification / reportability assessment</h3>
        <p className="text-sm text-slate-500">
          This is always a human decision by a named competent reviewer — the system never concludes legal
          reportability automatically.
        </p>
        <form action={formAction} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="incidentId" value={incidentId} />
          <div>
            <Label htmlFor="authorityOrParty">Authority / party</Label>
            <Input id="authorityOrParty" name="authorityOrParty" required />
          </div>
          <div>
            <Label htmlFor="dueTrigger">Due trigger</Label>
            <Input id="dueTrigger" name="dueTrigger" />
          </div>
          <div>
            <Label htmlFor="decision">Decision</Label>
            <Select id="decision" name="decision" defaultValue="UNCERTAIN" required>
              <option value="NOT_REQUIRED">Not required</option>
              <option value="REQUIRED">Required</option>
              <option value="UNCERTAIN">Uncertain</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="reviewerMembershipId">Competent reviewer</Label>
            <Select id="reviewerMembershipId" name="reviewerMembershipId" defaultValue="" required>
              <option value="">Choose…</option>
              {reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="rationale">Rationale</Label>
            <Textarea id="rationale" name="rationale" required rows={3} />
          </div>
          <div className="sm:col-span-2">
            <Feedback state={state} />
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record assessment"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function IncidentEvidenceUploadForm({ incidentId }: { incidentId: string }) {
  const [state, formAction, pending] = useActionState(uploadIncidentEvidenceAction, emptyState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div>
        <Label htmlFor="file">Evidence file</Label>
        <input id="file" name="file" type="file" className="block text-sm" required />
      </div>
      <div>
        <Label htmlFor="purpose">Purpose (optional)</Label>
        <Input id="purpose" name="purpose" className="w-64" />
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload evidence"}</Button>
      <Feedback state={state} />
    </form>
  );
}

const NOTIFY_PERMISSION_OPTIONS = [
  { value: "ems.incident.manage", label: "Anyone who manages incidents" },
  { value: "ems.incident.restricted.view", label: "Restricted-incident reviewers only" },
];

export function IncidentPolicyWorkspace({ severityLevels }: { severityLevels: SeverityLevelOption[] }) {
  const [levelState, levelAction, levelPending] = useActionState(createIncidentSeverityLevelAction, emptyState);
  const [ruleState, ruleAction, rulePending] = useActionState(upsertIncidentEscalationRuleAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Severity levels and escalation rules</h2>
          <p className="text-sm text-slate-500">
            Configure your own severity scale and who is notified at each level. Assigning severity to an incident
            freezes a copy of the level in effect at that moment, so editing this later never rewrites past incidents.
          </p>
        </div>
        <form action={levelAction} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="key">Key</Label>
            <Input id="key" name="key" required placeholder="major" />
          </div>
          <div>
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" required placeholder="Major" />
          </div>
          <div>
            <Label htmlFor="rank">Rank</Label>
            <Input id="rank" name="rank" type="number" required defaultValue={0} />
          </div>
          <div className="flex items-center gap-2">
            <input id="requiresEscalation" name="requiresEscalation" type="checkbox" className="h-4 w-4 rounded border-slate-300" />
            <Label htmlFor="requiresEscalation" className="!mb-0">Requires escalation</Label>
          </div>
          <div className="sm:col-span-4">
            <Feedback state={levelState} />
            <Button type="submit" disabled={levelPending}>{levelPending ? "Adding…" : "Add severity level"}</Button>
          </div>
        </form>

        {severityLevels.length > 0 && (
          <form action={ruleAction} className="grid gap-3 sm:grid-cols-3 sm:items-end border-t border-slate-200 pt-4">
            <div>
              <Label htmlFor="severityLevelId">Severity level</Label>
              <Select id="severityLevelId" name="severityLevelId" defaultValue="" required>
                <option value="">Choose…</option>
                {severityLevels.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="notifyPermission">Notify</Label>
              <Select id="notifyPermission" name="notifyPermission" defaultValue="">
                <option value="">Choose…</option>
                {NOTIFY_PERMISSION_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input id="isActive" name="isActive" type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300" />
              <Label htmlFor="isActive" className="!mb-0">Active</Label>
            </div>
            <div className="sm:col-span-3">
              <Feedback state={ruleState} />
              <Button type="submit" disabled={rulePending}>{rulePending ? "Saving…" : "Save escalation rule"}</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
