"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  LcaDataType,
  LcaEmissionClassification,
  LcaItemType,
  LcaUncertaintyStatus,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import {
  CLASSIFICATION_LABELS,
  DATA_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  STAGE_LABELS,
  UNCERTAINTY_LABELS,
} from "@/lib/lca/labels";
import { emptyAssessmentState as emptyInventoryState } from "@/lib/lca/form-state";
import { saveInventoryItemAction } from "./actions";

export interface InventoryItemValues {
  id: string;
  processId: string;
  itemType: string;
  name: string;
  description: string | null;
  componentName: string | null;
  partNumber: string | null;
  materialName: string | null;
  supplierId: string | null;
  quantity: string;
  unit: string;
  adjustmentFactor: string;
  adjustmentRationale: string | null;
  recycledContentPercent: string | null;
  wastePercent: string | null;
  dataType: string;
  dataSource: string | null;
  geography: string | null;
  classification: string;
  biogenicUptakePerUnit: string | null;
  storedCarbonPerUnit: string | null;
  temporalScore: number | null;
  geographicalScore: number | null;
  technologicalScore: number | null;
  completenessScore: number | null;
  reliabilityScore: number | null;
  uncertaintyStatus: string;
  uncertaintyPercent: string | null;
  uncertaintyLower: string | null;
  uncertaintyUpper: string | null;
  uncertaintyNotes: string | null;
  isExcluded: boolean;
  exclusionReason: string | null;
  notes: string | null;
}

const SCORE_HINTS: Record<string, string> = {
  temporalScore: "How close in time the data is to the assessment period.",
  geographicalScore: "How well the data's geography matches where this input really comes from.",
  technologicalScore: "How closely the data's technology matches the process actually used.",
  completenessScore: "How much of the relevant flows the data covers.",
  reliabilityScore: "How the data was obtained — measured, calculated, or estimated.",
};

function ScoreField({
  name,
  label,
  defaultValue,
  disabled,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={name} className="text-xs">
        {label}
      </Label>
      <Select id={name} name={name} defaultValue={defaultValue ? String(defaultValue) : ""} disabled={disabled} className="mt-1">
        <option value="">Not scored</option>
        <option value="1">1 — best</option>
        <option value="2">2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5 — worst</option>
      </Select>
      <Hint>{SCORE_HINTS[name]}</Hint>
    </div>
  );
}

export function InventoryItemForm({
  assessmentId,
  processes,
  suppliers,
  item,
  defaultProcessId,
  trigger = "add",
}: {
  assessmentId: string;
  processes: { id: string; name: string; stage: string }[];
  suppliers: { id: string; name: string }[];
  item?: InventoryItemValues;
  defaultProcessId?: string;
  trigger?: "add" | "edit";
}) {
  const [state, formAction, pending] = useActionState(saveInventoryItemAction, emptyInventoryState);
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState(item?.itemType ?? LcaItemType.MATERIAL);
  const [isExcluded, setIsExcluded] = useState(item?.isExcluded ?? false);

  if (!open) {
    return trigger === "add" ? (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add inventory line
      </Button>
    ) : (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    );
  }

  const isMaterialLike = itemType === LcaItemType.MATERIAL || itemType === LcaItemType.PACKAGING;
  const isTransport = itemType === LcaItemType.TRANSPORT;

  return (
    <form action={formAction} className="w-full space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}

      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="itemName">Name</Label>
          <Input id="itemName" name="name" required defaultValue={item?.name} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="itemType">Type</Label>
          <Select id="itemType" name="itemType" value={itemType} onChange={(e) => setItemType(e.target.value)} className="mt-1">
            {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          {isTransport && (
            <Hint>Transport lines carry their own legs — add them on the line&apos;s detail page after saving.</Hint>
          )}
        </div>
        <div>
          <Label htmlFor="processId">Process</Label>
          <Select id="processId" name="processId" required defaultValue={item?.processId ?? defaultProcessId} className="mt-1">
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {STAGE_LABELS[process.stage as keyof typeof STAGE_LABELS]} — {process.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="supplierId">Supplier</Label>
          <Select id="supplierId" name="supplierId" defaultValue={item?.supplierId ?? ""} className="mt-1">
            <option value="">Not recorded</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label htmlFor="quantity">Quantity</Label>
          <Input id="quantity" name="quantity" required defaultValue={item?.quantity} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" name="unit" required defaultValue={item?.unit ?? "kg"} className="mt-1" />
          <Hint>kg, g, t, kWh, MJ, l, m3, m2, item, t.km…</Hint>
        </div>
        <div>
          <Label htmlFor="adjustmentFactor">Adjustment factor</Label>
          <Input id="adjustmentFactor" name="adjustmentFactor" defaultValue={item?.adjustmentFactor ?? "1"} className="mt-1" />
          <Hint>Multiplier applied after unit conversion, e.g. uses over a lifetime. Shown as its own provenance step.</Hint>
        </div>
        <div>
          <Label htmlFor="adjustmentRationale">Why</Label>
          <Input id="adjustmentRationale" name="adjustmentRationale" defaultValue={item?.adjustmentRationale ?? ""} className="mt-1" />
        </div>
      </div>

      {isMaterialLike && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-semibold text-slate-800">Bill of materials detail</h4>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="componentName">Component / assembly</Label>
              <Input id="componentName" name="componentName" defaultValue={item?.componentName ?? ""} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="partNumber">Part number</Label>
              <Input id="partNumber" name="partNumber" defaultValue={item?.partNumber ?? ""} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="materialName">Material</Label>
              <Input id="materialName" name="materialName" defaultValue={item?.materialName ?? ""} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="recycledContentPercent">Recycled content (%)</Label>
              <Input
                id="recycledContentPercent"
                name="recycledContentPercent"
                defaultValue={item?.recycledContentPercent ?? ""}
                className="mt-1"
              />
              <Hint>
                Disclosed either way. It only changes the figure if you also assign a recycled-route factor — never
                through an assumed discount.
              </Hint>
            </div>
            <div>
              <Label htmlFor="wastePercent">Manufacturing loss (%)</Label>
              <Input id="wastePercent" name="wastePercent" defaultValue={item?.wastePercent ?? ""} className="mt-1" />
              <Hint>Input is grossed up by quantity / (1 − loss). 10% loss on 9 kg out means 10 kg in.</Hint>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="dataType">Data type</Label>
          <Select id="dataType" name="dataType" defaultValue={item?.dataType ?? LcaDataType.SECONDARY} className="mt-1">
            {Object.entries(DATA_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="dataSource">Data source</Label>
          <Input id="dataSource" name="dataSource" defaultValue={item?.dataSource ?? ""} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="geography">Geography</Label>
          <Input id="geography" name="geography" defaultValue={item?.geography ?? ""} className="mt-1" placeholder="DE" />
          <Hint>Checked against the assigned factor&apos;s own geography.</Hint>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-800">Carbon classification</h4>
        <Hint>
          Gross emissions, removals, stored carbon and offsets are tracked separately and never netted into one another.
        </Hint>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="classification">Classification</Label>
            <Select
              id="classification"
              name="classification"
              defaultValue={item?.classification ?? LcaEmissionClassification.FOSSIL}
              className="mt-1"
            >
              {Object.entries(CLASSIFICATION_LABELS)
                .filter(([value]) => value !== "AVOIDED_BURDEN")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="biogenicUptakePerUnit">Biogenic uptake per unit</Label>
            <Input
              id="biogenicUptakePerUnit"
              name="biogenicUptakePerUnit"
              defaultValue={item?.biogenicUptakePerUnit ?? ""}
              className="mt-1"
            />
            <Hint>kgCO2e taken out of the atmosphere per unit of this input. Recorded as a removal, on its own line.</Hint>
          </div>
          <div>
            <Label htmlFor="storedCarbonPerUnit">Stored carbon per unit</Label>
            <Input
              id="storedCarbonPerUnit"
              name="storedCarbonPerUnit"
              defaultValue={item?.storedCarbonPerUnit ?? ""}
              className="mt-1"
            />
            <Hint>kgCO2e held in the product. A memo item — it never reduces the reported footprint.</Hint>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-800">Data quality (1 best, 5 worst)</h4>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <ScoreField name="temporalScore" label="Temporal" defaultValue={item?.temporalScore ?? null} />
          <ScoreField name="geographicalScore" label="Geographical" defaultValue={item?.geographicalScore ?? null} />
          <ScoreField name="technologicalScore" label="Technological" defaultValue={item?.technologicalScore ?? null} />
          <ScoreField name="completenessScore" label="Completeness" defaultValue={item?.completenessScore ?? null} />
          <ScoreField name="reliabilityScore" label="Reliability" defaultValue={item?.reliabilityScore ?? null} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-800">Uncertainty</h4>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <div>
            <Label htmlFor="uncertaintyStatus">Status</Label>
            <Select
              id="uncertaintyStatus"
              name="uncertaintyStatus"
              defaultValue={item?.uncertaintyStatus ?? LcaUncertaintyStatus.NOT_ASSESSED}
              className="mt-1"
            >
              {Object.entries(UNCERTAINTY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="uncertaintyPercent">Uncertainty (%)</Label>
            <Input id="uncertaintyPercent" name="uncertaintyPercent" defaultValue={item?.uncertaintyPercent ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="uncertaintyLower">Lower bound</Label>
            <Input id="uncertaintyLower" name="uncertaintyLower" defaultValue={item?.uncertaintyLower ?? ""} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="uncertaintyUpper">Upper bound</Label>
            <Input id="uncertaintyUpper" name="uncertaintyUpper" defaultValue={item?.uncertaintyUpper ?? ""} className="mt-1" />
          </div>
          <div className="sm:col-span-4">
            <Label htmlFor="uncertaintyNotes">Notes</Label>
            <Input id="uncertaintyNotes" name="uncertaintyNotes" defaultValue={item?.uncertaintyNotes ?? ""} className="mt-1" />
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor="itemNotes">Notes</Label>
        <Textarea id="itemNotes" name="notes" rows={2} defaultValue={item?.notes ?? ""} className="mt-1" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isExcluded"
            checked={isExcluded}
            onChange={(e) => setIsExcluded(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Exclude this line from the model
            <Hint>Excluded lines stay visible to reviewers and appear in the exclusions register.</Hint>
          </span>
        </label>
        {isExcluded && (
          <div className="mt-3">
            <Label htmlFor="exclusionReason">Reason (required)</Label>
            <Input id="exclusionReason" name="exclusionReason" defaultValue={item?.exclusionReason ?? ""} className="mt-1" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save line"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
