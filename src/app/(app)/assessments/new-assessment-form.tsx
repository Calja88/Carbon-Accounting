"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Hint, Notice } from "@/components/lca/ui";
import { BOUNDARY_LABELS } from "@/lib/lca/labels";
import { emptyAssessmentState } from "@/lib/lca/form-state";
import { createAssessmentAction } from "./actions";

export function NewAssessmentForm({
  productVersions,
  methodologies,
  defaultEntityId,
}: {
  productVersions: { id: string; label: string; entityId: string }[];
  methodologies: { id: string; label: string; isDefault: boolean }[];
  defaultEntityId?: string;
}) {
  const [state, formAction, pending] = useActionState(createAssessmentAction, emptyAssessmentState);
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState(productVersions[0]?.id ?? "");

  if (productVersions.length === 0) {
    return null;
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New assessment
      </Button>
    );
  }

  const entityId = productVersions.find((v) => v.id === versionId)?.entityId ?? defaultEntityId ?? "";
  const defaultMethodology = methodologies.find((m) => m.isDefault)?.id ?? methodologies[0]?.id ?? "";

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="entityId" value={entityId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="productVersionId">Product version</Label>
          <Select
            id="productVersionId"
            name="productVersionId"
            required
            className="mt-1"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          >
            {productVersions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="reference">Reference</Label>
          <Input id="reference" name="reference" required className="mt-1" placeholder="PCF-2026-001" />
          <Hint>Unique within the operating unit. Used on exports and exchange documents.</Hint>
        </div>
        <div>
          <Label htmlFor="assessmentTitle">Title</Label>
          <Input id="assessmentTitle" name="title" required className="mt-1" placeholder="Cradle-to-gate footprint, 2026 production" />
        </div>
        <div>
          <Label htmlFor="boundary">Lifecycle boundary</Label>
          <Select id="boundary" name="boundary" defaultValue="CRADLE_TO_GATE" className="mt-1">
            {Object.entries(BOUNDARY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Hint>The lifecycle stages this boundary implies are created as a starting skeleton. You can change them.</Hint>
        </div>
        <div>
          <Label htmlFor="methodologyProfileId">Methodology profile</Label>
          <Select id="methodologyProfileId" name="methodologyProfileId" defaultValue={defaultMethodology} className="mt-1">
            <option value="">Choose later</option>
            {methodologies.map((methodology) => (
              <option key={methodology.id} value={methodology.id}>
                {methodology.label}
              </option>
            ))}
          </Select>
          <Hint>The engine reads this: it decides allocation, recycling, electricity, biogenic and offset treatment.</Hint>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create assessment"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
