"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  activateCompetenceRequirementVersionAction,
  approveCompetenceRequirementVersionAction,
  discardCompetenceRequirementVersionDraftAction,
  createCompetenceRequirementAction,
  createSuccessorCompetenceRequirementVersionAction,
  updateCompetenceRequirementVersionDraftAction,
  type CompetenceRequirementActionState,
} from "./actions";

const emptyState: CompetenceRequirementActionState = { error: null, message: null };

type Option = { id: string; name: string };

type ScopeSummary = { id: string; kind: string; label: string };

export type RequirementVersionRow = {
  id: string;
  requirementId: string;
  version: number;
  status: string;
  title: string;
  description: string;
  renewalRule: string | null;
  acceptableEvidence: string | null;
  preparedByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  supersedesVersionId: string | null;
  scopes: ScopeSummary[];
};

export type RequirementRow = {
  id: string;
  requirementKey: string;
  activeVersionId: string | null;
  versions: RequirementVersionRow[];
};

function Feedback({ state }: { state: CompetenceRequirementActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "SUPERSEDED") return "neutral";
  if (status === "APPROVED") return "info";
  return "warning";
}

function ScopePicker({
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
}: {
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="scope-roles">Roles</Label>
          <select id="scope-roles" name="roleIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="scope-processes">Processes</Label>
          <select id="scope-processes" name="processIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="scope-aspects">Aspects</Label>
          <select id="scope-aspects" name="aspectIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {aspects.map((aspect) => <option key={aspect.id} value={aspect.id}>{aspect.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="scope-controls">Operational controls</Label>
          <select id="scope-controls" name="controlIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {controls.map((control) => <option key={control.id} value={control.id}>{control.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="scope-obligations">Active obligations</Label>
          <select id="scope-obligations" name="obligationVersionIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {obligationVersions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="scope-emergency">Emergency scenarios</Label>
          <select id="scope-emergency" name="emergencyScenarioIds" multiple size={4} className="w-full rounded-md border border-slate-300 text-sm">
            {emergencyScenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="scope-emergency-role-label">Emergency role label (optional, no matching scenario above)</Label>
        <Input id="scope-emergency-role-label" name="emergencyRoleLabel" placeholder="e.g. Fire warden" />
      </div>
      <p className="text-xs text-slate-500">Select at least one scope target (ctrl/cmd-click for multiple), or enter an emergency role label.</p>
    </div>
  );
}

function DraftFields({
  defaultVersion,
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
}: {
  defaultVersion?: RequirementVersionRow;
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
}) {
  return (
    <>
      <div>
        <Label htmlFor="requirement-title">Title</Label>
        <Input id="requirement-title" name="title" required defaultValue={defaultVersion?.title} placeholder="Synthetic example: Confined space entry competence" />
      </div>
      <div>
        <Label htmlFor="requirement-description">Description</Label>
        <Textarea id="requirement-description" name="description" required rows={3} defaultValue={defaultVersion?.description} placeholder="Synthetic requirement text only." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="requirement-renewal">Renewal rule (optional)</Label>
          <Input id="requirement-renewal" name="renewalRule" defaultValue={defaultVersion?.renewalRule ?? ""} placeholder="e.g. Renew every 3 years" />
        </div>
        <div>
          <Label htmlFor="requirement-evidence">Acceptable evidence (optional)</Label>
          <Input id="requirement-evidence" name="acceptableEvidence" defaultValue={defaultVersion?.acceptableEvidence ?? ""} placeholder="e.g. Accredited certificate" />
        </div>
      </div>
      <ScopePicker
        roles={roles}
        processes={processes}
        aspects={aspects}
        controls={controls}
        obligationVersions={obligationVersions}
        emergencyScenarios={emergencyScenarios}
      />
    </>
  );
}

function CreateRequirementForm({
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
}: {
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
}) {
  const [state, action, pending] = useActionState(createCompetenceRequirementAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div>
        <Label htmlFor="requirement-key">Requirement key</Label>
        <Input id="requirement-key" name="requirementKey" required placeholder="e.g. CONFINED_SPACE_ENTRY" />
      </div>
      <DraftFields roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft requirement"}</Button>
    </form>
  );
}

function EditDraftForm({
  version,
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
}: {
  version: RequirementVersionRow;
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
}) {
  const [state, action, pending] = useActionState(updateCompetenceRequirementVersionDraftAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="versionId" value={version.id} />
      <DraftFields defaultVersion={version} roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save draft"}</Button>
    </form>
  );
}

function ApproveButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState(approveCompetenceRequirementVersionAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Approving…" : "Approve version"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function DiscardDraftButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState(discardCompetenceRequirementVersionDraftAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="versionId" value={versionId} />
      <Button
        type="submit"
        variant="danger"
        disabled={pending}
        onClick={(event) => { if (!confirm("Discard this draft requirement version? This cannot be undone.")) event.preventDefault(); }}
      >
        {pending ? "Discarding…" : "Discard draft"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function ActivateButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState(activateCompetenceRequirementVersionAction, emptyState);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" disabled={pending}>{pending ? "Activating…" : "Activate version"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function SuccessorForm({
  requirementId,
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
}: {
  requirementId: string;
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
}) {
  const [state, action, pending] = useActionState(createSuccessorCompetenceRequirementVersionAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="requirementId" value={requirementId} />
      <div>
        <Label htmlFor="successor-rationale">Revision rationale</Label>
        <Textarea id="successor-rationale" name="revisionRationale" required rows={2} placeholder="Why is this requirement changing?" />
      </div>
      <DraftFields roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create successor draft"}</Button>
    </form>
  );
}

function VersionCard({
  version,
  requirementId,
  isActive,
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
  canEdit,
}: {
  version: RequirementVersionRow;
  requirementId: string;
  isActive: boolean;
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">v{version.version} · {version.title}</p>
            <p className="text-xs text-slate-500">
              prepared by {version.preparedByUserId}
              {version.approvedByUserId ? ` · approved by ${version.approvedByUserId}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isActive && <Badge tone="success">Current version</Badge>}
            <Badge tone={statusTone(version.status)}>{version.status}</Badge>
          </div>
        </div>
        <p className="text-sm text-slate-600">{version.description}</p>
        {(version.renewalRule || version.acceptableEvidence) && (
          <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            {version.renewalRule && (
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Renewal rule</dt>
                <dd>{version.renewalRule}</dd>
              </div>
            )}
            {version.acceptableEvidence && (
              <div>
                <dt className="font-semibold uppercase tracking-wide text-slate-500">Acceptable evidence</dt>
                <dd>{version.acceptableEvidence}</dd>
              </div>
            )}
          </dl>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scopes</p>
          {version.scopes.length === 0 ? (
            <p className="mt-1 text-sm text-amber-700">No scopes recorded.</p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-1">
              {version.scopes.map((scope) => (
                <li key={scope.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs">{scope.kind}: {scope.label}</li>
              ))}
            </ul>
          )}
        </div>

        {version.status === "DRAFT" && canEdit && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit draft</summary>
            <div className="mt-3">
              <EditDraftForm version={version} roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
            </div>
          </details>
        )}
        {version.status === "DRAFT" && canEdit && <ApproveButton versionId={version.id} />}
        {version.status === "DRAFT" && canEdit && <DiscardDraftButton versionId={version.id} />}
        {version.status === "APPROVED" && canEdit && <ActivateButton versionId={version.id} />}
        {version.status === "ACTIVE" && canEdit && (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-blue-700">Create successor version</summary>
            <div className="mt-3">
              <SuccessorForm requirementId={requirementId} roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export function CompetenceRequirementWorkspace({
  requirements,
  roles,
  processes,
  aspects,
  controls,
  obligationVersions,
  emergencyScenarios,
  canEdit,
}: {
  requirements: RequirementRow[];
  roles: Option[];
  processes: Option[];
  aspects: Option[];
  controls: Option[];
  obligationVersions: Option[];
  emergencyScenarios: Option[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-8">
      {canEdit && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Create a competence requirement</h2>
          <CreateRequirementForm roles={roles} processes={processes} aspects={aspects} controls={controls} obligationVersions={obligationVersions} emergencyScenarios={emergencyScenarios} />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Competence requirements</h2>
        {requirements.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No competence requirements yet.</CardContent></Card>
        ) : (
          requirements.map((requirement) => (
            <div key={requirement.id} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{requirement.requirementKey}</p>
              {requirement.versions.map((version) => (
                <VersionCard
                  key={version.id}
                  version={version}
                  requirementId={requirement.id}
                  isActive={requirement.activeVersionId === version.id}
                  roles={roles}
                  processes={processes}
                  aspects={aspects}
                  controls={controls}
                  obligationVersions={obligationVersions}
                  emergencyScenarios={emergencyScenarios}
                  canEdit={canEdit}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
