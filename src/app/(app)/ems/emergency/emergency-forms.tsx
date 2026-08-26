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
  addExerciseActionAction,
  createPlanAction,
  createScenarioAction,
  recordExerciseAction,
  retireScenarioAction,
  retirePlanAction,
  revisePlanAction,
  uploadExerciseEvidenceAction,
  type EmergencyActionState,
} from "./actions";

const emptyState: EmergencyActionState = { error: null, message: null };

type AspectOption = { id: string; name: string };
type MemberOption = { id: string; name: string };
type DocumentOption = { id: string; label: string };
type CommsPlanOption = { id: string; subject: string };
type ActionRow = { id: string; description: string; status: string; dueDate: string | null; actionReference: string | null; incidentReference: string | null; nonconformityReference: string | null };
type ExerciseRow = {
  id: string;
  planVersion: number;
  type: string;
  exerciseDate: string;
  participantMembershipIds: string[];
  objectives: string;
  outcome: string;
  observations: string | null;
  lessons: string | null;
  actions: ActionRow[];
};
type PlanRow = {
  id: string;
  version: number;
  status: string;
  roles: string;
  resources: string;
  effectiveDate: string;
  reviewDueDate: string;
  controlledDocumentRevisionId: string;
  communicationPlanId: string | null;
};
type ScenarioRow = {
  id: string;
  name: string;
  priority: string;
  status: string;
  triggerDescription: string;
  receptors: string;
  credibleConsequence: string;
  reviewDueDate: string;
  reviewOverdue: boolean;
  aspectId: string | null;
  aspectName: string | null;
  plans: PlanRow[];
  exercises: ExerciseRow[];
};

function Feedback({ state }: { state: EmergencyActionState }) {
  return <>{state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}{state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}</>;
}

function CreateScenario({ aspects }: { aspects: AspectOption[] }) {
  const [state, action, pending] = useActionState(createScenarioAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add emergency scenario</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="scenario-name">Name</Label><Input id="scenario-name" name="name" required placeholder="Synthetic chemical spill" /></div>
            <div><Label htmlFor="scenario-priority">Priority</Label><Select id="scenario-priority" name="priority" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical</option></Select></div>
            <div><Label htmlFor="scenario-aspect">Linked aspect (optional)</Label><Select id="scenario-aspect" name="aspectId" defaultValue=""><option value="">None</option>{aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}</Select></div>
            <div><Label htmlFor="scenario-review-due">Review due</Label><Input id="scenario-review-due" name="reviewDueDate" type="date" required /></div>
            <div className="sm:col-span-2"><Label htmlFor="scenario-trigger">Trigger</Label><Textarea id="scenario-trigger" name="triggerDescription" rows={2} required /></div>
            <div className="sm:col-span-2"><Label htmlFor="scenario-receptors">Receptors</Label><Textarea id="scenario-receptors" name="receptors" rows={2} required /></div>
            <div className="sm:col-span-2"><Label htmlFor="scenario-consequence">Credible consequence</Label><Textarea id="scenario-consequence" name="credibleConsequence" rows={2} required /></div>
            <div className="sm:col-span-2"><Label htmlFor="scenario-controls-summary">Existing controls summary (optional)</Label><Textarea id="scenario-controls-summary" name="controlsSummary" rows={2} /></div>
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Record scenario"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PlanFields({ idPrefix, plan, documents, commsPlans }: { idPrefix: string; plan?: PlanRow; documents: DocumentOption[]; commsPlans: CommsPlanOption[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-document-revision`}>Controlled procedure revision</Label><Select id={`${idPrefix}-document-revision`} name="controlledDocumentRevisionId" required defaultValue={plan?.controlledDocumentRevisionId ?? ""}><option value="">Select…</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.label}</option>)}</Select></div>
      <div><Label htmlFor={`${idPrefix}-effective-date`}>Effective date</Label><Input id={`${idPrefix}-effective-date`} name="effectiveDate" type="date" required /></div>
      <div><Label htmlFor={`${idPrefix}-review-due`}>Review due</Label><Input id={`${idPrefix}-review-due`} name="reviewDueDate" type="date" required /></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-comms-plan`}>Communication plan (optional)</Label><Select id={`${idPrefix}-comms-plan`} name="communicationPlanId" defaultValue={plan?.communicationPlanId ?? ""}><option value="">None</option>{commsPlans.map((commsPlan) => <option key={commsPlan.id} value={commsPlan.id}>{commsPlan.subject}</option>)}</Select></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-roles`}>Roles and responsibilities (labels only — no real contact details)</Label><Textarea id={`${idPrefix}-roles`} name="roles" rows={3} required defaultValue={plan?.roles ?? ""} /></div>
      <div className="sm:col-span-2"><Label htmlFor={`${idPrefix}-resources`}>Resources</Label><Textarea id={`${idPrefix}-resources`} name="resources" rows={2} required defaultValue={plan?.resources ?? ""} /></div>
    </div>
  );
}

function CreatePlanForm({ scenarioId, documents, commsPlans }: { scenarioId: string; documents: DocumentOption[]; commsPlans: CommsPlanOption[] }) {
  const [state, action, pending] = useActionState(createPlanAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <p className="text-sm font-medium">Create emergency plan</p>
      <PlanFields idPrefix={`plan-new-${scenarioId}`} documents={documents} commsPlans={commsPlans} />
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Creating…" : "Create plan"}</Button>
    </form>
  );
}

function RevisePlanForm({ plan, documents, commsPlans }: { plan: PlanRow; documents: DocumentOption[]; commsPlans: CommsPlanOption[] }) {
  const [state, action, pending] = useActionState(revisePlanAction, emptyState);
  return (
    <details className="rounded-lg border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">Revise plan (creates a controlled successor version)</summary>
      <form action={action} className="mt-4 space-y-3">
        <input type="hidden" name="planId" value={plan.id} />
        <PlanFields idPrefix={`plan-revise-${plan.id}`} plan={plan} documents={documents} commsPlans={commsPlans} />
        <Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Recording revision…" : "Create successor version"}</Button>
      </form>
    </details>
  );
}

function RetirePlanForm({ plan }: { plan: PlanRow }) {
  const [state, action, pending] = useActionState(retirePlanAction, emptyState);
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="planId" value={plan.id} />
      <div className="min-w-64 flex-1">
        <Label htmlFor={`plan-retire-reason-${plan.id}`}>Retirement reason</Label>
        <Input id={`plan-retire-reason-${plan.id}`} name="reason" required />
      </div>
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        onClick={(event) => { if (!confirm("Retire this emergency plan without a successor? The scenario will have no active plan.")) event.preventDefault(); }}
      >
        {pending ? "Retiring…" : "Retire plan"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function ExerciseActionItem({ action: item }: { action: ActionRow }) {
  return (
    <div className="rounded border border-slate-200 p-2 text-xs">
      <p className="text-slate-700">{item.description}</p>
      <p className="mt-1 text-slate-500">
        {item.dueDate && <>Due {new Date(item.dueDate).toLocaleDateString()} · </>}
        <Badge tone={item.status === "COMPLETE" ? "success" : "neutral"}>{item.status.toLowerCase()}</Badge>
      </p>
      {item.actionReference && <p className="mt-1 text-slate-500">Action reference: {item.actionReference}</p>}
      {item.incidentReference && <p className="mt-1 text-amber-700">Incident reference (explicit, not automatic): {item.incidentReference}</p>}
      {item.nonconformityReference && <p className="mt-1 text-amber-700">Nonconformity reference (explicit, not automatic): {item.nonconformityReference}</p>}
    </div>
  );
}

function AddExerciseActionForm({ exerciseId, members }: { exerciseId: string; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(addExerciseActionAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded border border-dashed border-slate-300 p-2 text-xs">
      <input type="hidden" name="exerciseId" value={exerciseId} />
      <p className="font-medium text-slate-600">Add follow-up action</p>
      <Textarea aria-label="Follow-up action description" name="description" rows={2} placeholder="Describe the follow-up action" required />
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label="Owner" name="ownerMembershipId" defaultValue=""><option value="">No owner</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select>
        <Input aria-label="Due date" name="dueDate" type="date" />
      </div>
      <Input aria-label="Action reference (optional)" name="actionReference" placeholder="Action reference (optional)" />
      <Input aria-label="Incident reference (optional)" name="incidentReference" placeholder="Incident reference — explicit only, never automatic (optional)" />
      <Input aria-label="Nonconformity reference (optional)" name="nonconformityReference" placeholder="Nonconformity reference — explicit only, never automatic (optional)" />
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Add action"}</Button>
    </form>
  );
}

function ExerciseItem({ exercise, members }: { exercise: ExerciseRow; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(uploadExerciseEvidenceAction, emptyState);
  const tone = exercise.outcome === "FAILED" ? "danger" : exercise.outcome === "SUCCESSFUL" ? "success" : "neutral";
  return (
    <div className="rounded border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{exercise.type.toLowerCase()}</Badge>
        <Badge tone={tone}>{exercise.outcome.toLowerCase()}</Badge>
        <span>{new Date(exercise.exerciseDate).toLocaleDateString()} · plan v{exercise.planVersion}</span>
      </div>
      <p className="mt-1 text-slate-600">{exercise.objectives}</p>
      <p className="mt-1 text-slate-500">Participants: {exercise.participantMembershipIds.length}</p>
      {exercise.observations && <p className="mt-1 text-slate-600">Observations: {exercise.observations}</p>}
      {exercise.lessons && <p className="mt-1 text-slate-600">Lessons: {exercise.lessons}</p>}
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="exerciseId" value={exercise.id} />
        <div><Label htmlFor={`exercise-evidence-${exercise.id}`}>Attach evidence</Label><Input id={`exercise-evidence-${exercise.id}`} name="file" type="file" required /></div>
        <Input name="purpose" placeholder="Purpose (optional)" />
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
        <Feedback state={state} />
      </form>
      <div className="mt-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Follow-up actions</p>
        {exercise.actions.map((item) => <ExerciseActionItem key={item.id} action={item} />)}
        <AddExerciseActionForm exerciseId={exercise.id} members={members} />
      </div>
    </div>
  );
}

function RecordExerciseForm({ scenarioId, activePlan, members }: { scenarioId: string; activePlan: PlanRow | undefined; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(recordExerciseAction, emptyState);
  if (!activePlan) return <p className="text-sm text-slate-500">Create an active plan before exercising this scenario.</p>;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="scenarioId" value={scenarioId} />
      <input type="hidden" name="planId" value={activePlan.id} />
      <p className="text-sm font-medium">Record exercise against plan v{activePlan.version}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><Label htmlFor={`exercise-type-${scenarioId}`}>Type</Label><Select id={`exercise-type-${scenarioId}`} name="type" defaultValue="TABLETOP"><option value="TABLETOP">Tabletop</option><option value="DRILL">Drill</option><option value="FULL_SCALE">Full scale</option></Select></div>
        <div><Label htmlFor={`exercise-date-${scenarioId}`}>Date</Label><Input id={`exercise-date-${scenarioId}`} name="exerciseDate" type="date" required /></div>
        <div><Label htmlFor={`exercise-outcome-${scenarioId}`}>Outcome</Label><Select id={`exercise-outcome-${scenarioId}`} name="outcome" defaultValue="SUCCESSFUL"><option value="SUCCESSFUL">Successful</option><option value="PARTIAL">Partial</option><option value="FAILED">Failed</option></Select></div>
      </div>
      <div><Label htmlFor={`exercise-participants-${scenarioId}`}>Participants (Ctrl/Cmd to select multiple)</Label><Select id={`exercise-participants-${scenarioId}`} name="participantMembershipIds" multiple required className="min-h-20">{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></div>
      <div><Label htmlFor={`exercise-objectives-${scenarioId}`}>Objectives</Label><Textarea id={`exercise-objectives-${scenarioId}`} name="objectives" rows={2} required /></div>
      <div><Label htmlFor={`exercise-observations-${scenarioId}`}>Observations (optional)</Label><Textarea id={`exercise-observations-${scenarioId}`} name="observations" rows={2} /></div>
      <div><Label htmlFor={`exercise-lessons-${scenarioId}`}>Lessons (optional)</Label><Textarea id={`exercise-lessons-${scenarioId}`} name="lessons" rows={2} /></div>
      <Feedback state={state} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Recording…" : "Record exercise"}</Button>
    </form>
  );
}

function ScenarioCard({ scenario, members, documents, commsPlans, canManagePlans, canRecordExercises }: {
  scenario: ScenarioRow;
  members: MemberOption[];
  documents: DocumentOption[];
  commsPlans: CommsPlanOption[];
  canManagePlans: boolean;
  canRecordExercises: boolean;
}) {
  const [retireState, retireAction, retiring] = useActionState(retireScenarioAction, emptyState);
  const activePlan = scenario.plans.find((plan) => plan.status === "ACTIVE");
  return (
    <Card>
      <CardContent id={`scenario-${scenario.id}`} className="scroll-mt-24 space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{scenario.name}</h3>
          <Badge tone={scenario.priority === "CRITICAL" || scenario.priority === "HIGH" ? "danger" : "neutral"}>{scenario.priority.toLowerCase()}</Badge>
          <Badge tone={scenario.status === "ACTIVE" ? "success" : "neutral"}>{scenario.status.toLowerCase()}</Badge>
          {scenario.reviewOverdue && <Badge tone="danger">review overdue</Badge>}
        </div>
        <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
          <p><strong>Trigger:</strong> {scenario.triggerDescription}</p>
          <p><strong>Receptors:</strong> {scenario.receptors}</p>
          <p><strong>Consequence:</strong> {scenario.credibleConsequence}</p>
          <p><strong>Review due:</strong> {new Date(scenario.reviewDueDate).toLocaleDateString()}</p>
          {scenario.aspectName && <p><strong>Linked aspect:</strong> {scenario.aspectId ? <a href={`/ems/aspects#aspect-${scenario.aspectId}`} className="text-blue-700 underline">{scenario.aspectName}</a> : scenario.aspectName}</p>}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plans</p>
          {scenario.plans.length === 0 ? <p className="mt-1 text-sm text-slate-500">No plan yet.</p> : (
            <ul className="mt-1 space-y-1 text-sm text-slate-600">
              {scenario.plans.map((plan) => {
                const commsPlan = plan.communicationPlanId ? commsPlans.find((item) => item.id === plan.communicationPlanId) : null;
                return <li key={plan.id}>v{plan.version} — <Badge tone={plan.status === "ACTIVE" ? "success" : "neutral"}>{plan.status.toLowerCase()}</Badge> effective {new Date(plan.effectiveDate).toLocaleDateString()}{commsPlan && <> · <a href={`/ems/communications#comms-${commsPlan.id}`} className="text-blue-700 underline">{commsPlan.subject}</a></>}</li>;
              })}
            </ul>
          )}
          {canManagePlans && scenario.status === "ACTIVE" && (activePlan ? <RevisePlanForm plan={activePlan} documents={documents} commsPlans={commsPlans} /> : <CreatePlanForm scenarioId={scenario.id} documents={documents} commsPlans={commsPlans} />)}
          {canManagePlans && activePlan && <RetirePlanForm plan={activePlan} />}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exercises</p>
          {scenario.exercises.length === 0 ? <p className="mt-1 text-sm text-slate-500">No exercises recorded.</p> : <div className="mt-2 space-y-2">{scenario.exercises.map((exercise) => <ExerciseItem key={exercise.id} exercise={exercise} members={members} />)}</div>}
          {canRecordExercises && scenario.status === "ACTIVE" && <div className="mt-3"><RecordExerciseForm scenarioId={scenario.id} activePlan={activePlan} members={members} /></div>}
        </div>

        {canManagePlans && scenario.status === "ACTIVE" && (
          <form action={retireAction} onSubmit={(event) => { if (!window.confirm("Retire this scenario?")) event.preventDefault(); }}>
            <input type="hidden" name="scenarioId" value={scenario.id} />
            <Button type="submit" variant="secondary" disabled={retiring}>{retiring ? "Retiring…" : "Retire scenario"}</Button>
            <Feedback state={retireState} />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function EmergencyWorkspace({ scenarios, aspects, members, documents, commsPlans, canManagePlans, canRecordExercises }: {
  scenarios: ScenarioRow[];
  aspects: AspectOption[];
  members: MemberOption[];
  documents: DocumentOption[];
  commsPlans: CommsPlanOption[];
  canManagePlans: boolean;
  canRecordExercises: boolean;
}) {
  return (
    <div className="space-y-8">
      {canManagePlans && <CreateScenario aspects={aspects} />}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Emergency scenarios, plans and exercises</h2>
        {scenarios.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No emergency scenarios yet.</CardContent></Card> : scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            members={members}
            documents={documents}
            commsPlans={commsPlans}
            canManagePlans={canManagePlans}
            canRecordExercises={canRecordExercises}
          />
        ))}
      </div>
    </div>
  );
}
