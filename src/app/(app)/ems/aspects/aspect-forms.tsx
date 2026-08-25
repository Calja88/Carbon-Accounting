"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createAspectAction,
  createImpactAction,
  deleteAspectAction,
  deleteImpactAction,
  linkImpactAction,
  unlinkImpactAction,
  updateAspectAction,
  uploadAspectEvidenceAction,
  type AspectActionState,
} from "./actions";

const emptyState: AspectActionState = { error: null, message: null };

const LIFECYCLE_STAGES = [
  ["", "Not set"],
  ["RAW_MATERIAL_ACQUISITION", "Raw material acquisition"],
  ["DESIGN", "Design"],
  ["PRODUCTION", "Production"],
  ["TRANSPORTATION_DELIVERY", "Transportation / delivery"],
  ["USE", "Use"],
  ["END_OF_LIFE_TREATMENT", "End-of-life treatment"],
  ["OTHER", "Other"],
] as const;

const CONDITIONS = ["NORMAL", "ABNORMAL", "STARTUP_SHUTDOWN", "MAINTENANCE", "EMERGENCY"] as const;

type ProcessOption = { id: string; name: string; lifecycleStage: string | null; operatingCondition: string };
type ImpactOption = {
  id: string;
  name: string;
  category: string;
  receptor: string | null;
  extent: string;
  effect: string;
  description: string | null;
};
type AspectRow = {
  id: string;
  processId: string;
  processName: string;
  name: string;
  description: string | null;
  sourceInputOutput: string | null;
  scopeDescription: string | null;
  existingControls: string | null;
  controlRelationship: string;
  lifecycleStage: string | null;
  operatingCondition: string;
  effect: string;
  impacts: Array<{ linkId: string; impactId: string; name: string; causalDescription: string | null }>;
  evidence: Array<{ id: string; filename: string }>;
  controls: Array<{ id: string; label: string }>;
};

function Feedback({ state }: { state: AspectActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function AspectFields({ processes, aspect }: { processes: ProcessOption[]; aspect?: AspectRow }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label>Aspect name</Label>
        <Input name="name" required defaultValue={aspect?.name} placeholder="Synthetic example: Packaging material use" />
      </div>
      <div>
        <Label>Process/activity profile</Label>
        <Select name="processId" required defaultValue={aspect?.processId ?? ""}>
          <option value="">Select…</option>
          {processes.map((process) => <option key={process.id} value={process.id}>{process.name}</option>)}
        </Select>
      </div>
      <div>
        <Label>Control relationship</Label>
        <Select name="controlRelationship" defaultValue={aspect?.controlRelationship ?? "DIRECT_CONTROL"}>
          <option value="DIRECT_CONTROL">Direct control</option>
          <option value="INFLUENCE">Influence</option>
        </Select>
      </div>
      <div>
        <Label>Potential effect</Label>
        <Select name="effect" defaultValue={aspect?.effect ?? "ADVERSE"}>
          <option value="ADVERSE">Adverse</option>
          <option value="BENEFICIAL">Beneficial</option>
        </Select>
      </div>
      <div>
        <Label>Lifecycle perspective</Label>
        <Select name="lifecycleStage" defaultValue={aspect?.lifecycleStage ?? ""}>
          {LIFECYCLE_STAGES.map(([value, label]) => <option key={value || "none"} value={value}>{label}</option>)}
        </Select>
      </div>
      <div>
        <Label>Operating condition</Label>
        <Select name="operatingCondition" defaultValue={aspect?.operatingCondition ?? "NORMAL"}>
          {CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition.replaceAll("_", " ").toLowerCase()}</option>)}
        </Select>
      </div>
      <div>
        <Label>Source / input / output</Label>
        <Input name="sourceInputOutput" defaultValue={aspect?.sourceInputOutput ?? ""} />
      </div>
      <div>
        <Label>Scope</Label>
        <Input name="scopeDescription" defaultValue={aspect?.scopeDescription ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <Label>Description</Label>
        <Textarea name="description" defaultValue={aspect?.description ?? ""} rows={2} />
      </div>
      <div className="sm:col-span-2">
        <Label>Existing controls</Label>
        <Textarea name="existingControls" defaultValue={aspect?.existingControls ?? ""} rows={2} />
      </div>
    </div>
  );
}

function CreateAspectForm({ processes }: { processes: ProcessOption[] }) {
  const [state, action, pending] = useActionState(createAspectAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add environmental aspect</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <AspectFields processes={processes} />
          <Feedback state={state} />
          <Button type="submit" disabled={pending || processes.length === 0}>{pending ? "Creating…" : "Create aspect"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CreateImpactForm() {
  const [state, action, pending] = useActionState(createImpactAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Add impact catalogue item</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Impact name</Label><Input name="name" required placeholder="Synthetic example: Resource depletion" /></div>
            <div><Label>Category</Label><Input name="category" required placeholder="Resource use" /></div>
            <div><Label>Receptor</Label><Input name="receptor" placeholder="Materials" /></div>
            <div><Label>Extent</Label><Select name="extent" defaultValue="LOCAL"><option value="LOCAL">Local</option><option value="GLOBAL">Global</option><option value="LOCAL_AND_GLOBAL">Local and global</option></Select></div>
            <div><Label>Effect</Label><Select name="effect" defaultValue="ADVERSE"><option value="ADVERSE">Adverse</option><option value="BENEFICIAL">Beneficial</option></Select></div>
            <div><Label>Description</Label><Input name="description" /></div>
          </div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create impact"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LinkImpactForm({ aspects, impacts }: { aspects: AspectRow[]; impacts: ImpactOption[] }) {
  const [state, action, pending] = useActionState(linkImpactAction, emptyState);
  return (
    <Card>
      <CardHeader><CardTitle>Link aspect to impact</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label>Aspect</Label><Select name="aspectId" required defaultValue=""><option value="">Select…</option>{aspects.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>
            <div><Label>Impact</Label><Select name="impactId" required defaultValue=""><option value="">Select…</option>{impacts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          </div>
          <div><Label>Causal description</Label><Input name="causalDescription" placeholder="How the aspect may cause the impact" /></div>
          <Feedback state={state} />
          <Button type="submit" disabled={pending || aspects.length === 0 || impacts.length === 0}>{pending ? "Linking…" : "Link impact"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AspectCard({ aspect, processes, canEdit }: { aspect: AspectRow; processes: ProcessOption[]; canEdit: boolean }) {
  const [updateState, updateAction, updating] = useActionState(updateAspectAction, emptyState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteAspectAction, emptyState);
  const [evidenceState, evidenceAction, uploading] = useActionState(uploadAspectEvidenceAction, emptyState);
  return (
    <Card>
      <CardContent id={`aspect-${aspect.id}`} className="scroll-mt-24 space-y-4 py-5">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{aspect.name}</h3><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{aspect.effect.toLowerCase()}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{aspect.controlRelationship === "DIRECT_CONTROL" ? "direct control" : "influence"}</span></div>
          <p className="mt-1 text-sm text-slate-600">{aspect.processName} · {aspect.operatingCondition.replaceAll("_", " ").toLowerCase()}{aspect.lifecycleStage ? ` · ${aspect.lifecycleStage.replaceAll("_", " ").toLowerCase()}` : ""}</p>
          {aspect.description && <p className="mt-2 text-sm text-slate-600">{aspect.description}</p>}
          {aspect.existingControls && <p className="mt-2 text-sm text-slate-600"><strong>Existing controls:</strong> {aspect.existingControls}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linked impacts</p>
          {aspect.impacts.length === 0 ? <p className="mt-1 text-sm text-amber-700">No impacts linked.</p> : <ul className="mt-1 space-y-1 text-sm">{aspect.impacts.map((impact) => <li key={impact.linkId} className="flex items-center gap-2"><span>{impact.name}{impact.causalDescription ? ` — ${impact.causalDescription}` : ""}</span>{canEdit && <UnlinkButton linkId={impact.linkId} />}</li>)}</ul>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Operational controls</p>
          {aspect.controls.length === 0 ? <p className="mt-1 text-sm text-amber-700">No active operational control linked.</p> : <ul className="mt-1 space-y-1 text-sm">{aspect.controls.map((control) => <li key={control.id}><a href={`/ems/controls#control-${control.id}`} className="text-blue-700 underline">{control.label}</a></li>)}</ul>}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
          {aspect.evidence.length === 0 ? <p className="mt-1 text-sm text-slate-500">No evidence attached.</p> : <ul className="mt-1 text-sm">{aspect.evidence.map((item) => <li key={item.id}>{item.filename}</li>)}</ul>}
        </div>
        {canEdit && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Edit aspect</summary><form action={updateAction} className="mt-4 space-y-4"><input type="hidden" name="aspectId" value={aspect.id} /><AspectFields processes={processes} aspect={aspect} /><Feedback state={updateState} /><Button type="submit" disabled={updating}>{updating ? "Saving…" : "Save changes"}</Button></form></details>}
        {canEdit && <form action={evidenceAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="aspectId" value={aspect.id} /><div><Label>Attach evidence</Label><Input name="file" type="file" required /></div><div><Label>Purpose (optional)</Label><Input name="purpose" /></div><Button type="submit" variant="secondary" disabled={uploading}>{uploading ? "Uploading…" : "Attach"}</Button><Feedback state={evidenceState} /></form>}
        {canEdit && <form action={deleteAction} onSubmit={(event) => { if (!window.confirm("Delete this aspect and its impact links?")) event.preventDefault(); }}><input type="hidden" name="aspectId" value={aspect.id} /><Button type="submit" variant="secondary" disabled={deleting}>{deleting ? "Deleting…" : "Delete aspect"}</Button><Feedback state={deleteState} /></form>}
      </CardContent>
    </Card>
  );
}

function UnlinkButton({ linkId }: { linkId: string }) {
  const [, action, pending] = useActionState(unlinkImpactAction, emptyState);
  return <form action={action}><input type="hidden" name="linkId" value={linkId} /><button type="submit" disabled={pending} className="text-xs text-red-600 hover:underline">{pending ? "…" : "Unlink"}</button></form>;
}

function ImpactList({ impacts, canEdit }: { impacts: ImpactOption[]; canEdit: boolean }) {
  return <Card><CardHeader><CardTitle>Impact catalogue</CardTitle></CardHeader><CardContent>{impacts.length === 0 ? <p className="text-sm text-slate-500">No impact catalogue items yet.</p> : <div className="space-y-2">{impacts.map((impact) => <ImpactRow key={impact.id} impact={impact} canEdit={canEdit} />)}</div>}</CardContent></Card>;
}

function ImpactRow({ impact, canEdit }: { impact: ImpactOption; canEdit: boolean }) {
  const [state, action, pending] = useActionState(deleteImpactAction, emptyState);
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div><p className="font-medium text-slate-900">{impact.name}</p><p className="text-xs text-slate-500">{impact.category} · {impact.extent.replaceAll("_", " ").toLowerCase()} · {impact.effect.toLowerCase()}</p></div>{canEdit && <form action={action} onSubmit={(event) => { if (!window.confirm("Delete this impact and remove its aspect links?")) event.preventDefault(); }}><input type="hidden" name="impactId" value={impact.id} /><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Deleting…" : "Delete"}</Button><Feedback state={state} /></form>}</div>;
}

export function AspectRegister({ processes, aspects, impacts, canEdit }: { processes: ProcessOption[]; aspects: AspectRow[]; impacts: ImpactOption[]; canEdit: boolean }) {
  return <div className="space-y-8">{canEdit && <><div className="grid gap-6 xl:grid-cols-2"><CreateAspectForm processes={processes} /><CreateImpactForm /></div><LinkImpactForm aspects={aspects} impacts={impacts} /></>}<div className="space-y-3"><h2 className="text-lg font-semibold text-slate-900">Aspect register</h2>{aspects.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-slate-500">No environmental aspects yet.</CardContent></Card> : aspects.map((aspect) => <AspectCard key={aspect.id} aspect={aspect} processes={processes} canEdit={canEdit} />)}</div><ImpactList impacts={impacts} canEdit={canEdit} /></div>;
}
