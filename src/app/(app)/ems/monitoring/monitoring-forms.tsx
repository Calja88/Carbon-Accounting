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
  createMonitoringEquipmentAction, createMonitoringPlanAction, documentMonitoringExceptionAction,
  notifyOverdueCalibrationsAction, recordEquipmentCalibrationAction, recordMonitoringResultAction,
  reviewMonitoringResultAction, uploadCalibrationCertificateAction, uploadMonitoringResultEvidenceAction,
  type MonitoringActionState,
} from "./actions";

const emptyState: MonitoringActionState = { error: null, message: null };
type Option = { id: string; label: string };
type ResultRow = {
  id: string; measuredAt: string; value: string; unit: string; qualitativeResult: string | null;
  dataQualityFlag: string; reviewStatus: string; reviewNote: string | null;
  exceptionReview: { validityDecision: string; consequence: string; actionReference: string | null } | null;
  evidence: Array<{ id: string; filename: string }>;
};
type PlanRow = {
  id: string; planKey: string; parameter: string; method: string; location: string; frequency: string; unit: string;
  acceptanceCriteria: string; status: string; aspectLabel: string | null; controlLabel: string | null;
  responsibleName: string; equipmentLabel: string | null; results: ResultRow[];
};
type CalibrationRow = {
  id: string; performedAt: string; dueDate: string; provider: string; method: string; result: string;
  nextDueDate: string; outOfTolerance: boolean; responseReference: string | null;
  exceptionReview: { validityDecision: string; consequence: string; actionReference: string | null } | null;
  evidence: Array<{ id: string; filename: string }>;
};
type EquipmentRow = {
  id: string; reference: string; description: string; location: string; calibrationFrequency: string;
  status: string; calibrationDueDate: string; calibrationOverdue: boolean; ownerName: string; calibrations: CalibrationRow[];
};

function Feedback({ state }: { state: MonitoringActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function ExceptionForm({ resultId, calibrationId }: { resultId?: string; calibrationId?: string }) {
  const [state, action, pending] = useActionState(documentMonitoringExceptionAction, emptyState);
  return <form action={action} className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
    {resultId && <input type="hidden" name="resultId" value={resultId} />}
    {calibrationId && <input type="hidden" name="calibrationId" value={calibrationId} />}
    <p className="text-sm font-medium text-amber-900">Document required exception review</p>
    <Textarea name="reason" required placeholder="Why review is required" rows={2} />
    <div className="grid gap-2 sm:grid-cols-2"><Select name="validityDecision" defaultValue="PARTIALLY_VALID"><option value="VALID">Valid</option><option value="PARTIALLY_VALID">Partially valid</option><option value="INVALID">Invalid</option></Select><Input name="actionReference" placeholder="Response/action reference (optional)" /></div>
    <Textarea name="consequence" required placeholder="Consequences, affected records, and response" rows={2} />
    <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Documenting…" : "Document review"}</Button>
  </form>;
}

function ResultItem({ result, canRecord, canReview }: { result: ResultRow; canRecord: boolean; canReview: boolean }) {
  const [reviewState, reviewAction, reviewing] = useActionState(reviewMonitoringResultAction, emptyState);
  const [evidenceState, evidenceAction, uploading] = useActionState(uploadMonitoringResultEvidenceAction, emptyState);
  const needsException = result.reviewStatus === "EXCEPTION_REVIEW_REQUIRED" && !result.exceptionReview;
  return <div className="space-y-2 rounded border border-slate-200 p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><strong>{result.value} {result.unit}</strong><Badge>{result.dataQualityFlag.toLowerCase()}</Badge><Badge tone={needsException ? "danger" : result.reviewStatus === "REVIEWED" ? "success" : "neutral"}>{needsException ? "review required" : result.reviewStatus.toLowerCase()}</Badge><span className="text-slate-500">{new Date(result.measuredAt).toLocaleDateString()}</span></div>
    {result.qualitativeResult && <p>{result.qualitativeResult}</p>}
    {result.reviewNote && <p className="text-slate-600">Review: {result.reviewNote}</p>}
    {result.exceptionReview && <p className="text-amber-800">Exception decision: {result.exceptionReview.validityDecision.toLowerCase().replaceAll("_", " ")} — {result.exceptionReview.consequence}</p>}
    {result.evidence.length > 0 && <p className="text-slate-500">Evidence: {result.evidence.map((item) => item.filename).join(", ")}</p>}
    {canReview && needsException && <ExceptionForm resultId={result.id} />}
    {canReview && result.reviewStatus === "PENDING" && <form action={reviewAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="resultId" value={result.id} /><div className="min-w-64 flex-1"><Label>Review note</Label><Input name="reviewNote" required /></div><Button type="submit" variant="secondary" disabled={reviewing}>{reviewing ? "Reviewing…" : "Review result"}</Button><Feedback state={reviewState} /></form>}
    {canRecord && <form action={evidenceAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="resultId" value={result.id} /><div><Label>Result evidence</Label><Input name="file" type="file" required /></div><Input name="purpose" placeholder="Purpose (optional)" /><Button type="submit" variant="secondary" disabled={uploading}>{uploading ? "Uploading…" : "Attach"}</Button><Feedback state={evidenceState} /></form>}
  </div>;
}

function PlanCard({ plan, canRecord, canReview }: { plan: PlanRow; canRecord: boolean; canReview: boolean }) {
  const [state, action, pending] = useActionState(recordMonitoringResultAction, emptyState);
  return <Card><CardContent className="space-y-4 py-5">
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{plan.parameter}</h3><Badge>{plan.planKey}</Badge><Badge tone={plan.status === "ACTIVE" ? "success" : "neutral"}>{plan.status.toLowerCase()}</Badge></div>
    <div className="grid gap-2 text-sm sm:grid-cols-2"><p><strong>Method:</strong> {plan.method}</p><p><strong>Location:</strong> {plan.location}</p><p><strong>Frequency:</strong> {plan.frequency}</p><p><strong>Unit:</strong> {plan.unit}</p><p><strong>Responsible:</strong> {plan.responsibleName}</p><p><strong>Instrument:</strong> {plan.equipmentLabel ?? "Not required"}</p>{plan.aspectLabel && <p><strong>Aspect:</strong> {plan.aspectLabel}</p>}{plan.controlLabel && <p><strong>Control:</strong> {plan.controlLabel}</p>}<p className="sm:col-span-2"><strong>Criteria:</strong> {plan.acceptanceCriteria}</p></div>
    {canRecord && plan.status === "ACTIVE" && <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3"><input type="hidden" name="planId" value={plan.id} /><input type="hidden" name="unit" value={plan.unit} /><p className="text-sm font-medium">Append monitoring result</p><div className="grid gap-3 sm:grid-cols-4"><div><Label>Measured</Label><Input name="measuredAt" type="date" required /></div><div><Label>Value ({plan.unit})</Label><Input name="value" inputMode="decimal" required /></div><div><Label>Quality</Label><Select name="dataQualityFlag" defaultValue="VALIDATED"><option value="VALIDATED">Validated</option><option value="ESTIMATED">Estimated</option><option value="SUSPECT">Suspect</option><option value="REJECTED">Rejected</option></Select></div><div><Label>Qualitative result</Label><Input name="qualitativeResult" /></div></div><div className="grid gap-3 sm:grid-cols-2"><div><Label>Period start (optional)</Label><Input name="periodStart" type="date" /></div><div><Label>Period end (optional)</Label><Input name="periodEnd" type="date" /></div></div><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Recording…" : "Append result"}</Button></form>}
    <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Append-only results</p>{plan.results.length === 0 ? <p className="text-sm text-slate-500">No results recorded.</p> : plan.results.map((result) => <ResultItem key={result.id} result={result} canRecord={canRecord} canReview={canReview} />)}</div>
  </CardContent></Card>;
}

function CalibrationItem({ calibration, canRecord, canReview }: { calibration: CalibrationRow; canRecord: boolean; canReview: boolean }) {
  const [state, action, pending] = useActionState(uploadCalibrationCertificateAction, emptyState);
  const needsReview = calibration.outOfTolerance && !calibration.exceptionReview;
  return <div className="space-y-2 rounded border border-slate-200 p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge tone={needsReview ? "danger" : calibration.result === "PASS" ? "success" : "neutral"}>{calibration.result.toLowerCase().replaceAll("_", " ")}</Badge><span>{new Date(calibration.performedAt).toLocaleDateString()} · next due {new Date(calibration.nextDueDate).toLocaleDateString()}</span>{needsReview && <Badge tone="danger">documented review required</Badge>}</div><p>{calibration.provider} · {calibration.method}</p>{calibration.responseReference && <p>Response reference: {calibration.responseReference}</p>}{calibration.exceptionReview && <p className="text-amber-800">Review: {calibration.exceptionReview.validityDecision.toLowerCase().replaceAll("_", " ")} — {calibration.exceptionReview.consequence}</p>}{calibration.evidence.length > 0 && <p className="text-slate-500">Certificates: {calibration.evidence.map((item) => item.filename).join(", ")}</p>}{canReview && needsReview && <ExceptionForm calibrationId={calibration.id} />}{canRecord && <form action={action} className="flex flex-wrap items-end gap-2"><input type="hidden" name="calibrationId" value={calibration.id} /><div><Label>Certificate</Label><Input name="file" type="file" required /></div><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach certificate"}</Button><Feedback state={state} /></form>}</div>;
}

function EquipmentCard({ equipment, canRecord, canReview }: { equipment: EquipmentRow; canRecord: boolean; canReview: boolean }) {
  const [state, action, pending] = useActionState(recordEquipmentCalibrationAction, emptyState);
  return <Card><CardContent className="space-y-4 py-5"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{equipment.reference}</h3><Badge tone={equipment.status === "ACTIVE" ? "success" : "neutral"}>{equipment.status.toLowerCase().replaceAll("_", " ")}</Badge>{equipment.calibrationOverdue && <Badge tone="danger">calibration overdue</Badge>}</div><p className="text-sm text-slate-600">{equipment.description} · {equipment.location} · owner {equipment.ownerName} · {equipment.calibrationFrequency}</p>{canRecord && equipment.status !== "RETIRED" && <form action={action} className="space-y-3 rounded border border-slate-200 p-3"><input type="hidden" name="equipmentId" value={equipment.id} /><p className="text-sm font-medium">Append calibration or verification</p><div className="grid gap-3 sm:grid-cols-3"><div><Label>Due</Label><Input name="dueDate" type="date" required defaultValue={equipment.calibrationDueDate.slice(0, 10)} /></div><div><Label>Performed</Label><Input name="performedAt" type="date" required /></div><div><Label>Next due</Label><Input name="nextDueDate" type="date" required /></div><div><Label>Provider</Label><Input name="provider" required /></div><div><Label>Method</Label><Input name="method" required /></div><div><Label>Result</Label><Select name="result" defaultValue="PASS"><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="OUT_OF_TOLERANCE">Out of tolerance</option></Select></div></div><Input name="responseReference" placeholder="Response/action reference (optional; review still required for out of tolerance)" /><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Recording…" : "Append calibration"}</Button></form>}<div className="space-y-2">{equipment.calibrations.length === 0 ? <p className="text-sm text-slate-500">No calibration records.</p> : equipment.calibrations.map((item) => <CalibrationItem key={item.id} calibration={item} canRecord={canRecord} canReview={canReview} />)}</div></CardContent></Card>;
}

export function MonitoringWorkspace({ plans, equipment, aspects, controls, members, canRecord, canReview }: { plans: PlanRow[]; equipment: EquipmentRow[]; aspects: Option[]; controls: Option[]; members: Option[]; canRecord: boolean; canReview: boolean }) {
  const [planState, planAction, planPending] = useActionState(createMonitoringPlanAction, emptyState);
  const [equipmentState, equipmentAction, equipmentPending] = useActionState(createMonitoringEquipmentAction, emptyState);
  const [reminderState, reminderAction, reminderPending] = useActionState(notifyOverdueCalibrationsAction, emptyState);
  return <div className="space-y-8">{canRecord && <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Add monitoring equipment</CardTitle></CardHeader><CardContent><form action={equipmentAction} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Reference</Label><Input name="reference" required placeholder="synthetic-meter-01" /></div><div><Label>Owner</Label><Select name="ownerMembershipId" required><option value="">Select…</option>{members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div><div><Label>Description</Label><Input name="description" required /></div><div><Label>Location</Label><Input name="location" required /></div><div><Label>Calibration frequency</Label><Input name="calibrationFrequency" required placeholder="Every 12 months" /></div><div><Label>Calibration due</Label><Input name="calibrationDueDate" type="date" required /></div></div><Feedback state={equipmentState} /><Button type="submit" disabled={equipmentPending}>{equipmentPending ? "Adding…" : "Add equipment"}</Button></form></CardContent></Card><Card><CardHeader><CardTitle>Add monitoring plan</CardTitle></CardHeader><CardContent><form action={planAction} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Plan key</Label><Input name="planKey" required placeholder="synthetic-plan-01" /></div><div><Label>Parameter</Label><Input name="parameter" required /></div><div><Label>Method</Label><Input name="method" required /></div><div><Label>Location</Label><Input name="location" required /></div><div><Label>Frequency</Label><Input name="frequency" required /></div><div><Label>Explicit unit</Label><Input name="unit" required /></div><div><Label>Aspect</Label><Select name="aspectId"><option value="">None</option>{aspects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div><div><Label>Operational control</Label><Select name="controlId"><option value="">None</option>{controls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div><div><Label>Responsible</Label><Select name="responsibleMembershipId" required><option value="">Select…</option>{members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></div><div><Label>Review due (optional)</Label><Input name="reviewDueDate" type="date" /></div><div><Label>Obligation reference (optional)</Label><Input name="obligationReference" /></div><div><Label>Objective reference (optional)</Label><Input name="objectiveReference" /></div><div className="sm:col-span-2"><Label>Acceptance criteria</Label><Textarea name="acceptanceCriteria" required rows={2} /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="instrumentRequired" /> Instrument required</label><div><Label>Required equipment</Label><Select name="equipmentId"><option value="">None</option>{equipment.map((item) => <option key={item.id} value={item.id}>{item.reference}</option>)}</Select></div></div><Feedback state={planState} /><Button type="submit" disabled={planPending}>{planPending ? "Creating…" : "Create plan"}</Button></form></CardContent></Card></div>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">Monitoring plans and results</h2>{plans.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No monitoring plans yet.</CardContent></Card> : plans.map((plan) => <PlanCard key={plan.id} plan={plan} canRecord={canRecord} canReview={canReview} />)}</section>
    <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Equipment and calibration</h2>{canRecord && <form action={reminderAction} className="flex items-center gap-2"><Button type="submit" variant="secondary" disabled={reminderPending}>{reminderPending ? "Checking…" : "Check overdue calibrations"}</Button><Feedback state={reminderState} /></form>}</div>{equipment.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No monitoring equipment yet.</CardContent></Card> : equipment.map((item) => <EquipmentCard key={item.id} equipment={item} canRecord={canRecord} canReview={canReview} />)}</section>
  </div>;
}
