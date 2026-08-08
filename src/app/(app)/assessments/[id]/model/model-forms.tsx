"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { LcaAllocationMethod } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { ALLOCATION_LABELS, LIFECYCLE_STAGE_ORDER, STAGE_LABELS } from "@/lib/lca/labels";
import { emptyAssessmentState as emptyModelState } from "@/lib/lca/form-state";
import { saveProcessAction, saveProcessOutputAction } from "./actions";

export interface ProcessFormValues {
  id: string;
  parentProcessId: string | null;
  stage: string;
  name: string;
  description: string | null;
  isIncluded: boolean;
  allocationMethod: string;
  allocationPercent: string;
  allocationRationale: string | null;
  allocationBasisDescription: string | null;
  geography: string | null;
  notes: string | null;
}

export function ProcessForm({
  assessmentId,
  process,
  parentOptions,
  trigger = "add",
}: {
  assessmentId: string;
  process?: ProcessFormValues;
  parentOptions: { id: string; name: string; stage: string }[];
  trigger?: "add" | "edit";
}) {
  const [state, formAction, pending] = useActionState(saveProcessAction, emptyModelState);
  const [open, setOpen] = useState(false);
  const [allocationMethod, setAllocationMethod] = useState(process?.allocationMethod ?? LcaAllocationMethod.NONE);

  if (!open) {
    return trigger === "add" ? (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add process
      </Button>
    ) : (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${process?.name}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    );
  }

  const usesDerivedSplit =
    allocationMethod === LcaAllocationMethod.MASS ||
    allocationMethod === LcaAllocationMethod.PHYSICAL ||
    allocationMethod === LcaAllocationMethod.ECONOMIC;

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {process && <input type="hidden" name="processId" value={process.id} />}

      {state.error && <Notice tone="danger">{state.error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="processName">Process name</Label>
          <Input id="processName" name="name" required defaultValue={process?.name} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="stage">Lifecycle stage</Label>
          <Select id="stage" name="stage" defaultValue={process?.stage ?? "RAW_MATERIALS"} className="mt-1">
            {LIFECYCLE_STAGE_ORDER.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="parentProcessId">Sits inside (optional)</Label>
          <Select id="parentProcessId" name="parentProcessId" defaultValue={process?.parentProcessId ?? ""} className="mt-1">
            <option value="">Top level</option>
            {parentOptions
              .filter((option) => option.id !== process?.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {STAGE_LABELS[option.stage as keyof typeof STAGE_LABELS]} — {option.name}
                </option>
              ))}
          </Select>
          <Hint>
            Nesting matters for allocation: a sub-process inside an allocated parent is allocated at both levels, which is
            the correct treatment and easy to get wrong by hand.
          </Hint>
        </div>
        <div>
          <Label htmlFor="geography">Geography</Label>
          <Input id="geography" name="geography" defaultValue={process?.geography ?? ""} className="mt-1" placeholder="GB" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="processDescription">Description</Label>
          <Textarea id="processDescription" name="description" rows={2} defaultValue={process?.description ?? ""} className="mt-1" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <Label htmlFor="allocationMethod">Multi-output allocation</Label>
        <Hint>
          Only part of a process&apos;s burden belongs to this product when the process makes more than one saleable thing.
          Mass, physical and economic splits are derived from the co-products recorded below, so they can be checked.
        </Hint>
        <Select
          id="allocationMethod"
          name="allocationMethod"
          value={allocationMethod}
          onChange={(e) => setAllocationMethod(e.target.value)}
          className="mt-2"
        >
          {Object.entries(ALLOCATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {allocationMethod === LcaAllocationMethod.MANUAL && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="allocationPercent">Share attributed to this product (%)</Label>
              <Input
                id="allocationPercent"
                name="allocationPercent"
                defaultValue={process?.allocationPercent ?? "100"}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="allocationRationale">Rationale (required)</Label>
              <Input
                id="allocationRationale"
                name="allocationRationale"
                defaultValue={process?.allocationRationale ?? ""}
                className="mt-1"
              />
            </div>
          </div>
        )}

        {usesDerivedSplit && (
          <div className="mt-3">
            <Label htmlFor="allocationBasisDescription">Why this basis</Label>
            <Input
              id="allocationBasisDescription"
              name="allocationBasisDescription"
              defaultValue={process?.allocationBasisDescription ?? ""}
              className="mt-1"
              placeholder="Mass reflects what drives the process energy here"
            />
            <Hint>Record the co-products on the process after saving — the split is calculated from them.</Hint>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="isIncluded"
          defaultChecked={process?.isIncluded ?? true}
          className="h-4 w-4 rounded border-slate-300"
        />
        Include this process in the model
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save process"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ProcessOutputForm({
  assessmentId,
  processId,
  allocationMethod,
}: {
  assessmentId: string;
  processId: string;
  allocationMethod: string;
}) {
  const [state, formAction, pending] = useActionState(saveProcessOutputAction, emptyModelState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Add co-product
      </Button>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="processId" value={processId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`output-name-${processId}`}>Output name</Label>
          <Input id={`output-name-${processId}`} name="name" required className="mt-1" />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" name="isAssessedProduct" className="h-4 w-4 rounded border-slate-300" />
            This is the product being assessed
          </label>
        </div>
        {allocationMethod === "MASS" && (
          <>
            <div>
              <Label htmlFor={`output-mass-${processId}`}>Mass</Label>
              <Input id={`output-mass-${processId}`} name="massValue" className="mt-1" />
            </div>
            <div>
              <Label htmlFor={`output-mass-unit-${processId}`}>Mass unit</Label>
              <Input id={`output-mass-unit-${processId}`} name="massUnit" defaultValue="kg" className="mt-1" />
            </div>
          </>
        )}
        {allocationMethod === "PHYSICAL" && (
          <>
            <div>
              <Label htmlFor={`output-physical-${processId}`}>Physical quantity</Label>
              <Input id={`output-physical-${processId}`} name="physicalValue" className="mt-1" />
            </div>
            <div>
              <Label htmlFor={`output-physical-unit-${processId}`}>Unit</Label>
              <Input id={`output-physical-unit-${processId}`} name="physicalUnit" className="mt-1" placeholder="m2" />
            </div>
          </>
        )}
        {allocationMethod === "ECONOMIC" && (
          <>
            <div>
              <Label htmlFor={`output-value-${processId}`}>Value</Label>
              <Input id={`output-value-${processId}`} name="economicValue" className="mt-1" />
            </div>
            <div>
              <Label htmlFor={`output-currency-${processId}`}>Currency</Label>
              <Input id={`output-currency-${processId}`} name="economicCurrency" defaultValue="GBP" className="mt-1" />
              <Hint>All outputs must be in one currency — the platform holds no exchange rates.</Hint>
            </div>
          </>
        )}
        {(allocationMethod === "NONE" || allocationMethod === "MANUAL") && (
          <div className="sm:col-span-2">
            <Hint>
              This process uses {allocationMethod === "NONE" ? "no allocation" : "a manual split"}, so co-products are
              recorded for context only and do not drive the calculation.
            </Hint>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor={`output-notes-${processId}`}>Notes</Label>
          <Input id={`output-notes-${processId}`} name="notes" className="mt-1" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save co-product"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
