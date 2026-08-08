"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { LcaMateriality } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { MATERIALITY_LABELS } from "@/lib/lca/labels";
import { ASSUMPTION_CATEGORIES } from "@/lib/lca/registers-service";
import { emptyAssessmentState as emptyRegisterState } from "@/lib/lca/form-state";
import { saveAssumptionAction, saveExclusionAction } from "./actions";

export function AssumptionForm({
  assessmentId,
  users,
  processes,
  items,
}: {
  assessmentId: string;
  users: { id: string; name: string }[];
  processes: { id: string; name: string }[];
  items: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(saveAssumptionAction, emptyRegisterState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Record an assumption
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
          <Label htmlFor="assumption">Assumption</Label>
          <Textarea id="assumption" name="assumption" rows={2} required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="assumptionCategory">Category</Label>
          <Select id="assumptionCategory" name="category" className="mt-1">
            {ASSUMPTION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="materiality">Materiality</Label>
          <Select id="materiality" name="materiality" defaultValue={LcaMateriality.MEDIUM} className="mt-1">
            {Object.entries(MATERIALITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Hint>How much the answer would move if this assumption turned out to be wrong.</Hint>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="rationale">Rationale</Label>
          <Textarea id="rationale" name="rationale" rows={2} required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="assumptionSource">Source</Label>
          <Input id="assumptionSource" name="source" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="assumptionUncertainty">Uncertainty</Label>
          <Input id="assumptionUncertainty" name="uncertainty" className="mt-1" placeholder="±20% on the mass" />
        </div>
        <div>
          <Label htmlFor="assumptionOwner">Owner</Label>
          <Select id="assumptionOwner" name="ownerUserId" className="mt-1">
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="assumptionProcess">Applies to a process</Label>
          <Select id="assumptionProcess" name="processId" className="mt-1">
            <option value="">Whole assessment</option>
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="assumptionItem">Applies to an inventory line</Label>
          <Select id="assumptionItem" name="inventoryItemId" className="mt-1">
            <option value="">Not line-specific</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record assumption"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ExclusionForm({
  assessmentId,
  users,
  processes,
}: {
  assessmentId: string;
  users: { id: string; name: string }[];
  processes: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(saveExclusionAction, emptyRegisterState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Record an exclusion
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
          <Label htmlFor="excludedItem">What is excluded</Label>
          <Input id="excludedItem" name="excludedItem" required className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="exclusionRationale">Why</Label>
          <Textarea id="exclusionRationale" name="rationale" rows={2} required className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="estimatedRelevance">Estimated relevance</Label>
          <Textarea id="estimatedRelevance" name="estimatedRelevance" rows={2} required className="mt-1" />
          <Hint>
            An exclusion nobody can size is indistinguishable from an omission. Say roughly what it would have
            contributed, and how you know.
          </Hint>
        </div>
        <div>
          <Label htmlFor="estimatedPercentOfTotal">Estimated share of the footprint (%)</Label>
          <Input id="estimatedPercentOfTotal" name="estimatedPercentOfTotal" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="exclusionOwner">Owner</Label>
          <Select id="exclusionOwner" name="ownerUserId" className="mt-1">
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="exclusionProcess">Applies to a process</Label>
          <Select id="exclusionProcess" name="processId" className="mt-1">
            <option value="">Whole assessment</option>
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {process.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record exclusion"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
