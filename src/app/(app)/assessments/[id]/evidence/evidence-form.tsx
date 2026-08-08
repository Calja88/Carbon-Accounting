"use client";

import { useActionState, useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { emptyAssessmentState as emptyEvidenceState } from "@/lib/lca/form-state";
import { uploadEvidenceAction } from "./actions";

export function EvidenceForm({
  assessmentId,
  processes,
  items,
  assumptions,
  exclusions,
  verifications,
  supplierPcfs,
  storageProvider,
  maxBytes,
}: {
  assessmentId: string;
  processes: { id: string; name: string }[];
  items: { id: string; name: string }[];
  assumptions: { id: string; label: string }[];
  exclusions: { id: string; label: string }[];
  verifications: { id: string; label: string }[];
  supplierPcfs: { id: string; label: string }[];
  storageProvider: string;
  maxBytes: number;
}) {
  const [state, formAction, pending] = useActionState(uploadEvidenceAction, emptyEvidenceState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Paperclip className="h-4 w-4" />
        Attach evidence
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="evidenceTitle">Title</Label>
          <Input id="evidenceTitle" name="title" required className="mt-1" placeholder="Sub-meter reading, line 3, March 2026" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="evidenceDescription">Description</Label>
          <Textarea id="evidenceDescription" name="description" rows={2} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="evidenceFile">Upload a file</Label>
          <Input id="evidenceFile" name="file" type="file" className="mt-1" />
          <Hint>
            Stored by the {storageProvider} provider, up to {Math.round(maxBytes / (1024 * 1024))} MB, with a SHA-256
            checksum recorded so the file can be shown to be unchanged.
          </Hint>
        </div>
        <div>
          <Label htmlFor="externalUrl">…or link to it</Label>
          <Input id="externalUrl" name="externalUrl" className="mt-1" placeholder="https://…" />
          <Hint>For evidence that already lives in a document management system.</Hint>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h5 className="text-sm font-semibold text-slate-800">What this evidence supports</h5>
        <Hint>Leave everything blank to attach it to the assessment as a whole.</Hint>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="evidenceItem">Inventory line</Label>
            <Select id="evidenceItem" name="inventoryItemId" className="mt-1">
              <option value="">—</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="evidenceProcess">Process</Label>
            <Select id="evidenceProcess" name="processId" className="mt-1">
              <option value="">—</option>
              {processes.map((process) => (
                <option key={process.id} value={process.id}>
                  {process.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="evidenceAssumption">Assumption</Label>
            <Select id="evidenceAssumption" name="assumptionId" className="mt-1">
              <option value="">—</option>
              {assumptions.map((assumption) => (
                <option key={assumption.id} value={assumption.id}>
                  {assumption.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="evidenceExclusion">Exclusion</Label>
            <Select id="evidenceExclusion" name="exclusionId" className="mt-1">
              <option value="">—</option>
              {exclusions.map((exclusion) => (
                <option key={exclusion.id} value={exclusion.id}>
                  {exclusion.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="evidenceSupplierPcf">Supplier PCF</Label>
            <Select id="evidenceSupplierPcf" name="supplierPcfId" className="mt-1">
              <option value="">—</option>
              {supplierPcfs.map((pcf) => (
                <option key={pcf.id} value={pcf.id}>
                  {pcf.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="evidenceVerification">Verification record</Label>
            <Select id="evidenceVerification" name="verificationId" className="mt-1">
              <option value="">—</option>
              {verifications.map((verification) => (
                <option key={verification.id} value={verification.id}>
                  {verification.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Uploading…" : "Attach evidence"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
