"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { emptyAssessmentState } from "@/lib/lca/form-state";
import { createScenarioAction } from "../../actions";

export function CreateScenarioForm({ assessmentId, suggestedReference }: { assessmentId: string; suggestedReference: string }) {
  const [state, formAction, pending] = useActionState(createScenarioAction, emptyAssessmentState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New scenario
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <Notice tone="info">
        A scenario is a full, independent copy of this assessment — model, inventory, freight legs, end-of-life routes and
        registers. Editing it cannot reach back into the baseline, because the two share no records.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="scenarioReference">Reference</Label>
          <Input id="scenarioReference" name="reference" required defaultValue={suggestedReference} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="scenarioTitle">Scenario name</Label>
          <Input id="scenarioTitle" name="title" required className="mt-1" placeholder="Recycled aluminium housing" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="scenarioDescription">What this scenario changes</Label>
          <Textarea id="scenarioDescription" name="scenarioDescription" rows={2} className="mt-1" />
          <Hint>Once created, open the scenario and make the changes. It is calculated immediately so the comparison starts at zero difference.</Hint>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create scenario"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
