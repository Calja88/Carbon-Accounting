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
  createActionProgrammeAction,
  setActionProgrammeStatusAction,
  createActionItemAction,
  reassignActionItemAction,
  setActionItemStatusAction,
  recordActionProgressAction,
  completeActionItemAction,
  verifyActionItemAction,
  reopenActionItemAction,
  runOverdueActionReminderSweepAction,
  type ActionWorkspaceState,
} from "./actions";

const emptyState: ActionWorkspaceState = { error: null, message: null };

type Option = { id: string; name: string };

export type ActionItemRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  ownerName: string;
  dueDate: string;
  overdue: boolean;
  completionCriteria: string | null;
  completionEvidenceNote: string | null;
  dependsOn: Array<{ id: string; title: string; status: string }>;
};

export type ActionProgrammeRow = {
  id: string;
  title: string;
  status: string;
  ownerName: string;
  objectiveId: string | null;
  actions: ActionItemRow[];
};

function Feedback({ state }: { state: ActionWorkspaceState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE" || status === "VERIFIED" || status === "COMPLETED") return "success";
  if (status === "CANCELLED") return "danger";
  if (status === "BLOCKED" || status === "REOPENED") return "warning";
  if (status === "IN_PROGRESS" || status === "ON_HOLD") return "info";
  return "neutral";
}

function CreateProgrammeForm({ members, objectives }: { members: Option[]; objectives: Option[] }) {
  const [state, formAction, pending] = useActionState(createActionProgrammeAction, emptyState);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="programme-title">Title</Label>
          <Input id="programme-title" name="title" required placeholder="Synthetic example: Pilot-site waste reduction programme" />
        </div>
        <div>
          <Label htmlFor="programme-owner">Owner</Label>
          <Select id="programme-owner" name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="programme-objective">Supports objective (optional)</Label>
          <Select id="programme-objective" name="objectiveId" defaultValue="">
            <option value="">No linked objective</option>
            {objectives.map((objective) => <option key={objective.id} value={objective.id}>{objective.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="programme-target-date">Target date (optional)</Label>
          <Input id="programme-target-date" name="targetDate" type="date" />
        </div>
      </div>
      <div>
        <Label htmlFor="programme-resources">Resources (optional)</Label>
        <Textarea id="programme-resources" name="resourcesDescription" rows={2} placeholder="Fictional resourcing notes only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create programme"}</Button>
    </form>
  );
}

function CreateActionForm({ programmes, members }: { programmes: Option[]; members: Option[] }) {
  const [state, formAction, pending] = useActionState(createActionItemAction, emptyState);
  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="action-programme">Programme</Label>
          <Select id="action-programme" name="programmeId" required defaultValue="">
            <option value="" disabled>Choose a programme</option>
            {programmes.map((programme) => <option key={programme.id} value={programme.id}>{programme.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="action-owner">Owner</Label>
          <Select id="action-owner" name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="action-title">Title</Label>
          <Input id="action-title" name="title" required placeholder="Synthetic example: Install fictional pilot-site segregation bins" />
        </div>
        <div>
          <Label htmlFor="action-priority">Priority</Label>
          <Select id="action-priority" name="priority" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="action-due-date">Due date</Label>
          <Input id="action-due-date" name="dueDate" type="date" required />
        </div>
      </div>
      <div>
        <Label htmlFor="action-completion-criteria">Completion criteria (optional)</Label>
        <Textarea id="action-completion-criteria" name="completionCriteria" rows={2} placeholder="What must be true for this action to be complete." />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create action"}</Button>
    </form>
  );
}

function ActionCard({ action, members, canManage }: { action: ActionItemRow; members: Option[]; canManage: boolean }) {
  const [reassignState, reassignAction, reassignPending] = useActionState(reassignActionItemAction, emptyState);
  const [statusState, statusAction, statusPending] = useActionState(setActionItemStatusAction, emptyState);
  const [progressState, progressAction, progressPending] = useActionState(recordActionProgressAction, emptyState);
  const [completeState, completeAction, completePending] = useActionState(completeActionItemAction, emptyState);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyActionItemAction, emptyState);
  const [reopenState, reopenAction, reopenPending] = useActionState(reopenActionItemAction, emptyState);

  const closed = action.status === "COMPLETED" || action.status === "VERIFIED" || action.status === "CANCELLED";

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{action.title}</p>
            <p className="text-xs text-slate-500">
              Owner: {action.ownerName} · Priority: {action.priority} · Due {action.dueDate}
              {action.overdue && <span className="ml-1 font-semibold text-red-600">(overdue)</span>}
            </p>
          </div>
          <Badge tone={statusTone(action.status)}>{action.status}</Badge>
        </div>

        {action.dependsOn.length > 0 && (
          <p className="text-xs text-slate-500">
            Depends on: {action.dependsOn.map((d) => `${d.title} (${d.status})`).join(", ")}
          </p>
        )}
        {action.completionEvidenceNote && (
          <p className="text-xs text-slate-600">Completion evidence: {action.completionEvidenceNote}</p>
        )}

        {!canManage && (
          <p className="text-xs text-slate-500">Read-only — you don&apos;t hold the action-management permission.</p>
        )}

        {canManage && !closed && (
          <div className="grid gap-3 sm:grid-cols-2">
            <form action={statusAction} className="space-y-1">
              <input type="hidden" name="actionItemId" value={action.id} />
              <Label htmlFor={`status-${action.id}`}>Change status</Label>
              <div className="flex gap-2">
                <Select id={`status-${action.id}`} name="status" defaultValue="IN_PROGRESS" className="flex-1">
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="BLOCKED">Blocked</option>
                  <option value="CANCELLED">Cancel</option>
                </Select>
                <Button type="submit" variant="secondary" disabled={statusPending}>Apply</Button>
              </div>
              <Feedback state={statusState} />
            </form>

            <form action={reassignAction} className="space-y-1">
              <input type="hidden" name="actionItemId" value={action.id} />
              <Label htmlFor={`reassign-owner-${action.id}`}>Reassign owner</Label>
              <div className="flex gap-2">
                <Select id={`reassign-owner-${action.id}`} name="newOwnerMembershipId" defaultValue="" className="flex-1">
                  <option value="" disabled>Choose owner</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </Select>
                <Button type="submit" variant="secondary" disabled={reassignPending}>Reassign</Button>
              </div>
              <Feedback state={reassignState} />
            </form>

            <form action={progressAction} className="space-y-1 sm:col-span-2">
              <input type="hidden" name="actionItemId" value={action.id} />
              <Label htmlFor={`progress-note-${action.id}`}>Record progress</Label>
              <div className="flex gap-2">
                <Input aria-label="Progress percent" name="progressPercent" type="number" min={0} max={100} placeholder="%" className="w-20" />
                <Input id={`progress-note-${action.id}`} name="note" placeholder="Progress note" required className="flex-1" />
                <Button type="submit" variant="secondary" disabled={progressPending}>Record</Button>
              </div>
              <Feedback state={progressState} />
            </form>

            <form action={completeAction} className="space-y-1 sm:col-span-2">
              <input type="hidden" name="actionItemId" value={action.id} />
              <Label htmlFor={`completion-evidence-${action.id}`}>Complete action</Label>
              <div className="flex gap-2">
                <Input id={`completion-evidence-${action.id}`} name="completionEvidenceNote" placeholder="Completion evidence note" required className="flex-1" />
                <Button type="submit" disabled={completePending}>Complete</Button>
              </div>
              <p className="text-xs text-slate-500">Completing an action never marks a linked objective achieved.</p>
              <Feedback state={completeState} />
            </form>
          </div>
        )}

        {canManage && action.status === "COMPLETED" && (
          <form action={verifyAction} className="flex items-center gap-2">
            <input type="hidden" name="actionItemId" value={action.id} />
            <Button type="submit" variant="secondary" disabled={verifyPending}>Verify completion</Button>
            <Feedback state={verifyState} />
          </form>
        )}

        {canManage && closed && (
          <form action={reopenAction} className="space-y-1">
            <input type="hidden" name="actionItemId" value={action.id} />
            <Label htmlFor={`reopen-reason-${action.id}`}>Reopen (only path to change a closed action)</Label>
            <div className="flex gap-2">
              <Input id={`reopen-reason-${action.id}`} name="reopenReason" placeholder="Reason for reopening" required className="flex-1" />
              <Button type="submit" variant="secondary" disabled={reopenPending}>Reopen</Button>
            </div>
            <Feedback state={reopenState} />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function programmeProgress(programme: ActionProgrammeRow) {
  const total = programme.actions.length;
  if (total === 0) return null;
  const closed = programme.actions.filter((a) => a.status === "COMPLETED" || a.status === "VERIFIED").length;
  const overdue = programme.actions.filter((a) => a.overdue).length;
  return { total, closed, overdue, percent: Math.round((closed / total) * 100) };
}

function ProgrammeCard({
  programme,
  members,
  canManage,
  objectiveName,
}: {
  programme: ActionProgrammeRow;
  members: Option[];
  canManage: boolean;
  objectiveName: string | null;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setActionProgrammeStatusAction, emptyState);
  const progress = programmeProgress(programme);
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{programme.title}</p>
            <p className="text-xs text-slate-500">
              Owner: {programme.ownerName}
              {programme.objectiveId && (
                <>
                  {" · Supports objective: "}
                  <a href="/ems/objectives" className="underline underline-offset-2 hover:text-slate-900">
                    {objectiveName ?? programme.objectiveId}
                  </a>
                </>
              )}
            </p>
            {progress && (
              <p className="mt-1 text-xs text-slate-500">
                {progress.closed}/{progress.total} actions closed ({progress.percent}%)
                {progress.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {progress.overdue} overdue</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(programme.status)}>{programme.status}</Badge>
            {canManage && (
              <form action={statusAction} className="flex items-center gap-1">
                <input type="hidden" name="programmeId" value={programme.id} />
                <Select aria-label="Programme status" name="status" defaultValue={programme.status} className="text-xs">
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </Select>
                <Button type="submit" variant="secondary" size="sm" disabled={statusPending}>Set</Button>
              </form>
            )}
          </div>
        </div>
        <Feedback state={statusState} />
        <div className="space-y-3">
          {programme.actions.length === 0 && <p className="text-sm text-slate-500">No actions yet.</p>}
          {programme.actions.map((action) => (
            <ActionCard key={action.id} action={action} members={members} canManage={canManage} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ActionsWorkspace({
  programmes,
  members,
  objectives,
  canManage,
}: {
  programmes: ActionProgrammeRow[];
  members: Option[];
  objectives: Option[];
  canManage: boolean;
}) {
  const [sweepState, sweepAction, sweepPending] = useActionState(runOverdueActionReminderSweepAction, emptyState);
  const objectiveNameById = new Map(objectives.map((o) => [o.id, o.name]));
  return (
    <div className="space-y-8">
      {canManage && (
        <>
          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold text-slate-900">New action programme</h2>
              <CreateProgrammeForm members={members} objectives={objectives} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-4">
              <h2 className="text-lg font-semibold text-slate-900">New action</h2>
              <CreateActionForm programmes={programmes.map((p) => ({ id: p.id, name: p.title }))} members={members} />
            </CardContent>
          </Card>

          <form action={sweepAction} className="flex items-center gap-3">
            <Button type="submit" variant="secondary" disabled={sweepPending}>
              {sweepPending ? "Checking…" : "Run overdue-action reminder sweep"}
            </Button>
            <Feedback state={sweepState} />
          </form>
        </>
      )}

      {!canManage && (
        <p className="text-sm text-slate-500">
          You have read-only access to action programmes. Overdue owners are still reminded through{" "}
          <a href="/ems/notifications" className="underline underline-offset-2 hover:text-slate-900">your work queue</a>.
        </p>
      )}

      <div className="space-y-4">
        {programmes.length === 0 && <p className="text-sm text-slate-500">No action programmes yet.</p>}
        {programmes.map((programme) => (
          <ProgrammeCard
            key={programme.id}
            programme={programme}
            members={members}
            canManage={canManage}
            objectiveName={programme.objectiveId ? objectiveNameById.get(programme.objectiveId) ?? null : null}
          />
        ))}
      </div>
    </div>
  );
}
