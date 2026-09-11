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
  createControlAction,
  notifyOverdueReviewsAction,
  recordControlCheckAction,
  retireControlAction,
  reviseControlAction,
  uploadControlCheckEvidenceAction,
  type ControlActionState,
} from "./actions";

const emptyState: ControlActionState = { error: null, message: null };
const CONTROL_TYPES = ["ENGINEERING", "PROCEDURAL", "MONITORING", "COMPETENCE", "PROCUREMENT", "EMERGENCY", "OTHER"] as const;

type AspectOption = { id: string; name: string; processId: string; processName: string };
type MemberOption = { id: string; name: string };
type DocumentOption = { id: string; label: string };
type CheckRow = {
  id: string;
  scheduledAt: string;
  performedAt: string | null;
  result: string;
  notes: string | null;
  exceptionSummary: string | null;
  actionReference: string | null;
  evidence: Array<{ id: string; filename: string }>;
};
type ControlRow = {
  id: string;
  controlKey: string;
  version: number;
  title: string;
  type: string;
  status: string;
  description: string | null;
  frequency: string | null;
  acceptanceCriteria: string | null;
  effectivenessCriteria: string | null;
  ownerMembershipId: string;
  ownerName: string;
  controlledDocumentRevisionId: string | null;
  documentLabel: string | null;
  reviewDueDate: string;
  reviewOverdue: boolean;
  reviewedAt: string | null;
  supersedesControlId: string | null;
  aspectIds: string[];
  aspects: Array<{ id: string; name: string }>;
  applicabilityProcessId: string | null;
  externalProviderReference: string | null;
  checks: CheckRow[];
};

function Feedback({ state }: { state: ControlActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function ControlFields({ idPrefix, control, aspects, members, documents }: {
  idPrefix: string;
  control?: ControlRow;
  aspects: AspectOption[];
  members: MemberOption[];
  documents: DocumentOption[];
}) {
  const processOptions = [...new Map(aspects.map((aspect) => [aspect.processId, { id: aspect.processId, name: aspect.processName }])).values()];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label htmlFor={`${idPrefix}-control-key`}>Control key</Label><Input id={`${idPrefix}-control-key`} name="controlKey" required readOnly={Boolean(control)} defaultValue={control?.controlKey} placeholder="synthetic-control-01" /></div>
      <div><Label htmlFor={`${idPrefix}-title`}>Title</Label><Input id={`${idPrefix}-title`} name="title" required defaultValue={control?.title} placeholder="Synthetic material handling control" /></div>
      <div><Label htmlFor={`${idPrefix}-type`}>Control type</Label><Select id={`${idPrefix}-type`} name="type" defaultValue={control?.type ?? "PROCEDURAL"}>{CONTROL_TYPES.map((type) => <option key={type} value={type}>{type.toLowerCase()}</option>)}</Select></div>
      <div><Label htmlFor={`${idPrefix}-owner`}>Responsible owner</Label><Select id={`${idPrefix}-owner`} name="ownerMembershipId" required defaultValue={control?.ownerMembershipId ?? ""}><option value="">Select…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></div>
      <div><Label htmlFor={`${idPrefix}-frequency`}>Frequency</Label><Input id={`${idPrefix}-frequency`} name="frequency" required defaultValue={control?.frequency ?? ""} placeholder="Before each synthetic run" /></div>
      <div><Label htmlFor={`${idPrefix}-review-due`}>Review due</Label><Input id={`${idPrefix}-review-due`} name="reviewDueDate" type="date" required defaultValue={control ? dateInputValue(control.reviewDueDate) : ""} /></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-aspect-ids`}>Linked aspects (Ctrl/Cmd to select multiple)</Label><Select id={`${idPrefix}-aspect-ids`} name="aspectIds" multiple required defaultValue={control?.aspectIds ?? []} className="min-h-28">{aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name} — {aspect.processName}</option>)}</Select></div>
      <div><Label htmlFor={`${idPrefix}-applicability-process`}>Process applicability (optional)</Label><Select id={`${idPrefix}-applicability-process`} name="applicabilityProcessId" defaultValue={control?.applicabilityProcessId ?? ""}><option value="">Covered by linked aspects</option>{processOptions.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}</Select></div>
      <div><Label htmlFor={`${idPrefix}-external-provider`}>External-provider reference (optional)</Label><Input id={`${idPrefix}-external-provider`} name="externalProviderReference" defaultValue={control?.externalProviderReference ?? ""} placeholder="Synthetic provider reference only" /></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-document-revision`}>Controlled procedure revision (optional)</Label><Select id={`${idPrefix}-document-revision`} name="controlledDocumentRevisionId" defaultValue={control?.controlledDocumentRevisionId ?? ""}><option value="">No controlled-document revision</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.label}</option>)}</Select></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-description`}>Description</Label><Textarea id={`${idPrefix}-description`} name="description" rows={2} defaultValue={control?.description ?? ""} /></div>
      <div><Label htmlFor={`${idPrefix}-acceptance-criteria`}>Acceptance criteria</Label><Textarea id={`${idPrefix}-acceptance-criteria`} name="acceptanceCriteria" rows={3} required defaultValue={control?.acceptanceCriteria ?? ""} /></div>
      <div><Label htmlFor={`${idPrefix}-effectiveness-criteria`}>Effectiveness criteria</Label><Textarea id={`${idPrefix}-effectiveness-criteria`} name="effectivenessCriteria" rows={3} required defaultValue={control?.effectivenessCriteria ?? ""} /></div>
    </div>
  );
}

function CreateControl({ aspects, members, documents }: { aspects: AspectOption[]; members: MemberOption[]; documents: DocumentOption[] }) {
  const [state, action, pending] = useActionState(createControlAction, emptyState);
  return <Card><CardHeader><CardTitle>Add operational control</CardTitle></CardHeader><CardContent><form action={action} className="space-y-4"><ControlFields idPrefix="control-new" aspects={aspects} members={members} documents={documents} /><Feedback state={state} /><Button type="submit" disabled={pending || aspects.length === 0 || members.length === 0}>{pending ? "Creating…" : "Create control"}</Button></form></CardContent></Card>;
}

function ReviewCycleButton() {
  const [state, action, pending] = useActionState(notifyOverdueReviewsAction, emptyState);
  return <form action={action} className="space-y-2"><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Checking…" : "Check overdue reviews"}</Button><Feedback state={state} /></form>;
}

function CheckForm({ controlId }: { controlId: string }) {
  const [state, action, pending] = useActionState(recordControlCheckAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="controlId" value={controlId} />
      <p className="text-sm font-medium">Record control check</p>
      <div className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor={`check-scheduled-${controlId}`}>Scheduled</Label><Input id={`check-scheduled-${controlId}`} name="scheduledAt" type="date" required /></div><div><Label htmlFor={`check-performed-${controlId}`}>Performed</Label><Input id={`check-performed-${controlId}`} name="performedAt" type="date" /></div><div><Label htmlFor={`check-result-${controlId}`}>Result</Label><Select id={`check-result-${controlId}`} name="result" defaultValue="PASS"><option value="PENDING">Pending</option><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="NOT_APPLICABLE">Not applicable</option></Select></div></div>
      <div><Label htmlFor={`check-notes-${controlId}`}>Notes</Label><Input id={`check-notes-${controlId}`} name="notes" /></div>
      <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor={`check-exception-${controlId}`}>Exception summary (required for fail)</Label><Input id={`check-exception-${controlId}`} name="exceptionSummary" /></div><div><Label htmlFor={`check-action-ref-${controlId}`}>Action reference</Label><Input id={`check-action-ref-${controlId}`} name="actionReference" placeholder="Explicit reference; no action is auto-created" /></div></div>
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Record check"}</Button>
    </form>
  );
}

function CheckHistory({ checks, canManage }: { checks: CheckRow[]; canManage: boolean }) {
  return <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checks</p>{checks.length === 0 ? <p className="mt-1 text-sm text-slate-500">No checks recorded.</p> : <div className="mt-2 space-y-2">{checks.map((check) => <CheckItem key={check.id} check={check} canManage={canManage} />)}</div>}</div>;
}

function CheckItem({ check, canManage }: { check: CheckRow; canManage: boolean }) {
  const [state, action, pending] = useActionState(uploadControlCheckEvidenceAction, emptyState);
  const tone = check.result === "FAIL" ? "danger" : check.result === "PASS" ? "success" : "neutral";
  return <div className="rounded border border-slate-200 p-2 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{check.result.toLowerCase().replaceAll("_", " ")}</Badge><span>Scheduled {new Date(check.scheduledAt).toLocaleDateString()}</span>{check.performedAt && <span>· performed {new Date(check.performedAt).toLocaleDateString()}</span>}</div>{check.notes && <p className="mt-1 text-slate-600">{check.notes}</p>}{check.exceptionSummary && <p className="mt-1 text-amber-700">Exception: {check.exceptionSummary}</p>}{check.actionReference && <p className="mt-1 text-slate-600">Action reference: {check.actionReference}</p>}{check.evidence.length > 0 && <p className="mt-1 text-slate-500">Evidence: {check.evidence.map((item) => item.filename).join(", ")}</p>}{canManage && <form action={action} className="mt-2 flex flex-wrap items-end gap-2"><input type="hidden" name="checkId" value={check.id} /><div><Label htmlFor={`check-evidence-${check.id}`}>Attach evidence</Label><Input id={`check-evidence-${check.id}`} name="file" type="file" required /></div><Input aria-label="Purpose (optional)" name="purpose" placeholder="Purpose (optional)" /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button><Feedback state={state} /></form>}</div>;
}

function ControlCard({ control, aspects, members, documents, canManage }: { control: ControlRow; aspects: AspectOption[]; members: MemberOption[]; documents: DocumentOption[]; canManage: boolean }) {
  const [reviewState, reviewAction, reviewing] = useActionState(reviseControlAction, emptyState);
  const [retireState, retireAction, retiring] = useActionState(retireControlAction, emptyState);
  const overdue = control.reviewOverdue;
  return <Card><CardContent id={`control-${control.id}`} className="scroll-mt-24 space-y-4 py-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{control.title}</h3><Badge>{control.controlKey} v{control.version}</Badge><Badge tone={control.status === "ACTIVE" ? "success" : "neutral"}>{control.status.toLowerCase()}</Badge>{overdue && <Badge tone="danger">review overdue</Badge>}<a href={`/ems/controls?record=${control.id}#control-${control.id}`} className="text-xs font-medium text-blue-700 underline">View connected chain</a></div><p className="mt-1 text-sm text-slate-600">{control.type.toLowerCase()} · owner {control.ownerName} · review {new Date(control.reviewDueDate).toLocaleDateString()}</p></div></div>{control.description && <p className="text-sm text-slate-600">{control.description}</p>}<div className="grid gap-3 text-sm sm:grid-cols-2"><p><strong>Aspects:</strong> {control.aspects.map((aspect, index) => <span key={aspect.id}>{index > 0 && ", "}<a href={`/ems/aspects#aspect-${aspect.id}`} className="text-blue-700 underline">{aspect.name}</a></span>)}</p><p><strong>Frequency:</strong> {control.frequency || "Not recorded"}</p><p><strong>Acceptance:</strong> {control.acceptanceCriteria || "Not recorded"}</p><p><strong>Effectiveness:</strong> {control.effectivenessCriteria || "Not recorded"}</p>{control.documentLabel && <p><strong>Procedure:</strong> {control.documentLabel}</p>}{control.externalProviderReference && <p><strong>Provider reference:</strong> {control.externalProviderReference}</p>}</div><CheckHistory checks={control.checks} canManage={canManage} />{canManage && control.status === "ACTIVE" && <><CheckForm controlId={control.id} /><details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Review and create successor version</summary><form action={reviewAction} className="mt-4 space-y-4"><input type="hidden" name="controlId" value={control.id} /><ControlFields idPrefix={`control-review-${control.id}`} control={control} aspects={aspects} members={members} documents={documents} /><Feedback state={reviewState} /><Button type="submit" disabled={reviewing}>{reviewing ? "Recording review…" : "Create reviewed version"}</Button></form></details><form action={retireAction} onSubmit={(event) => { if (!window.confirm("Retire this control? Its history and checks will remain available.")) event.preventDefault(); }}><input type="hidden" name="controlId" value={control.id} /><Button type="submit" variant="secondary" disabled={retiring}>{retiring ? "Retiring…" : "Retire control"}</Button><Feedback state={retireState} /></form></>}</CardContent></Card>;
}

export function OperationalControlsWorkspace({ controls, gaps, aspects, members, documentRevisions, canManage }: { controls: ControlRow[]; gaps: Array<{ id: string; name: string; processName: string }>; aspects: AspectOption[]; members: MemberOption[]; documentRevisions: DocumentOption[]; canManage: boolean }) {
  return <div className="space-y-8"><Card><CardHeader><CardTitle>Significant-aspect control gaps</CardTitle></CardHeader><CardContent className="space-y-3">{gaps.length === 0 ? <p className="text-sm text-emerald-700">No current significant aspect is missing an active operational control.</p> : <ul className="space-y-1 text-sm text-amber-700">{gaps.map((gap) => <li key={gap.id}><a href={`/ems/aspects#aspect-${gap.id}`} className="underline">{gap.name}</a> — {gap.processName}</li>)}</ul>}{canManage && <ReviewCycleButton />}</CardContent></Card>{canManage && <CreateControl aspects={aspects} members={members} documents={documentRevisions} />}<div className="space-y-3"><h2 className="text-lg font-semibold text-slate-900">Control versions and checks</h2>{controls.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No operational controls yet.</CardContent></Card> : controls.map((control) => <ControlCard key={control.id} control={control} aspects={aspects} members={members} documents={documentRevisions} canManage={canManage} />)}</div></div>;
}
