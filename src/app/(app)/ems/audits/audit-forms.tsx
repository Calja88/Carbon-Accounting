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
  createAuditProgrammeAction,
  approveAuditProgrammeAction,
  activateAuditProgrammeAction,
  completeAuditProgrammeAction,
  createAuditProgrammeItemAction,
  createEmsAuditAction,
  rescheduleEmsAuditAction,
  assignAuditTeamMemberAction,
  removeAuditTeamMemberAction,
  startAuditPreparationAction,
  startAuditExecutionAction,
  type AuditActionState,
} from "./actions";

const emptyState: AuditActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type ProgrammeItemRow = {
  id: string;
  title: string;
  priority: string;
  plannedStart: string;
  plannedEnd: string;
  scopeLabels: string[];
};

export type AuditTeamMemberRow = {
  id: string;
  membershipId: string;
  memberName: string;
  role: string;
  independenceDeclared: boolean;
  conflictDeclared: boolean;
  conflictNotes: string | null;
};

export type EmsAuditRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  leadName: string;
  scheduledStart: string;
  scheduledEnd: string;
  scopeLabels: string[];
  team: AuditTeamMemberRow[];
};

export type CoverageDimension = { totalCount: number; coveredCount: number };

export type ProgrammeRow = {
  id: string;
  name: string;
  status: string;
  riskBasis: string;
  ownerName: string;
  periodStart: string;
  periodEnd: string;
  items: ProgrammeItemRow[];
  audits: EmsAuditRow[];
  coverage: {
    sites: CoverageDimension;
    processes: CoverageDimension;
    aspects: CoverageDimension;
    obligations: CoverageDimension;
    requirements: CoverageDimension;
  } | null;
};

function Feedback({ state }: { state: AuditActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function programmeStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "APPROVED") return "info";
  if (status === "COMPLETED") return "neutral";
  if (status === "SUPERSEDED") return "danger";
  return "warning";
}

function auditStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "IN_PROGRESS") return "success";
  if (status === "PREPARATION") return "info";
  if (status === "CLOSED" || status === "REPORT_ISSUED") return "neutral";
  return "warning";
}

function CreateProgrammeForm({ members }: { members: Option[] }) {
  const [state, action, pending] = useActionState(createAuditProgrammeAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="programme-name">Name</Label>
          <Input id="programme-name" name="name" required placeholder="Synthetic example: 2026 Internal Audit Programme" />
        </div>
        <div>
          <Label htmlFor="programme-owner">Owner</Label>
          <Select id="programme-owner" name="ownerMembershipId" required defaultValue="">
            <option value="" disabled>Choose an owner</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="programme-period-start">Period start</Label>
          <Input id="programme-period-start" name="periodStart" type="date" required />
        </div>
        <div>
          <Label htmlFor="programme-period-end">Period end</Label>
          <Input id="programme-period-end" name="periodEnd" type="date" required />
        </div>
      </div>
      <div>
        <Label htmlFor="programme-risk-basis">Risk basis</Label>
        <Textarea id="programme-risk-basis" name="riskBasis" rows={2} required placeholder="Why this programme prioritises what it does — synthetic example only." />
      </div>
      <div>
        <Label htmlFor="programme-objectives">Objectives (optional)</Label>
        <Textarea id="programme-objectives" name="objectives" rows={2} placeholder="Synthetic example only." />
      </div>
      <div>
        <Label htmlFor="programme-description">Description (optional)</Label>
        <Textarea id="programme-description" name="description" rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create programme"}</Button>
    </form>
  );
}

function ProgrammeLifecycleButtons({ programme }: { programme: ProgrammeRow }) {
  const [approveState, approveAction, approvePending] = useActionState(approveAuditProgrammeAction, emptyState);
  const [activateState, activateAction, activatePending] = useActionState(activateAuditProgrammeAction, emptyState);
  const [completeState, completeAction, completePending] = useActionState(completeAuditProgrammeAction, emptyState);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {programme.status === "DRAFT" && (
        <form action={approveAction}>
          <input type="hidden" name="programmeId" value={programme.id} />
          <Button type="submit" size="sm" disabled={approvePending}>{approvePending ? "Approving…" : "Approve"}</Button>
        </form>
      )}
      {programme.status === "APPROVED" && (
        <form action={activateAction}>
          <input type="hidden" name="programmeId" value={programme.id} />
          <Button type="submit" size="sm" disabled={activatePending}>{activatePending ? "Activating…" : "Activate"}</Button>
        </form>
      )}
      {programme.status === "ACTIVE" && (
        <form action={completeAction}>
          <input type="hidden" name="programmeId" value={programme.id} />
          <Button type="submit" size="sm" variant="secondary" disabled={completePending}>{completePending ? "Completing…" : "Mark complete"}</Button>
        </form>
      )}
      <Feedback state={approveState} />
      <Feedback state={activateState} />
      <Feedback state={completeState} />
    </div>
  );
}

function CreateProgrammeItemForm({ programmeId, entities, sites }: { programmeId: string; entities: Option[]; sites: Option[] }) {
  const [state, action, pending] = useActionState(createAuditProgrammeItemAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-200 p-3">
      <input type="hidden" name="programmeId" value={programmeId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`item-title-${programmeId}`}>Title</Label>
          <Input id={`item-title-${programmeId}`} name="title" required placeholder="Synthetic example: North site audit" />
        </div>
        <div>
          <Label htmlFor={`item-priority-${programmeId}`}>Priority</Label>
          <Select id={`item-priority-${programmeId}`} name="priority" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`item-planned-start-${programmeId}`}>Planned start</Label>
          <Input id={`item-planned-start-${programmeId}`} name="plannedStart" type="date" required />
        </div>
        <div>
          <Label htmlFor={`item-planned-end-${programmeId}`}>Planned end</Label>
          <Input id={`item-planned-end-${programmeId}`} name="plannedEnd" type="date" required />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`item-entities-${programmeId}`}>Entities in scope</Label>
          <select id={`item-entities-${programmeId}`} name="entityIds" multiple size={3} className="w-full rounded-md border border-slate-300 text-sm">
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`item-sites-${programmeId}`}>Sites in scope</Label>
          <select id={`item-sites-${programmeId}`} name="siteIds" multiple size={3} className="w-full rounded-md border border-slate-300 text-sm">
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor={`item-rationale-${programmeId}`}>Rationale (optional)</Label>
        <Textarea id={`item-rationale-${programmeId}`} name="rationale" rows={2} placeholder="Synthetic example only." />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Adding…" : "Add planned audit"}</Button>
    </form>
  );
}

function CreateEmsAuditForm({
  programmeId,
  items,
  members,
  entities,
  sites,
}: {
  programmeId: string;
  items: ProgrammeItemRow[];
  members: Option[];
  entities: Option[];
  sites: Option[];
}) {
  const [state, action, pending] = useActionState(createEmsAuditAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-200 p-3">
      <input type="hidden" name="programmeId" value={programmeId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`audit-title-${programmeId}`}>Title</Label>
          <Input id={`audit-title-${programmeId}`} name="title" required placeholder="Synthetic example: Site North internal audit" />
        </div>
        <div>
          <Label htmlFor={`audit-type-${programmeId}`}>Type</Label>
          <Select id={`audit-type-${programmeId}`} name="type" defaultValue="INTERNAL">
            <option value="INTERNAL">Internal</option>
            <option value="SUPPLIER">Supplier</option>
            <option value="COMPLIANCE">Compliance</option>
            <option value="SYSTEM">System</option>
            <option value="PROCESS">Process</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`audit-programme-item-${programmeId}`}>Planned audit (optional)</Label>
          <Select id={`audit-programme-item-${programmeId}`} name="programmeItemId" defaultValue="">
            <option value="">None</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`audit-lead-${programmeId}`}>Lead auditor</Label>
          <Select id={`audit-lead-${programmeId}`} name="leadMembershipId" required defaultValue="">
            <option value="" disabled>Choose a lead auditor</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`audit-scheduled-start-${programmeId}`}>Scheduled start</Label>
          <Input id={`audit-scheduled-start-${programmeId}`} name="scheduledStart" type="date" required />
        </div>
        <div>
          <Label htmlFor={`audit-scheduled-end-${programmeId}`}>Scheduled end</Label>
          <Input id={`audit-scheduled-end-${programmeId}`} name="scheduledEnd" type="date" required />
        </div>
      </div>
      <div>
        <Label htmlFor={`audit-criteria-summary-${programmeId}`}>Criteria summary</Label>
        <Textarea id={`audit-criteria-summary-${programmeId}`} name="criteriaSummary" rows={2} required placeholder="Synthetic example: ISO 14001:2015 clause 9.2, controlled procedure PROC-04." />
      </div>
      <div>
        <Label htmlFor={`audit-objectives-${programmeId}`}>Objectives (optional)</Label>
        <Textarea id={`audit-objectives-${programmeId}`} name="objectives" rows={2} placeholder="Synthetic example only." />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`audit-entities-${programmeId}`}>Entities in scope</Label>
          <select id={`audit-entities-${programmeId}`} name="entityIds" multiple size={3} className="w-full rounded-md border border-slate-300 text-sm">
            {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`audit-sites-${programmeId}`}>Sites in scope</Label>
          <select id={`audit-sites-${programmeId}`} name="siteIds" multiple size={3} className="w-full rounded-md border border-slate-300 text-sm">
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Scheduling…" : "Schedule audit"}</Button>
    </form>
  );
}

function RescheduleAuditForm({ auditId }: { auditId: string }) {
  const [state, action, pending] = useActionState(rescheduleEmsAuditAction, emptyState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="auditId" value={auditId} />
      <div>
        <Label htmlFor={`reschedule-start-${auditId}`}>New start</Label>
        <Input id={`reschedule-start-${auditId}`} name="scheduledStart" type="date" required />
      </div>
      <div>
        <Label htmlFor={`reschedule-end-${auditId}`}>New end</Label>
        <Input id={`reschedule-end-${auditId}`} name="scheduledEnd" type="date" required />
      </div>
      <div>
        <Label htmlFor={`reschedule-reason-${auditId}`}>Reason (optional)</Label>
        <Input id={`reschedule-reason-${auditId}`} name="reason" placeholder="Synthetic example only." />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Rescheduling…" : "Reschedule"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function AssignTeamMemberForm({ auditId, members }: { auditId: string; members: Option[] }) {
  const [state, action, pending] = useActionState(assignAuditTeamMemberAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded-md border border-dashed border-slate-300 p-3">
      <input type="hidden" name="auditId" value={auditId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`team-member-${auditId}`}>Team member</Label>
          <Select id={`team-member-${auditId}`} name="membershipId" required defaultValue="">
            <option value="" disabled>Choose a member</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`team-role-${auditId}`}>Role</Label>
          <Select id={`team-role-${auditId}`} name="role" defaultValue="AUDITOR">
            <option value="LEAD_AUDITOR">Lead auditor</option>
            <option value="AUDITOR">Auditor</option>
            <option value="TECHNICAL_EXPERT">Technical expert</option>
            <option value="OBSERVER">Observer</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="independenceDeclared" />
          Independence declared (no conflict)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="conflictDeclared" />
          Conflict of interest declared
        </label>
      </div>
      <div>
        <Label htmlFor={`conflict-notes-${auditId}`}>Conflict notes (required if a conflict is declared)</Label>
        <Textarea id={`conflict-notes-${auditId}`} name="conflictNotes" rows={2} placeholder="Synthetic example only." />
      </div>
      <p className="text-xs text-slate-500">
        A declared conflict blocks a lead auditor/auditor assignment outright — it may still be recorded for a
        technical expert or observer.
      </p>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Assigning…" : "Assign to team"}</Button>
    </form>
  );
}

function RemoveTeamMemberButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState(removeAuditTeamMemberAction, emptyState);
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="memberId" value={memberId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>{pending ? "Removing…" : "Remove"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function AuditLifecycleButtons({ auditId, status }: { auditId: string; status: string }) {
  const [prepState, prepAction, prepPending] = useActionState(startAuditPreparationAction, emptyState);
  const [startState, startAction, startPending] = useActionState(startAuditExecutionAction, emptyState);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "PLANNED" && (
        <form action={prepAction}>
          <input type="hidden" name="auditId" value={auditId} />
          <Button type="submit" size="sm" disabled={prepPending}>{prepPending ? "Starting…" : "Start preparation"}</Button>
        </form>
      )}
      {status === "PREPARATION" && (
        <form action={startAction}>
          <input type="hidden" name="auditId" value={auditId} />
          <Button type="submit" size="sm" disabled={startPending}>{startPending ? "Starting…" : "Start execution"}</Button>
        </form>
      )}
      <Feedback state={prepState} />
      <Feedback state={startState} />
    </div>
  );
}

function CoverageSummary({ coverage }: { coverage: NonNullable<ProgrammeRow["coverage"]> }) {
  const dims: Array<[string, CoverageDimension]> = [
    ["Sites", coverage.sites],
    ["Processes", coverage.processes],
    ["Aspects", coverage.aspects],
    ["Obligations", coverage.obligations],
    ["Requirements", coverage.requirements],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {dims.map(([label, dim]) => (
        <div key={label} className="rounded-md border border-slate-200 p-2 text-center">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-sm font-semibold text-slate-900">{dim.coveredCount} / {dim.totalCount}</p>
        </div>
      ))}
    </div>
  );
}

function AuditCard({ audit, members }: { audit: EmsAuditRow; members: Option[] }) {
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{audit.title}</p>
          <p className="text-xs text-slate-500">{audit.type} · {audit.leadName} · {audit.scheduledStart} → {audit.scheduledEnd}</p>
        </div>
        <Badge tone={auditStatusTone(audit.status)}>{audit.status}</Badge>
      </div>
      {audit.scopeLabels.length > 0 && <p className="text-xs text-slate-500">Scope: {audit.scopeLabels.join(", ")}</p>}
      <Link href={`/ems/audits/${audit.id}`} className="text-sm font-medium text-blue-700 hover:underline">
        Checklist, findings and report →
      </Link>
      <AuditLifecycleButtons auditId={audit.id} status={audit.status} />
      <RescheduleAuditForm auditId={audit.id} />
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Team</p>
        {audit.team.map((member) => (
          <div key={member.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm">
            <span>
              {member.memberName} — {member.role}
              {member.independenceDeclared && <span className="ml-2 text-xs text-emerald-700">independence declared</span>}
              {member.conflictDeclared && <span className="ml-2 text-xs text-amber-700">conflict declared</span>}
            </span>
            <RemoveTeamMemberButton memberId={member.id} />
          </div>
        ))}
        <AssignTeamMemberForm auditId={audit.id} members={members} />
      </div>
    </div>
  );
}

export function AuditProgrammeWorkspace({
  programmes,
  members,
  entities,
  sites,
}: {
  programmes: ProgrammeRow[];
  members: Option[];
  entities: Option[];
  sites: Option[];
}) {
  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-lg font-semibold text-slate-900">New audit programme</h2>
          <CreateProgrammeForm members={members} />
        </CardContent>
      </Card>

      <div className="space-y-6">
        {programmes.length === 0 && <p className="text-sm text-slate-500">No audit programmes yet.</p>}
        {programmes.map((programme) => (
          <Card key={programme.id}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{programme.name}</h3>
                  <p className="text-xs text-slate-500">
                    {programme.ownerName} · {programme.periodStart} → {programme.periodEnd}
                  </p>
                </div>
                <Badge tone={programmeStatusTone(programme.status)}>{programme.status}</Badge>
              </div>
              <p className="text-sm text-slate-600">{programme.riskBasis}</p>
              <ProgrammeLifecycleButtons programme={programme} />

              {programme.coverage && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">Coverage</p>
                  <CoverageSummary coverage={programme.coverage} />
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Planned audits</p>
                {programme.items.length === 0 && <p className="text-sm text-slate-500">No planned audits yet.</p>}
                {programme.items.map((item) => (
                  <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <span className="font-medium">{item.title}</span> — {item.priority} — {item.plannedStart} → {item.plannedEnd}
                    {item.scopeLabels.length > 0 && <span className="text-xs text-slate-500"> ({item.scopeLabels.join(", ")})</span>}
                  </div>
                ))}
                {programme.status !== "COMPLETED" && programme.status !== "SUPERSEDED" && (
                  <CreateProgrammeItemForm programmeId={programme.id} entities={entities} sites={sites} />
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Audits</p>
                {programme.audits.length === 0 && <p className="text-sm text-slate-500">No audits scheduled yet.</p>}
                {programme.audits.map((audit) => (
                  <AuditCard key={audit.id} audit={audit} members={members} />
                ))}
                {programme.status === "ACTIVE" && (
                  <CreateEmsAuditForm programmeId={programme.id} items={programme.items} members={members} entities={entities} sites={sites} />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
