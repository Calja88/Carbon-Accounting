"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  approveAspectAssessmentAction,
  approveSignificanceMethodAction,
  createAspectAssessmentAction,
  createSignificanceMethodAction,
  type AspectActionState,
} from "./actions";

const emptyState: AspectActionState = { error: null, message: null };
type Criterion = { key: string; label: string; scaleConfig: unknown; weight: string | null; required: boolean; sortOrder: number };
type Method = {
  id: string; programmeId: string; methodKey: string; name: string; version: number; status: string;
  formula: string; formulaConfig: unknown; threshold: string; criteria: Criterion[];
};
type Assessment = {
  id: string; aspectId: string; assessmentVersion: number; status: string; methodKeySnapshot: string;
  methodVersionSnapshot: number; formulaSnapshot: string; thresholdSnapshot: string; criterionInputs: unknown;
  calculatedScore: string; calculatedSignificant: boolean; overrideSignificant: boolean | null;
  overrideRationale: string | null; finalSignificant: boolean; calculationTrace: unknown;
};

function Feedback({ state }: { state: AspectActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function MethodFields({ programmes, method }: { programmes: Array<{ id: string; name: string }>; method?: Method }) {
  const criteria = method?.criteria.map((criterion) => ({
    key: criterion.key, label: criterion.label, scaleConfig: criterion.scaleConfig,
    ...(criterion.weight ? { weight: criterion.weight } : {}), required: criterion.required, sortOrder: criterion.sortOrder,
  }));
  const rules = method?.formula === "RULE_SET" && typeof method.formulaConfig === "object" && method.formulaConfig && !Array.isArray(method.formulaConfig)
    ? (method.formulaConfig as { rules?: unknown }).rules : undefined;
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      <div><Label>EMS programme</Label><Select name="programmeId" required defaultValue={method?.programmeId ?? ""} disabled={Boolean(method)}><option value="">Select…</option>{programmes.map((programme) => <option key={programme.id} value={programme.id}>{programme.name}</option>)}</Select>{method && <input type="hidden" name="programmeId" value={method.programmeId} />}</div>
      <div><Label>Stable method key</Label><Input name="methodKey" required defaultValue={method?.methodKey} readOnly={Boolean(method)} placeholder="site-impact-v1" /></div>
      <div><Label>Method name</Label><Input name="name" required defaultValue={method?.name} /></div>
      <div><Label>Formula</Label><Select name="formula" defaultValue={method?.formula ?? "WEIGHTED_SUM"}><option value="WEIGHTED_SUM">Weighted sum</option><option value="MAX_CRITERION">Maximum criterion</option><option value="RULE_SET">Rule set</option></Select></div>
      <div><Label>Significant at score</Label><Input name="threshold" required inputMode="decimal" defaultValue={method?.threshold} /></div>
    </div>
    <div><Label>Criteria configuration (JSON)</Label><Textarea name="criteriaJson" required rows={8} defaultValue={criteria ? JSON.stringify(criteria, null, 2) : undefined} placeholder={'[{"key":"severity","label":"Severity","scaleConfig":{"kind":"NUMERIC","min":"1","max":"5"},"weight":"2","required":true,"sortOrder":0}]'} /><p className="mt-1 text-xs text-slate-500">Each stable key defines its numeric or scored-option scale, weight, requirement, and display order.</p></div>
    <div><Label>Rule-set rules (JSON; required only for rule set)</Label><Textarea name="rulesJson" rows={4} defaultValue={rules ? JSON.stringify(rules, null, 2) : undefined} placeholder={'[{"criterionKey":"severity","operator":"GTE","compareTo":"4"}]'} /></div>
  </div>;
}

function MethodForm({ programmes }: { programmes: Array<{ id: string; name: string }> }) {
  const [state, action, pending] = useActionState(createSignificanceMethodAction, emptyState);
  return <Card><CardHeader><CardTitle>Create significance method</CardTitle></CardHeader><CardContent><form action={action} className="space-y-4"><MethodFields programmes={programmes} /><Feedback state={state} /><Button type="submit" disabled={pending || programmes.length === 0}>{pending ? "Creating…" : "Create draft method"}</Button></form></CardContent></Card>;
}

function MethodCard({ method, programmes, canEdit, canApprove }: { method: Method; programmes: Array<{ id: string; name: string }>; canEdit: boolean; canApprove: boolean }) {
  const [approveState, approveAction, approving] = useActionState(approveSignificanceMethodAction, emptyState);
  const [successorState, successorAction, creating] = useActionState(createSignificanceMethodAction, emptyState);
  return <Card><CardContent className="space-y-3 py-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-slate-900">{method.name} · v{method.version}</p><p className="text-sm text-slate-500">{method.methodKey} · {method.formula.replaceAll("_", " ").toLowerCase()} · threshold {method.threshold}</p></div><span className="rounded bg-slate-100 px-2 py-1 text-xs">{method.status.toLowerCase()}</span></div>
    <ul className="space-y-1 text-sm text-slate-700">{method.criteria.map((criterion) => <li key={criterion.key}><strong>{criterion.label}</strong> ({criterion.key}) · weight {criterion.weight ?? "1"} · {criterion.required ? "required" : "optional"} · scale {JSON.stringify(criterion.scaleConfig)}</li>)}</ul>
    {canApprove && method.status === "DRAFT" && <form action={approveAction}><input type="hidden" name="methodId" value={method.id} /><Button type="submit" disabled={approving}>{approving ? "Approving…" : "Approve method"}</Button><Feedback state={approveState} /></form>}
    {canEdit && method.status === "APPROVED" && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Create successor version</summary><form action={successorAction} className="mt-4 space-y-4"><input type="hidden" name="supersedesMethodId" value={method.id} /><MethodFields programmes={programmes} method={method} /><Feedback state={successorState} /><Button type="submit" disabled={creating}>{creating ? "Creating…" : "Create successor draft"}</Button></form></details>}
  </CardContent></Card>;
}

function AssessmentForm({ aspect, method, canApprove }: { aspect: { id: string; name: string }; method: Method; canApprove: boolean }) {
  const [state, action, pending] = useActionState(createAspectAssessmentAction, emptyState);
  return <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Assess with {method.name} v{method.version}</summary><form action={action} className="mt-4 space-y-4"><input type="hidden" name="aspectId" value={aspect.id} /><input type="hidden" name="methodId" value={method.id} /><p className="text-sm text-slate-600">Formula: {method.formula.replaceAll("_", " ").toLowerCase()}; significant at {method.threshold}.</p><div className="grid gap-4 sm:grid-cols-2">{method.criteria.map((criterion) => <div key={criterion.key}><Label>{criterion.label} {criterion.required ? "*" : ""}</Label><Input name={`criterion:${criterion.key}`} required={criterion.required} /><p className="mt-1 text-xs text-slate-500">Weight {criterion.weight ?? "1"}; scale {JSON.stringify(criterion.scaleConfig)}</p></div>)}</div>{canApprove && <div className="grid gap-4 sm:grid-cols-2"><div><Label>Significance override</Label><Select name="overrideSignificant" defaultValue=""><option value="">No override</option><option value="true">Final: significant</option><option value="false">Final: not significant</option></Select></div><div><Label>Override rationale</Label><Textarea name="overrideRationale" rows={2} /></div></div>}<Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Calculating…" : "Create assessment snapshot"}</Button></form></details>;
}

function AssessmentRow({ assessment, canApprove }: { assessment: Assessment; canApprove: boolean }) {
  const [state, action, pending] = useActionState(approveAspectAssessmentAction, emptyState);
  const inputs = typeof assessment.criterionInputs === "object" && assessment.criterionInputs && !Array.isArray(assessment.criterionInputs) ? assessment.criterionInputs as Record<string, unknown> : {};
  return <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>Assessment v{assessment.assessmentVersion} · {assessment.methodKeySnapshot} v{assessment.methodVersionSnapshot}</strong><span>{assessment.status.toLowerCase()}</span></div><p>{assessment.formulaSnapshot.replaceAll("_", " ").toLowerCase()} inputs: {Object.entries(inputs).map(([key, value]) => `${key}=${String(value)}`).join(", ")} · threshold {assessment.thresholdSnapshot}</p><p>Calculated score {assessment.calculatedScore}: {assessment.calculatedSignificant ? "significant" : "not significant"}. Final: <strong>{assessment.finalSignificant ? "significant" : "not significant"}</strong>.</p>{assessment.overrideSignificant !== null && <p className="text-amber-800">Override: {assessment.overrideSignificant ? "significant" : "not significant"}. Rationale: {assessment.overrideRationale}</p>}{canApprove && assessment.status === "DRAFT" && <form action={action}><input type="hidden" name="assessmentId" value={assessment.id} /><Button type="submit" disabled={pending}>{pending ? "Approving…" : "Approve assessment"}</Button><Feedback state={state} /></form>}</div>;
}

export function SignificanceWorkspace({ programmes, aspects, methods, assessments, canEdit, canApprove }: { programmes: Array<{ id: string; name: string }>; aspects: Array<{ id: string; name: string; programmeId: string }>; methods: Method[]; assessments: Assessment[]; canEdit: boolean; canApprove: boolean }) {
  const approvedMethods = methods.filter((method) => method.status === "APPROVED");
  return <section className="space-y-6"><div><h2 className="text-xl font-semibold text-slate-900">Versioned significance</h2><p className="mt-1 text-sm text-slate-500">Configure deterministic methods, retain exact formula inputs and rationale, and approve immutable assessment snapshots.</p></div>{canEdit && <MethodForm programmes={programmes} />}<div className="space-y-3"><h3 className="font-semibold text-slate-900">Method versions</h3>{methods.length === 0 ? <p className="text-sm text-slate-500">No significance method configured.</p> : methods.map((method) => <MethodCard key={method.id} method={method} programmes={programmes} canEdit={canEdit} canApprove={canApprove} />)}</div><div className="space-y-4"><h3 className="font-semibold text-slate-900">Aspect assessments</h3>{aspects.map((aspect) => { const history = assessments.filter((assessment) => assessment.aspectId === aspect.id); const available = approvedMethods.filter((method) => method.programmeId === aspect.programmeId); return <Card key={aspect.id}><CardHeader><CardTitle>{aspect.name}</CardTitle></CardHeader><CardContent className="space-y-3">{canEdit && available.map((method) => <AssessmentForm key={method.id} aspect={aspect} method={method} canApprove={canApprove} />)}{history.length === 0 ? <p className="text-sm text-slate-500">Not yet assessed.</p> : history.map((assessment) => <AssessmentRow key={assessment.id} assessment={assessment} canApprove={canApprove} />)}</CardContent></Card>; })}</div></section>;
}
