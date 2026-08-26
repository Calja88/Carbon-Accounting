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
  createProviderControlAction,
  notifyOverdueProviderReviewsAction,
  recordProviderEvaluationAction,
  retireProviderControlAction,
  uploadProviderEvaluationEvidenceAction,
  type ProviderActionState,
} from "./actions";

const emptyState: ProviderActionState = { error: null, message: null };

type AspectOption = { id: string; name: string; processName: string };
type MemberOption = { id: string; name: string };
type EvaluationRow = { id: string; evaluatedAt: string; result: string; notes: string | null; actionReference: string | null };
type ProviderRow = {
  id: string;
  providerReference: string;
  providerName: string;
  providedDescription: string;
  communicatedRequirements: string;
  evaluationFrequency: string;
  status: string;
  ownerMembershipId: string;
  ownerName: string;
  nextReviewDueDate: string;
  reviewOverdue: boolean;
  aspects: Array<{ id: string; name: string }>;
  evaluations: EvaluationRow[];
};

function Feedback({ state }: { state: ProviderActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function CreateProviderControl({ aspects, members }: { aspects: AspectOption[]; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createProviderControlAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add external-provider control</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="providerReference">Provider reference</Label><Input id="providerReference" name="providerReference" required placeholder="synthetic-provider-01" /></div>
            <div><Label htmlFor="providerName">Provider name</Label><Input id="providerName" name="providerName" required placeholder="Synthetic Logistics Ltd" /></div>
            <div><Label htmlFor="ownerMembershipId">Responsible owner</Label><Select id="ownerMembershipId" name="ownerMembershipId" required defaultValue=""><option value="">Select…</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></div>
            <div><Label htmlFor="evaluationFrequency">Evaluation frequency</Label><Input id="evaluationFrequency" name="evaluationFrequency" required placeholder="Annually" /></div>
            <div><Label htmlFor="nextReviewDueDate">Next review due</Label><Input id="nextReviewDueDate" name="nextReviewDueDate" type="date" required /></div>
            <div className="sm:col-span-2"><Label htmlFor="aspectIds">Linked aspects (Ctrl/Cmd to select multiple)</Label><Select id="aspectIds" name="aspectIds" multiple required className="min-h-28">{aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name} — {aspect.processName}</option>)}</Select></div>
            <div className="sm:col-span-2"><Label htmlFor="providedDescription">Process/product/service provided</Label><Textarea id="providedDescription" name="providedDescription" rows={2} required /></div>
            <div className="sm:col-span-2"><Label htmlFor="communicatedRequirements">Communicated environmental requirements</Label><Textarea id="communicatedRequirements" name="communicatedRequirements" rows={3} required /></div>
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending || aspects.length === 0 || members.length === 0}>{pending ? "Recording…" : "Record provider control"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReviewCycleButton() {
  const [state, action, pending] = useActionState(notifyOverdueProviderReviewsAction, emptyState);
  return <form action={action} className="space-y-2"><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Checking…" : "Check overdue provider reviews"}</Button><Feedback state={state} /></form>;
}

function EvaluationForm({ providerControlId }: { providerControlId: string }) {
  const [state, action, pending] = useActionState(recordProviderEvaluationAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="providerControlId" value={providerControlId} />
      <p className="text-sm font-medium">Record evaluation</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`evaluatedAt-${providerControlId}`}>Evaluated on</Label><Input id={`evaluatedAt-${providerControlId}`} name="evaluatedAt" type="date" required /></div>
        <div><Label htmlFor={`result-${providerControlId}`}>Result</Label><Select id={`result-${providerControlId}`} name="result" defaultValue="PASS"><option value="PASS">Pass</option><option value="CONDITIONAL">Conditional</option><option value="FAIL">Fail</option></Select></div>
        <div><Label htmlFor={`nextReviewDueDate-${providerControlId}`}>Next review due</Label><Input id={`nextReviewDueDate-${providerControlId}`} name="nextReviewDueDate" type="date" required /></div>
      </div>
      <div><Label htmlFor={`notes-${providerControlId}`}>Notes</Label><Textarea id={`notes-${providerControlId}`} name="notes" rows={2} /></div>
      <div><Label htmlFor={`actionReference-${providerControlId}`}>Action reference (optional)</Label><Input id={`actionReference-${providerControlId}`} name="actionReference" placeholder="Explicit reference; no action is auto-created" /></div>
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Record evaluation"}</Button>
    </form>
  );
}

function EvaluationItem({ evaluation }: { evaluation: EvaluationRow }) {
  const [state, action, pending] = useActionState(uploadProviderEvaluationEvidenceAction, emptyState);
  const tone = evaluation.result === "FAIL" ? "danger" : evaluation.result === "PASS" ? "success" : "neutral";
  return (
    <div className="rounded border border-slate-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tone}>{evaluation.result.toLowerCase()}</Badge><span>{new Date(evaluation.evaluatedAt).toLocaleDateString()}</span></div>
      {evaluation.notes && <p className="mt-1 text-slate-600">{evaluation.notes}</p>}
      {evaluation.actionReference && <p className="mt-1 text-slate-600">Action reference: {evaluation.actionReference}</p>}
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="evaluationId" value={evaluation.id} />
        <div><Label htmlFor={`providerEvidence-${evaluation.id}`}>Attach evidence</Label><Input id={`providerEvidence-${evaluation.id}`} name="file" type="file" required /></div>
        <Input name="purpose" placeholder="Purpose (optional)" />
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
        <Feedback state={state} />
      </form>
    </div>
  );
}

function ProviderCard({ provider, canManage }: { provider: ProviderRow; canManage: boolean }) {
  const [retireState, retireAction, retiring] = useActionState(retireProviderControlAction, emptyState);
  return (
    <Card>
      <CardContent id={`provider-${provider.id}`} className="scroll-mt-24 space-y-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-900">{provider.providerName}</h3>
              <Badge>{provider.providerReference}</Badge>
              <Badge tone={provider.status === "ACTIVE" ? "success" : "neutral"}>{provider.status.toLowerCase()}</Badge>
              {provider.reviewOverdue && <Badge tone="danger">review overdue</Badge>}
            </div>
            <p className="mt-1 text-sm text-slate-600">owner {provider.ownerName} · next review {new Date(provider.nextReviewDueDate).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p><strong>Provided:</strong> {provider.providedDescription}</p>
          <p><strong>Requirements:</strong> {provider.communicatedRequirements}</p>
          <p><strong>Evaluation frequency:</strong> {provider.evaluationFrequency}</p>
          <p><strong>Aspects:</strong> {provider.aspects.length === 0 ? "None linked" : provider.aspects.map((aspect, index) => <span key={aspect.id}>{index > 0 && ", "}<a href={`/ems/aspects#aspect-${aspect.id}`} className="text-blue-700 underline">{aspect.name}</a></span>)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evaluations</p>
          {provider.evaluations.length === 0 ? <p className="mt-1 text-sm text-slate-500">No evaluations recorded.</p> : <div className="mt-2 space-y-2">{provider.evaluations.map((evaluation) => <EvaluationItem key={evaluation.id} evaluation={evaluation} />)}</div>}
        </div>
        {canManage && provider.status === "ACTIVE" && (
          <>
            <EvaluationForm providerControlId={provider.id} />
            <form action={retireAction} onSubmit={(event) => { if (!window.confirm("Retire this provider control?")) event.preventDefault(); }}>
              <input type="hidden" name="providerControlId" value={provider.id} />
              <Button type="submit" variant="secondary" disabled={retiring}>{retiring ? "Retiring…" : "Retire provider control"}</Button>
              <Feedback state={retireState} />
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ExternalProviderWorkspace({ providers, aspects, members, canManage }: { providers: ProviderRow[]; aspects: AspectOption[]; members: MemberOption[]; canManage: boolean }) {
  return (
    <div className="space-y-8">
      {canManage && <Card><CardContent className="py-4"><ReviewCycleButton /></CardContent></Card>}
      {canManage && <CreateProviderControl aspects={aspects} members={members} />}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Provider controls and evaluations</h2>
        {providers.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No external-provider controls yet.</CardContent></Card> : providers.map((provider) => <ProviderCard key={provider.id} provider={provider} canManage={canManage} />)}
      </div>
    </div>
  );
}
