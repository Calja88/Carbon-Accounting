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
  changeOtherRequirementSourceStatusAction,
  createOtherRequirementSourceAction,
  updateOtherRequirementSourceAction,
  uploadOtherRequirementSourceEvidenceAction,
  type OtherRequirementActionState,
} from "./actions";

const emptyState: OtherRequirementActionState = { error: null, message: null };

const SOURCE_TYPES = [
  { value: "PERMIT", label: "Permit" },
  { value: "CONSENT", label: "Consent" },
  { value: "REGULATOR_NOTICE", label: "Regulator notice" },
  { value: "CONTRACT", label: "Contract" },
  { value: "CUSTOMER_REQUIREMENT", label: "Customer requirement" },
  { value: "VOLUNTARY_COMMITMENT", label: "Voluntary commitment" },
] as const;

type Option = { id: string; name: string };

export type OtherRequirementSourceRow = {
  id: string;
  type: string;
  title: string;
  issuingParty: string;
  reference: string | null;
  description: string | null;
  status: string;
  ownerName: string;
  issuedAt: string | null;
  effectiveFrom: string | null;
  expiryDate: string | null;
  nextReviewAt: string | null;
  createdAt: string;
  evidence: Array<{ id: string; filename: string }>;
  applicabilityAssessmentCount: number;
};

function Feedback({ state }: { state: OtherRequirementActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "EXPIRED") return "danger";
  if (status === "WITHDRAWN") return "neutral";
  return "info";
}

function typeLabel(type: string): string {
  return SOURCE_TYPES.find((option) => option.value === type)?.label ?? type;
}

function SourceFieldset({ uid, defaults }: { uid: string; defaults?: Partial<OtherRequirementSourceRow> }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`type-${uid}`}>Source type</Label>
          <Select id={`type-${uid}`} name="type" defaultValue={defaults?.type ?? "PERMIT"} required>
            {SOURCE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`issuingParty-${uid}`}>Issuing party / authority</Label>
          <Input id={`issuingParty-${uid}`} name="issuingParty" required defaultValue={defaults?.issuingParty} placeholder="Synthetic example: Aster Environment Agency" />
        </div>
      </div>
      <div>
        <Label htmlFor={`title-${uid}`}>Title</Label>
        <Input id={`title-${uid}`} name="title" required defaultValue={defaults?.title} placeholder="Synthetic example: Site A discharge consent" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`reference-${uid}`}>Reference (optional)</Label>
          <Input id={`reference-${uid}`} name="reference" defaultValue={defaults?.reference ?? ""} />
        </div>
      </div>
      <div>
        <Label htmlFor={`description-${uid}`}>Description (optional)</Label>
        <Textarea id={`description-${uid}`} name="description" rows={3} defaultValue={defaults?.description ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`issuedAt-${uid}`}>Issued date (optional)</Label>
          <Input id={`issuedAt-${uid}`} name="issuedAt" type="date" defaultValue={defaults?.issuedAt?.slice(0, 10)} />
        </div>
        <div>
          <Label htmlFor={`effectiveFrom-${uid}`}>Effective from (optional)</Label>
          <Input id={`effectiveFrom-${uid}`} name="effectiveFrom" type="date" defaultValue={defaults?.effectiveFrom?.slice(0, 10)} />
        </div>
        <div>
          <Label htmlFor={`expiryDate-${uid}`}>Expiry date (optional)</Label>
          <Input id={`expiryDate-${uid}`} name="expiryDate" type="date" defaultValue={defaults?.expiryDate?.slice(0, 10)} />
        </div>
        <div>
          <Label htmlFor={`nextReviewAt-${uid}`}>Next review date (optional)</Label>
          <Input id={`nextReviewAt-${uid}`} name="nextReviewAt" type="date" defaultValue={defaults?.nextReviewAt?.slice(0, 10)} />
        </div>
      </div>
    </>
  );
}

function CreateSourceForm({ members }: { members: Option[] }) {
  const [state, action, pending] = useActionState(createOtherRequirementSourceAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <SourceFieldset uid="new" />
      <div>
        <Label htmlFor="ownerMembershipId-new">Owner</Label>
        <Select id="ownerMembershipId-new" name="ownerMembershipId" defaultValue="" required>
          <option value="" disabled>Choose an owner</option>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </Select>
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record source"}</Button>
    </form>
  );
}

function EditSourceForm({ source, members }: { source: OtherRequirementSourceRow; members: Option[] }) {
  const [state, action, pending] = useActionState(updateOtherRequirementSourceAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="sourceId" value={source.id} />
      <SourceFieldset uid={source.id} defaults={source} />
      <div>
        <Label htmlFor={`ownerMembershipId-${source.id}`}>Owner</Label>
        <Select id={`ownerMembershipId-${source.id}`} name="ownerMembershipId" defaultValue={members.find((m) => m.name === source.ownerName)?.id ?? ""} required>
          {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </Select>
      </div>
      <Feedback state={state} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}

function StatusForm({ sourceId }: { sourceId: string }) {
  const [state, action, pending] = useActionState(changeOtherRequirementSourceStatusAction, emptyState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <div>
        <Label htmlFor={`status-${sourceId}`}>Change status</Label>
        <Select id={`status-${sourceId}`} name="status" defaultValue="EXPIRED">
          <option value="EXPIRED">Expired</option>
          <option value="SUPERSEDED">Superseded</option>
          <option value="WITHDRAWN">Withdrawn</option>
        </Select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Apply"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function UploadEvidenceForm({ sourceId }: { sourceId: string }) {
  const [state, action, pending] = useActionState(uploadOtherRequirementSourceEvidenceAction, emptyState);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sourceId" value={sourceId} />
      <div><Label htmlFor={`evidenceFile-${sourceId}`}>Attach evidence</Label><Input id={`evidenceFile-${sourceId}`} name="file" type="file" required /></div>
      <div><Label htmlFor={`evidencePurpose-${sourceId}`}>Purpose (optional)</Label><Input id={`evidencePurpose-${sourceId}`} name="purpose" /></div>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
      <Feedback state={state} />
    </form>
  );
}

function SourceCard({ source, members, canManage }: { source: OtherRequirementSourceRow; members: Option[]; canManage: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-slate-900">{source.title}</p>
            <p className="text-xs text-slate-500">
              {typeLabel(source.type)} · {source.issuingParty}
              {source.reference ? ` · ref ${source.reference}` : ""} · owner {source.ownerName}
            </p>
          </div>
          <Badge tone={statusTone(source.status)}>{source.status}</Badge>
        </div>
        {source.description && <p className="text-sm text-slate-600">{source.description}</p>}
        <p className="text-xs text-slate-500">
          {source.effectiveFrom ? `Effective from ${new Date(source.effectiveFrom).toLocaleDateString("en-GB")}` : "No effective date recorded"}
          {source.expiryDate ? ` · expires ${new Date(source.expiryDate).toLocaleDateString("en-GB")}` : ""}
          {source.nextReviewAt ? ` · next review ${new Date(source.nextReviewAt).toLocaleDateString("en-GB")}` : ""}
        </p>
        <Badge tone={source.applicabilityAssessmentCount > 0 ? "info" : "neutral"}>
          {source.applicabilityAssessmentCount > 0
            ? `${source.applicabilityAssessmentCount} applicability assessment(s)`
            : "Not yet assessed for applicability"}
        </Badge>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
          {source.evidence.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No evidence attached.</p>
          ) : (
            <ul className="mt-1 text-sm">{source.evidence.map((item) => <li key={item.id}>{item.filename}</li>)}</ul>
          )}
        </div>

        {canManage && (
          <div className="space-y-3">
            <UploadEvidenceForm sourceId={source.id} />
            {source.status === "ACTIVE" && (
              <>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-blue-700">Edit source</summary>
                  <div className="mt-3"><EditSourceForm source={source} members={members} /></div>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-blue-700">Change status</summary>
                  <div className="mt-3"><StatusForm sourceId={source.id} /></div>
                </details>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function OtherRequirementSourceWorkspace({
  sources,
  members,
  canManage,
}: {
  sources: OtherRequirementSourceRow[];
  members: Option[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-8">
      {canManage && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">Record a new source</h2>
          <CreateSourceForm members={members} />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Other requirement sources</h2>
        {sources.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-slate-500">No other-requirement sources recorded yet.</CardContent></Card>
        ) : (
          sources.map((source) => <SourceCard key={source.id} source={source} members={members} canManage={canManage} />)
        )}
      </div>
    </div>
  );
}
