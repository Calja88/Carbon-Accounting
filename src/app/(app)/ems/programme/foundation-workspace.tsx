"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createProgrammeAction,
  activateProgrammeAction,
  suspendProgrammeAction,
  closeProgrammeAction,
  createScopeVersionAction,
  submitScopeVersionAction,
  approveScopeVersionAction,
  addScopeEntityAction,
  addScopeSiteAction,
  addScopeActivityAction,
  createContextIssueAction,
  createInterestedPartyAction,
  deactivateInterestedPartyAction,
  createInterestedPartyRequirementAction,
  createRiskOpportunityAction,
  recordResidualRatingAction,
  createChangeAssessmentAction,
  submitChangeAssessmentAction,
  approveChangeAssessmentAction,
  implementChangeAssessmentAction,
  effectivenessReviewAction,
  type FoundationActionState,
} from "./actions";

const emptyState: FoundationActionState = { error: null, message: null };

function Feedback({ state }: { state: FoundationActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MemberOption = { id: string; name: string };
type EntityOption = { id: string; name: string };
type SiteOption = { id: string; name: string; entityId: string };

type ProgrammeRow = {
  id: string;
  name: string;
  status: string;
  standardsProfile: string;
  standardsProfileVersion: string;
  certificationIntent: string;
  currentScopeVersionId: string | null;
  createdAt: string;
};

type ScopeVersionRow = {
  id: string;
  versionNumber: number;
  statement: string;
  status: string;
  exclusions: string | null;
  exclusionsRationale: string | null;
  effectiveDate: string | null;
  entities: Array<{ id: string; name: string }>;
  sites: Array<{ id: string; name: string }>;
  activities: Array<{ id: string; description: string; siteName: string | null }>;
};

type RequirementMapRow = {
  id: string;
  standardProfile: string;
  requirementKey: string;
  implementationStatus: string;
  gapStatus: string;
};

type ContextIssueRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  direction: string;
  significance: string | null;
  reviewDate: string | null;
};

type InterestedPartyRow = {
  id: string;
  name: string;
  type: string;
  influence: string | null;
  isActive: boolean;
  requirements: Array<{ id: string; summary: string; sourceReference: string | null; isMandatory: boolean }>;
};

type RiskRow = {
  id: string;
  kind: string;
  category: string;
  description: string;
  consequence: string | null;
  likelihood: string | null;
  status: string;
  ratingScaleVersion: string;
  initialRating: Record<string, unknown>;
  residualRating: Record<string, unknown> | null;
};

type ChangeRow = {
  id: string;
  proposedChange: string;
  triggerType: string;
  status: string;
  decision: string | null;
  assessment: string | null;
  effectivenessReview: string | null;
};

const TABS = ["overview", "scope", "context", "parties", "risks", "changes"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview & status",
  scope: "Scope & boundaries",
  context: "Organisation context",
  parties: "Interested parties",
  risks: "Risks & opportunities",
  changes: "Change control",
};

function ratingText(rating: Record<string, unknown> | null): string {
  if (!rating) return "Not recorded";
  const value = rating["value"];
  return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(rating);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function ProgrammeSelector({ programmes, selectedProgrammeId }: { programmes: ProgrammeRow[]; selectedProgrammeId: string | null }) {
  const router = useRouter();
  if (programmes.length <= 1) return null;
  return (
    <div className="max-w-sm">
      <Label>Programme</Label>
      <Select
        defaultValue={selectedProgrammeId ?? ""}
        onChange={(event) => router.push(`/ems/programme?programmeId=${event.target.value}`)}
      >
        {programmes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.status.toLowerCase()})
          </option>
        ))}
      </Select>
    </div>
  );
}

function CreateProgrammeForm({ members }: { members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createProgrammeAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Create EMS programme</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <div><Label>Programme name</Label><Input name="name" required placeholder="Synthetic environmental management programme" /></div>
          <div><Label>Standards profile</Label><Input name="standardsProfile" required placeholder="ISO14001" /></div>
          <div><Label>Profile version</Label><Input name="standardsProfileVersion" required placeholder="2015" /></div>
          <div>
            <Label>Certification intent</Label>
            <Select name="certificationIntent" defaultValue="NONE">
              <option value="NONE">None</option>
              <option value="PLANNED">Planned</option>
              <option value="CERTIFIED_EXTERNALLY">Certified externally</option>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Owner (optional)</Label>
            <Select name="ownerMembershipId" defaultValue="">
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
          <div className="sm:col-span-2"><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create programme"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ProgrammeStatusCard({ programme, canManage }: { programme: ProgrammeRow; canManage: boolean }) {
  const [activateState, activateAction, activating] = useActionState(activateProgrammeAction, emptyState);
  const [suspendState, suspendAction, suspending] = useActionState(suspendProgrammeAction, emptyState);
  const [closeState, closeAction, closing] = useActionState(closeProgrammeAction, emptyState);
  const tone = programme.status === "ACTIVE" ? "success" : programme.status === "CLOSED" ? "neutral" : "warning";
  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{programme.name}</h3>
          <Badge tone={tone}>{programme.status.toLowerCase()}</Badge>
          <Badge>{programme.standardsProfile} {programme.standardsProfileVersion}</Badge>
          <Badge tone="neutral">certification: {programme.certificationIntent.toLowerCase().replaceAll("_", " ")}</Badge>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {(programme.status === "DRAFT" || programme.status === "SUSPENDED") && (
              <form action={activateAction}><input type="hidden" name="programmeId" value={programme.id} /><Button type="submit" disabled={activating}>{activating ? "Activating…" : "Activate"}</Button></form>
            )}
            {programme.status === "ACTIVE" && (
              <form action={suspendAction}><input type="hidden" name="programmeId" value={programme.id} /><Button type="submit" variant="secondary" disabled={suspending}>{suspending ? "Suspending…" : "Suspend"}</Button></form>
            )}
            {programme.status !== "CLOSED" && (
              <form
                action={closeAction}
                onSubmit={(event) => { if (!window.confirm("Close this programme? This cannot be undone.")) event.preventDefault(); }}
              >
                <input type="hidden" name="programmeId" value={programme.id} />
                <Button type="submit" variant="secondary" disabled={closing}>{closing ? "Closing…" : "Close"}</Button>
              </form>
            )}
          </div>
        )}
        <Feedback state={activateState} />
        <Feedback state={suspendState} />
        <Feedback state={closeState} />
      </CardContent>
    </Card>
  );
}

function RequirementMapSummary({ requirementMaps }: { requirementMaps: RequirementMapRow[] }) {
  if (requirementMaps.length === 0) {
    return <p className="text-sm text-slate-500">No standard requirement mappings recorded yet.</p>;
  }
  const gapCount = requirementMaps.filter((r) => r.gapStatus === "GAP_IDENTIFIED").length;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">
        {requirementMaps.length} requirement mapping{requirementMaps.length === 1 ? "" : "s"} tracked
        {gapCount > 0 && <span className="text-amber-700"> · {gapCount} gap{gapCount === 1 ? "" : "s"} identified</span>}.
      </p>
      <ul className="space-y-1">
        {requirementMaps.slice(0, 8).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{r.standardProfile}</Badge>
            <span>{r.requirementKey}</span>
            <Badge tone={r.implementationStatus === "IMPLEMENTED" ? "success" : "neutral"}>{r.implementationStatus.toLowerCase().replaceAll("_", " ")}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

function CreateScopeVersionForm({ programmeId, hasVersion }: { programmeId: string; hasVersion: boolean }) {
  const [state, action, pending] = useActionState(createScopeVersionAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>{hasVersion ? "Create successor scope version" : "Create scope version"}</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="programmeId" value={programmeId} />
          <input type="hidden" name="successor" value={hasVersion ? "true" : "false"} />
          <div><Label>Scope statement</Label><Textarea name="statement" rows={3} required placeholder="Synthetic boundary statement covering included entities, sites and activities." /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Exclusions (optional)</Label><Textarea name="exclusions" rows={2} /></div>
            <div><Label>Exclusions rationale (optional)</Label><Textarea name="exclusionsRationale" rows={2} /></div>
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : hasVersion ? "Create successor version" : "Create scope version"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ScopeBoundaryEditor({ version, entities, sites }: { version: ScopeVersionRow; entities: EntityOption[]; sites: SiteOption[] }) {
  const [entityState, entityAction, entityPending] = useActionState(addScopeEntityAction, emptyState);
  const [siteState, siteAction, sitePending] = useActionState(addScopeSiteAction, emptyState);
  const [activityState, activityAction, activityPending] = useActionState(addScopeActivityAction, emptyState);
  const includedEntityIds = new Set(version.entities.map((e) => e.id));
  const availableSites = sites.filter((s) => includedEntityIds.has(s.entityId));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <form action={entityAction} className="space-y-2 rounded border border-slate-200 p-2">
        <input type="hidden" name="scopeVersionId" value={version.id} />
        <Label>Add entity</Label>
        <Select name="entityId" defaultValue=""><option value="">Select…</option>{entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        <Button type="submit" variant="secondary" size="sm" disabled={entityPending}>{entityPending ? "Adding…" : "Add entity"}</Button>
        <Feedback state={entityState} />
      </form>
      <form action={siteAction} className="space-y-2 rounded border border-slate-200 p-2">
        <input type="hidden" name="scopeVersionId" value={version.id} />
        <Label>Add site</Label>
        <Select name="siteId" defaultValue=""><option value="">Select…</option>{availableSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Button type="submit" variant="secondary" size="sm" disabled={sitePending || availableSites.length === 0}>{sitePending ? "Adding…" : "Add site"}</Button>
        <Feedback state={siteState} />
        {availableSites.length === 0 && <p className="text-xs text-slate-400">Add the site&apos;s entity first.</p>}
      </form>
      <form action={activityAction} className="space-y-2 rounded border border-slate-200 p-2">
        <input type="hidden" name="scopeVersionId" value={version.id} />
        <Label>Add activity/product/service</Label>
        <Input name="description" placeholder="Synthetic activity description" />
        <Select name="siteId" defaultValue=""><option value="">No specific site</option>{availableSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Button type="submit" variant="secondary" size="sm" disabled={activityPending}>{activityPending ? "Adding…" : "Add activity"}</Button>
        <Feedback state={activityState} />
      </form>
    </div>
  );
}

function ScopeVersionCard({ version, canManage, entities, sites }: { version: ScopeVersionRow; canManage: boolean; entities: EntityOption[]; sites: SiteOption[] }) {
  const [submitState, submitAction, submitting] = useActionState(submitScopeVersionAction, emptyState);
  const [approveState, approveAction, approving] = useActionState(approveScopeVersionAction, emptyState);
  const editable = version.status === "DRAFT" || version.status === "IN_REVIEW";
  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">Version {version.versionNumber}</h3>
          <Badge tone={version.status === "APPROVED" ? "success" : version.status === "SUPERSEDED" ? "neutral" : "warning"}>{version.status.toLowerCase().replaceAll("_", " ")}</Badge>
        </div>
        <p className="text-sm text-slate-600">{version.statement}</p>
        {version.exclusions && <p className="text-sm text-slate-500"><strong>Exclusions:</strong> {version.exclusions}</p>}
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <p><strong>Entities:</strong> {version.entities.length === 0 ? "None" : version.entities.map((e) => e.name).join(", ")}</p>
          <p><strong>Sites:</strong> {version.sites.length === 0 ? "None" : version.sites.map((s) => s.name).join(", ")}</p>
          <p><strong>Activities:</strong> {version.activities.length === 0 ? "None" : version.activities.map((a) => a.description).join(", ")}</p>
        </div>
        {canManage && editable && <ScopeBoundaryEditor version={version} entities={entities} sites={sites} />}
        {canManage && version.status === "DRAFT" && (
          <form action={submitAction}><input type="hidden" name="scopeVersionId" value={version.id} /><Button type="submit" variant="secondary" disabled={submitting}>{submitting ? "Submitting…" : "Submit for review"}</Button><Feedback state={submitState} /></form>
        )}
        {canManage && version.status === "IN_REVIEW" && (
          <form action={approveAction}><input type="hidden" name="scopeVersionId" value={version.id} /><Button type="submit" disabled={approving}>{approving ? "Approving…" : "Approve version"}</Button><Feedback state={approveState} /></form>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

function CreateContextIssueForm({ programmeId, members }: { programmeId: string; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createContextIssueAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add context issue</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="programmeId" value={programmeId} />
          <div><Label>Title</Label><Input name="title" required placeholder="Synthetic internal/external issue" /></div>
          <div>
            <Label>Type</Label>
            <Select name="type" defaultValue="INTERNAL">
              <option value="INTERNAL">Internal</option>
              <option value="EXTERNAL">External</option>
              <option value="ENVIRONMENTAL_CONDITION">Environmental condition</option>
            </Select>
          </div>
          <div>
            <Label>Direction</Label>
            <Select name="direction" defaultValue="AFFECTS_ORGANISATION">
              <option value="AFFECTS_ORGANISATION">Affects organisation</option>
              <option value="AFFECTED_BY_ORGANISATION">Affected by organisation</option>
              <option value="BOTH">Both</option>
            </Select>
          </div>
          <div><Label>Owner (optional)</Label><Select name="ownerMembershipId" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div className="sm:col-span-2"><Label>Description (optional)</Label><Textarea name="description" rows={2} /></div>
          <div><Label>Significance (optional)</Label><Input name="significance" /></div>
          <div><Label>Review date (optional)</Label><Input name="reviewDate" type="date" /></div>
          <div className="sm:col-span-2"><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add context issue"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ContextIssueList({ issues }: { issues: ContextIssueRow[] }) {
  if (issues.length === 0) return <Card><CardContent className="py-8 text-center text-sm text-slate-500">No context issues recorded yet.</CardContent></Card>;
  return (
    <div className="space-y-3">
      {issues.map((issue) => (
        <Card key={issue.id}>
          <CardContent className="space-y-2 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-slate-900">{issue.title}</h3>
              <Badge tone="neutral">{issue.type.toLowerCase().replaceAll("_", " ")}</Badge>
              <Badge tone="neutral">{issue.direction.toLowerCase().replaceAll("_", " ")}</Badge>
            </div>
            {issue.description && <p className="text-sm text-slate-600">{issue.description}</p>}
            {issue.significance && <p className="text-sm text-slate-500"><strong>Significance:</strong> {issue.significance}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interested parties
// ---------------------------------------------------------------------------

function CreateInterestedPartyForm({ programmeId, members }: { programmeId: string; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createInterestedPartyAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add interested party</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="programmeId" value={programmeId} />
          <div><Label>Name</Label><Input name="name" required placeholder="Synthetic regulator / neighbour / customer" /></div>
          <div><Label>Type</Label><Input name="type" required placeholder="Regulator" /></div>
          <div>
            <Label>Influence (optional)</Label>
            <Select name="influence" defaultValue=""><option value="">Not assessed</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></Select>
          </div>
          <div><Label>Relationship owner (optional)</Label><Select name="relationshipOwnerMembershipId" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div className="sm:col-span-2"><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add interested party"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function InterestedPartyRequirementForm({ partyId }: { partyId: string }) {
  const [state, action, pending] = useActionState(createInterestedPartyRequirementAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded border border-slate-200 p-2">
      <input type="hidden" name="interestedPartyId" value={partyId} />
      <Label>Add requirement</Label>
      <Textarea name="summary" rows={2} required placeholder="Synthetic requirement summary" />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="sourceReference" placeholder="Source/evidence reference (optional)" />
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="isMandatory" value="true" className="h-4 w-4" /> Mandatory</label>
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Adding…" : "Add requirement"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function InterestedPartyCard({ party, canManage }: { party: InterestedPartyRow; canManage: boolean }) {
  const [deactivateState, deactivateAction, deactivating] = useActionState(deactivateInterestedPartyAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-slate-900">{party.name}</h3>
            <Badge tone="neutral">{party.type}</Badge>
            {party.influence && <Badge tone="neutral">influence: {party.influence.toLowerCase()}</Badge>}
            {!party.isActive && <Badge tone="neutral">inactive</Badge>}
          </div>
          {canManage && party.isActive && (
            <form action={deactivateAction}><input type="hidden" name="partyId" value={party.id} /><Button type="submit" variant="secondary" size="sm" disabled={deactivating}>{deactivating ? "Deactivating…" : "Deactivate"}</Button></form>
          )}
        </div>
        <Feedback state={deactivateState} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Requirements</p>
          {party.requirements.length === 0 ? <p className="mt-1 text-sm text-slate-500">None recorded.</p> : (
            <ul className="mt-1 space-y-1 text-sm text-slate-600">
              {party.requirements.map((r) => (
                <li key={r.id}>{r.summary}{r.isMandatory && <Badge tone="warning" className="ml-2">mandatory</Badge>}</li>
              ))}
            </ul>
          )}
        </div>
        {canManage && party.isActive && <InterestedPartyRequirementForm partyId={party.id} />}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Risks & opportunities
// ---------------------------------------------------------------------------

function CreateRiskOpportunityForm({ programmeId, members }: { programmeId: string; members: MemberOption[] }) {
  const [state, action, pending] = useActionState(createRiskOpportunityAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Register risk / opportunity</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="programmeId" value={programmeId} />
          <div><Label>Kind</Label><Select name="kind" defaultValue="RISK"><option value="RISK">Risk</option><option value="OPPORTUNITY">Opportunity</option></Select></div>
          <div><Label>Category</Label><Input name="category" required placeholder="Synthetic category" /></div>
          <div className="sm:col-span-2"><Label>Description</Label><Textarea name="description" rows={2} required /></div>
          <div><Label>Consequence (optional)</Label><Input name="consequence" /></div>
          <div><Label>Likelihood (optional)</Label><Input name="likelihood" /></div>
          <div><Label>Rating scale version</Label><Input name="ratingScaleVersion" required placeholder="v1" /></div>
          <div><Label>Initial rating value</Label><Input name="initialRatingValue" required placeholder="e.g. 12" /></div>
          <div className="sm:col-span-2"><Label>Owner (optional)</Label><Select name="ownerMembershipId" defaultValue=""><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div className="sm:col-span-2"><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Registering…" : "Register"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ResidualRatingForm({ riskId }: { riskId: string }) {
  const [state, action, pending] = useActionState(recordResidualRatingAction, emptyState);
  return (
    <form action={action} className="space-y-2 rounded border border-slate-200 p-2">
      <input type="hidden" name="riskOpportunityId" value={riskId} />
      <Label>Record residual rating</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="residualRatingValue" required placeholder="e.g. 4" />
        <Select name="status" defaultValue="OPEN"><option value="OPEN">Open</option><option value="MONITORING">Monitoring</option><option value="CLOSED">Closed</option></Select>
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Recording…" : "Record"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function RiskCard({ risk, canManage }: { risk: RiskRow; canManage: boolean }) {
  const tone = risk.status === "CLOSED" ? "neutral" : risk.status === "MONITORING" ? "warning" : "danger";
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-slate-900">{risk.category}</h3>
          <Badge tone={risk.kind === "RISK" ? "danger" : "success"}>{risk.kind.toLowerCase()}</Badge>
          <Badge tone={tone}>{risk.status.toLowerCase()}</Badge>
        </div>
        <p className="text-sm text-slate-600">{risk.description}</p>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p><strong>Initial rating:</strong> {ratingText(risk.initialRating)} ({risk.ratingScaleVersion})</p>
          <p><strong>Residual rating:</strong> {ratingText(risk.residualRating)}</p>
        </div>
        {canManage && risk.status !== "CLOSED" && <ResidualRatingForm riskId={risk.id} />}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Change control
// ---------------------------------------------------------------------------

function CreateChangeAssessmentForm({ programmeId }: { programmeId: string }) {
  const [state, action, pending] = useActionState(createChangeAssessmentAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Create change assessment</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="programmeId" value={programmeId} />
          <div className="sm:col-span-2"><Label>Proposed change</Label><Textarea name="proposedChange" rows={2} required /></div>
          <div><Label>Trigger type</Label><Input name="triggerType" required placeholder="Synthetic trigger" /></div>
          <div><Label>Trigger date (optional)</Label><Input name="triggerDate" type="date" /></div>
          <div className="sm:col-span-2"><Feedback state={state} /><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create assessment"}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ChangeAssessmentCard({ change, canManage }: { change: ChangeRow; canManage: boolean }) {
  const [submitState, submitAction, submitting] = useActionState(submitChangeAssessmentAction, emptyState);
  const [approveState, approveAction, approving] = useActionState(approveChangeAssessmentAction, emptyState);
  const [implementState, implementAction, implementing] = useActionState(implementChangeAssessmentAction, emptyState);
  const [effectivenessState, effectivenessAction, reviewing] = useActionState(effectivenessReviewAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-slate-900">{change.proposedChange}</h3>
          <Badge tone="neutral">{change.status.toLowerCase().replaceAll("_", " ")}</Badge>
        </div>
        <p className="text-sm text-slate-500">Trigger: {change.triggerType}</p>
        {change.assessment && <p className="text-sm text-slate-600"><strong>Assessment:</strong> {change.assessment}</p>}
        {change.decision && <p className="text-sm text-slate-600"><strong>Decision:</strong> {change.decision}</p>}
        {change.effectivenessReview && <p className="text-sm text-slate-600"><strong>Effectiveness review:</strong> {change.effectivenessReview}</p>}
        {canManage && change.status === "DRAFT" && (
          <form action={submitAction} className="space-y-2">
            <input type="hidden" name="assessmentId" value={change.id} />
            <Textarea name="assessmentNotes" rows={2} required placeholder="Assessment notes for review" />
            <Button type="submit" variant="secondary" size="sm" disabled={submitting}>{submitting ? "Submitting…" : "Submit for review"}</Button>
            <Feedback state={submitState} />
          </form>
        )}
        {canManage && change.status === "REVIEW" && (
          <form action={approveAction} className="space-y-2">
            <input type="hidden" name="assessmentId" value={change.id} />
            <Input name="decision" required placeholder="Decision" />
            <Button type="submit" size="sm" disabled={approving}>{approving ? "Approving…" : "Approve"}</Button>
            <Feedback state={approveState} />
          </form>
        )}
        {canManage && change.status === "APPROVED" && (
          <form action={implementAction}><input type="hidden" name="assessmentId" value={change.id} /><Button type="submit" variant="secondary" size="sm" disabled={implementing}>{implementing ? "Recording…" : "Record implementation"}</Button><Feedback state={implementState} /></form>
        )}
        {canManage && change.status === "IMPLEMENTED" && (
          <form action={effectivenessAction} className="space-y-2">
            <input type="hidden" name="assessmentId" value={change.id} />
            <Textarea name="review" rows={2} required placeholder="Effectiveness review" />
            <Button type="submit" variant="secondary" size="sm" disabled={reviewing}>{reviewing ? "Recording…" : "Record effectiveness review"}</Button>
            <Feedback state={effectivenessState} />
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export function FoundationWorkspace({
  canManage,
  programmes,
  selectedProgrammeId,
  members,
  entities,
  sites,
  scopeVersions,
  requirementMaps,
  contextIssues,
  interestedParties,
  risks,
  changes,
}: {
  canManage: boolean;
  programmes: ProgrammeRow[];
  selectedProgrammeId: string | null;
  members: MemberOption[];
  entities: EntityOption[];
  sites: SiteOption[];
  scopeVersions: ScopeVersionRow[];
  requirementMaps: RequirementMapRow[];
  contextIssues: ContextIssueRow[];
  interestedParties: InterestedPartyRow[];
  risks: RiskRow[];
  changes: ChangeRow[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const programme = programmes.find((p) => p.id === selectedProgrammeId) ?? null;

  if (!programme) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No EMS programme has been created for this organisation yet.
        </div>
        {canManage ? (
          <CreateProgrammeForm members={members} />
        ) : (
          <p className="text-sm text-slate-500">Ask an EMS programme manager to create the first programme.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgrammeSelector programmes={programmes} selectedProgrammeId={selectedProgrammeId} />
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t-lg px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <ProgrammeStatusCard programme={programme} canManage={canManage} />
          <Card>
            <CardHeader><CardTitle>Licensed standard requirement mapping</CardTitle></CardHeader>
            <CardContent><RequirementMapSummary requirementMaps={requirementMaps} /></CardContent>
          </Card>
          {canManage && programmes.length > 0 && <CreateProgrammeForm members={members} />}
        </div>
      )}

      {tab === "scope" && (
        <div className="space-y-6">
          {canManage && <CreateScopeVersionForm programmeId={programme.id} hasVersion={scopeVersions.length > 0} />}
          <div className="space-y-3">
            {scopeVersions.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-slate-500">No scope version yet. Create the first one above.</CardContent></Card>
            ) : (
              scopeVersions.map((v) => <ScopeVersionCard key={v.id} version={v} canManage={canManage} entities={entities} sites={sites} />)
            )}
          </div>
        </div>
      )}

      {tab === "context" && (
        <div className="space-y-6">
          {canManage && <CreateContextIssueForm programmeId={programme.id} members={members} />}
          <ContextIssueList issues={contextIssues} />
        </div>
      )}

      {tab === "parties" && (
        <div className="space-y-6">
          {canManage && <CreateInterestedPartyForm programmeId={programme.id} members={members} />}
          {interestedParties.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-slate-500">No interested parties recorded yet.</CardContent></Card>
          ) : (
            <div className="space-y-3">{interestedParties.map((p) => <InterestedPartyCard key={p.id} party={p} canManage={canManage} />)}</div>
          )}
        </div>
      )}

      {tab === "risks" && (
        <div className="space-y-6">
          {canManage && <CreateRiskOpportunityForm programmeId={programme.id} members={members} />}
          {risks.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-slate-500">No risks or opportunities registered yet.</CardContent></Card>
          ) : (
            <div className="space-y-3">{risks.map((r) => <RiskCard key={r.id} risk={r} canManage={canManage} />)}</div>
          )}
        </div>
      )}

      {tab === "changes" && (
        <div className="space-y-6">
          {canManage && <CreateChangeAssessmentForm programmeId={programme.id} />}
          {changes.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-slate-500">No change assessments recorded yet.</CardContent></Card>
          ) : (
            <div className="space-y-3">{changes.map((c) => <ChangeAssessmentCard key={c.id} change={c} canManage={canManage} />)}</div>
          )}
        </div>
      )}
    </div>
  );
}
