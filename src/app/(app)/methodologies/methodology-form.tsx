"use client";

import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import {
  LcaAllocationMethod,
  LcaBiogenicTreatment,
  LcaBoundary,
  LcaElectricityApproach,
  LcaOffsetTreatment,
  LcaRecyclingMethod,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import {
  ALLOCATION_LABELS,
  BIOGENIC_LABELS,
  BOUNDARY_LABELS,
  ELECTRICITY_LABELS,
  OFFSET_LABELS,
  RECYCLING_METHOD_LABELS,
} from "@/lib/lca/labels";
import { emptyMethodologyState } from "@/lib/lca/form-state";
import { archiveMethodologyAction, saveMethodologyAction } from "./actions";

export interface MethodologyValues {
  id: string;
  entityId: string | null;
  name: string;
  version: string;
  summary: string | null;
  defaultBoundary: string;
  gwpBasis: string;
  defaultAllocationMethod: string;
  allocationRules: string | null;
  recyclingMethod: string;
  recyclingRules: string | null;
  electricityApproach: string;
  electricityRules: string | null;
  biogenicTreatment: string;
  biogenicRules: string | null;
  removalsRules: string | null;
  offsetTreatment: string;
  offsetRules: string | null;
  cutOffRules: string | null;
  cutOffThresholdPercent: string | null;
  factorHierarchy: string[];
  dataQualityRequirements: string | null;
  minimumDataQualityScore: string | null;
  requireEvidenceForPrimary: boolean;
  standardsReferenced: string[];
  notes: string | null;
  isDefault: boolean;
}

export function MethodologyForm({
  profile,
  entities,
  trigger = "add",
}: {
  profile?: MethodologyValues;
  entities: { id: string; name: string }[];
  trigger?: "add" | "edit";
}) {
  const [state, formAction, pending] = useActionState(saveMethodologyAction, emptyMethodologyState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return trigger === "add" ? (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New methodology profile
      </Button>
    ) : (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      {profile && <input type="hidden" name="profileId" value={profile.id} />}
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <Notice tone="info">
        Every field on this page is read by the calculation engine, not just by a reader. Changing one changes the
        arithmetic of every draft assessment that uses this profile from its next calculation run. Issued versions keep
        the methodology frozen into them and are unaffected.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="methodologyName">Name</Label>
          <Input id="methodologyName" name="name" required defaultValue={profile?.name} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="methodologyVersion">Version</Label>
          <Input id="methodologyVersion" name="version" required defaultValue={profile?.version} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="methodologyEntity">Operating unit</Label>
          <Select id="methodologyEntity" name="entityId" defaultValue={profile?.entityId ?? ""} className="mt-1">
            <option value="">Applies to the whole group</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="methodologySummary">Summary</Label>
          <Textarea id="methodologySummary" name="summary" rows={2} defaultValue={profile?.summary ?? ""} className="mt-1" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="defaultBoundary">Default boundary</Label>
          <Select id="defaultBoundary" name="defaultBoundary" defaultValue={profile?.defaultBoundary ?? LcaBoundary.CRADLE_TO_GATE} className="mt-1">
            {Object.entries(BOUNDARY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="gwpBasis">GWP basis</Label>
          <Input id="gwpBasis" name="gwpBasis" required defaultValue={profile?.gwpBasis} className="mt-1" placeholder="IPCC AR6 (2021), GWP100" />
          <Hint>Which characterisation factors turn each gas into CO2 equivalent, and over what horizon.</Hint>
        </div>

        <div>
          <Label htmlFor="defaultAllocationMethod">Default allocation</Label>
          <Select
            id="defaultAllocationMethod"
            name="defaultAllocationMethod"
            defaultValue={profile?.defaultAllocationMethod ?? LcaAllocationMethod.MASS}
            className="mt-1"
          >
            {Object.entries(ALLOCATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="allocationRules">Allocation rules</Label>
          <Textarea id="allocationRules" name="allocationRules" rows={2} defaultValue={profile?.allocationRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="recyclingMethod">Recycling treatment</Label>
          <Select id="recyclingMethod" name="recyclingMethod" defaultValue={profile?.recyclingMethod ?? LcaRecyclingMethod.CUT_OFF} className="mt-1">
            {Object.entries(RECYCLING_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Hint>
            The engine reads this: an end-of-life recovery credit is only applied under avoided burden or the circular
            footprint formula, and is always carried as its own class.
          </Hint>
        </div>
        <div>
          <Label htmlFor="recyclingRules">Recycling rules</Label>
          <Textarea id="recyclingRules" name="recyclingRules" rows={2} defaultValue={profile?.recyclingRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="electricityApproach">Electricity</Label>
          <Select
            id="electricityApproach"
            name="electricityApproach"
            defaultValue={profile?.electricityApproach ?? LcaElectricityApproach.LOCATION_BASED}
            className="mt-1"
          >
            {Object.entries(ELECTRICITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="electricityRules">Electricity rules</Label>
          <Textarea id="electricityRules" name="electricityRules" rows={2} defaultValue={profile?.electricityRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="biogenicTreatment">Biogenic carbon</Label>
          <Select
            id="biogenicTreatment"
            name="biogenicTreatment"
            defaultValue={profile?.biogenicTreatment ?? LcaBiogenicTreatment.REPORTED_SEPARATELY}
            className="mt-1"
          >
            {Object.entries(BIOGENIC_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="biogenicRules">Biogenic rules</Label>
          <Textarea id="biogenicRules" name="biogenicRules" rows={2} defaultValue={profile?.biogenicRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="offsetTreatment">Offsets</Label>
          <Select id="offsetTreatment" name="offsetTreatment" defaultValue={profile?.offsetTreatment ?? LcaOffsetTreatment.DISCLOSED_SEPARATELY} className="mt-1">
            {Object.entries(OFFSET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Hint>Neither option lets an offset reduce a reported product footprint.</Hint>
        </div>
        <div>
          <Label htmlFor="offsetRules">Offset rules</Label>
          <Textarea id="offsetRules" name="offsetRules" rows={2} defaultValue={profile?.offsetRules ?? ""} className="mt-1" />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="removalsRules">Removals rules</Label>
          <Textarea id="removalsRules" name="removalsRules" rows={2} defaultValue={profile?.removalsRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="cutOffThresholdPercent">Cut-off threshold (%)</Label>
          <Input id="cutOffThresholdPercent" name="cutOffThresholdPercent" defaultValue={profile?.cutOffThresholdPercent ?? ""} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="cutOffRules">Cut-off rules</Label>
          <Textarea id="cutOffRules" name="cutOffRules" rows={2} defaultValue={profile?.cutOffRules ?? ""} className="mt-1" />
        </div>

        <div>
          <Label htmlFor="factorHierarchy">Factor hierarchy (one per line, best first)</Label>
          <Textarea
            id="factorHierarchy"
            name="factorHierarchy"
            rows={4}
            defaultValue={profile?.factorHierarchy.join("\n") ?? ""}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="standardsReferenced">Standards referenced (one per line)</Label>
          <Textarea
            id="standardsReferenced"
            name="standardsReferenced"
            rows={4}
            defaultValue={profile?.standardsReferenced.join("\n") ?? ""}
            className="mt-1"
          />
          <Hint>Naming a standard describes the approach followed. It is not a claim of conformity or certification.</Hint>
        </div>

        <div>
          <Label htmlFor="minimumDataQualityScore">Minimum data-quality score</Label>
          <Input id="minimumDataQualityScore" name="minimumDataQualityScore" defaultValue={profile?.minimumDataQualityScore ?? ""} className="mt-1" />
          <Hint>Footprint-weighted, 1 best to 5 worst. The review centre checks against it.</Hint>
        </div>
        <div>
          <Label htmlFor="dataQualityRequirements">Data quality requirements</Label>
          <Textarea
            id="dataQualityRequirements"
            name="dataQualityRequirements"
            rows={3}
            defaultValue={profile?.dataQualityRequirements ?? ""}
            className="mt-1"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="methodologyNotes">Notes</Label>
          <Textarea id="methodologyNotes" name="notes" rows={2} defaultValue={profile?.notes ?? ""} className="mt-1" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="requireEvidenceForPrimary"
            defaultChecked={profile?.requireEvidenceForPrimary ?? true}
            className="h-4 w-4 rounded border-slate-300"
          />
          Require supporting evidence for primary and supplier-specific data
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isDefault" defaultChecked={profile?.isDefault ?? false} className="h-4 w-4 rounded border-slate-300" />
          Use as the default profile for new assessments
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save methodology profile"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

/**
 * Archives a methodology profile. Archival, never deletion: assessments
 * reference the profile live and issued assessment versions cite it inside a
 * frozen snapshot, so the row has to stay resolvable.
 */
export function ArchiveMethodologyForm({ profileId, label }: { profileId: string; label: string }) {
  const [state, formAction, pending] = useActionState(archiveMethodologyAction, emptyMethodologyState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return <Button size="sm" variant="danger" onClick={() => setOpen(true)}>Archive</Button>;
  }

  return (
    <form action={formAction} className="space-y-2 text-left">
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}
      <input type="hidden" name="profileId" value={profileId} />
      <div>
        <Label htmlFor={`archive-methodology-reason-${profileId}`}>Reason</Label>
        <Input id={`archive-methodology-reason-${profileId}`} name="reason" required className="mt-1" />
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={(event) => { if (!confirm(`Archive "${label}"? It stops being selectable for new assessments; issued versions keep their frozen methodology.`)) event.preventDefault(); }}
        >
          {pending ? "Archiving…" : "Archive profile"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
