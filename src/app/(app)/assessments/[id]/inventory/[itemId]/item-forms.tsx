"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import {
  LcaCorporateLinkType,
  LcaEndOfLifeRouteType,
  LcaFactorSelectionMode,
  LcaTransportMode,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import {
  CORPORATE_LINK_LABELS,
  EOL_ROUTE_LABELS,
  FACTOR_BOUNDARY_LABELS,
  TRANSPORT_MODE_LABELS,
} from "@/lib/lca/labels";
import { emptyAssessmentState as emptyInventoryState } from "@/lib/lca/form-state";
import {
  assignFactorAction,
  createCorporateLinkAction,
  saveEndOfLifeRouteAction,
  saveTransportLegAction,
} from "../actions";

export interface FactorOption {
  id: string;
  label: string;
  summary: string;
  isPlaceholder: boolean;
}

export interface SupplierPcfOption {
  id: string;
  label: string;
  summary: string;
}

export function FactorAssignmentForm({
  assessmentId,
  inventoryItemId,
  itemUnit,
  currentMode,
  currentFactorId,
  currentRecycledFactorId,
  currentSupplierPcfId,
  manual,
  factorOptions,
  recycledFactorOptions,
  supplierPcfOptions,
  hasRecycledContent,
  disabled,
}: {
  assessmentId: string;
  inventoryItemId: string;
  itemUnit: string;
  currentMode: string;
  currentFactorId: string | null;
  currentRecycledFactorId: string | null;
  currentSupplierPcfId: string | null;
  manual: {
    value: string | null;
    unit: string | null;
    source: string | null;
    version: string | null;
    boundary: string | null;
    geography: string | null;
    year: number | null;
    gwpBasis: string | null;
    rationale: string | null;
  };
  factorOptions: FactorOption[];
  recycledFactorOptions: FactorOption[];
  supplierPcfOptions: SupplierPcfOption[];
  hasRecycledContent: boolean;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(assignFactorAction, emptyInventoryState);
  const [mode, setMode] = useState(currentMode);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />

      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div>
        <Label htmlFor="mode">How this line is priced</Label>
        <Select id="mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} disabled={disabled} className="mt-1">
          <option value={LcaFactorSelectionMode.NONE}>No factor assigned</option>
          <option value={LcaFactorSelectionMode.LIBRARY_FACTOR}>From the factor library</option>
          <option value={LcaFactorSelectionMode.SUPPLIER_PCF}>A supplier&apos;s own product footprint</option>
          <option value={LcaFactorSelectionMode.MANUAL}>Manually entered, with a source</option>
        </Select>
        <Hint>
          Only factors expressed per a unit compatible with {itemUnit} are offered — a factor per kWh cannot be applied to
          a quantity in kg.
        </Hint>
      </div>

      {mode === LcaFactorSelectionMode.LIBRARY_FACTOR && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="emissionFactorId">Factor</Label>
            <Select
              id="emissionFactorId"
              name="emissionFactorId"
              defaultValue={currentFactorId ?? ""}
              disabled={disabled}
              className="mt-1"
            >
              <option value="">Choose a factor…</option>
              {factorOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.isPlaceholder ? "[PLACEHOLDER] " : ""}
                  {option.label} — {option.summary}
                </option>
              ))}
            </Select>
            {factorOptions.length === 0 && (
              <Hint>
                Nothing in the library is expressed per a unit compatible with {itemUnit}. Import factors through Admin →
                Emission factors, or enter a sourced factor manually.
              </Hint>
            )}
          </div>

          {hasRecycledContent && (
            <div>
              <Label htmlFor="recycledEmissionFactorId">Recycled-route factor (optional)</Label>
              <Select
                id="recycledEmissionFactorId"
                name="recycledEmissionFactorId"
                defaultValue={currentRecycledFactorId ?? ""}
                disabled={disabled}
                className="mt-1"
              >
                <option value="">None — recycled content is disclosed but not priced separately</option>
                {recycledFactorOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.isPlaceholder ? "[PLACEHOLDER] " : ""}
                    {option.label} — {option.summary}
                  </option>
                ))}
              </Select>
              <Hint>
                With one assigned, the quantity is split: the recycled share is priced at this factor and the rest at the
                virgin factor, as two lines in the register. Without one, recycled content changes nothing — it is
                disclosed, not discounted.
              </Hint>
            </div>
          )}
        </div>
      )}

      {mode === LcaFactorSelectionMode.SUPPLIER_PCF && (
        <div>
          <Label htmlFor="supplierPcfId">Supplier PCF</Label>
          <Select id="supplierPcfId" name="supplierPcfId" defaultValue={currentSupplierPcfId ?? ""} disabled={disabled} className="mt-1">
            <option value="">Choose a supplier footprint…</option>
            {supplierPcfOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.summary}
              </option>
            ))}
          </Select>
          <Hint>
            A supplier&apos;s own figure for the thing you actually bought replaces the generic factor, and moves this line
            to supplier-specific data in the quality breakdown.
          </Hint>
        </div>
      )}

      {mode === LcaFactorSelectionMode.MANUAL && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="manualFactorValue">kgCO2e per unit</Label>
            <Input id="manualFactorValue" name="manualFactorValue" defaultValue={manual.value ?? ""} disabled={disabled} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="manualFactorUnit">Per unit</Label>
            <Input
              id="manualFactorUnit"
              name="manualFactorUnit"
              defaultValue={manual.unit ?? itemUnit}
              disabled={disabled}
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="manualFactorSource">Source (required)</Label>
            <Input
              id="manualFactorSource"
              name="manualFactorSource"
              defaultValue={manual.source ?? ""}
              disabled={disabled}
              className="mt-1"
              placeholder="Publisher, dataset or document the value came from"
            />
            <Hint>An unsourced factor is treated as a validation error — nobody can check a number with no origin.</Hint>
          </div>
          <div>
            <Label htmlFor="manualFactorVersion">Version / edition</Label>
            <Input id="manualFactorVersion" name="manualFactorVersion" defaultValue={manual.version ?? ""} disabled={disabled} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="manualFactorYear">Reference year</Label>
            <Input id="manualFactorYear" name="manualFactorYear" defaultValue={manual.year ?? ""} disabled={disabled} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="manualFactorBoundary">What the factor covers</Label>
            <Select
              id="manualFactorBoundary"
              name="manualFactorBoundary"
              defaultValue={manual.boundary ?? ""}
              disabled={disabled}
              className="mt-1"
            >
              <option value="">Not stated</option>
              {Object.entries(FACTOR_BOUNDARY_LABELS)
                .filter(([value]) => value !== "UNKNOWN")
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="manualFactorGeography">Geography</Label>
            <Input
              id="manualFactorGeography"
              name="manualFactorGeography"
              defaultValue={manual.geography ?? ""}
              disabled={disabled}
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="manualFactorGwpBasis">GWP basis</Label>
            <Input
              id="manualFactorGwpBasis"
              name="manualFactorGwpBasis"
              defaultValue={manual.gwpBasis ?? ""}
              disabled={disabled}
              className="mt-1"
              placeholder="IPCC AR6 (2021), GWP100"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="manualFactorRationale">Why this factor</Label>
            <Textarea
              id="manualFactorRationale"
              name="manualFactorRationale"
              rows={2}
              defaultValue={manual.rationale ?? ""}
              disabled={disabled}
              className="mt-1"
            />
          </div>
        </div>
      )}

      {!disabled && (
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save factor"}
        </Button>
      )}
    </form>
  );
}

export function TransportLegForm({
  assessmentId,
  inventoryItemId,
  factorOptions,
  disabled,
}: {
  assessmentId: string;
  inventoryItemId: string;
  factorOptions: FactorOption[];
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveTransportLegAction, emptyInventoryState);
  const [open, setOpen] = useState(false);

  if (disabled) return null;

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add leg
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="legMode">Mode</Label>
          <Select id="legMode" name="mode" defaultValue={LcaTransportMode.ROAD} className="mt-1">
            {Object.entries(TRANSPORT_MODE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="originName">From</Label>
          <Input id="originName" name="originName" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="destinationName">To</Label>
          <Input id="destinationName" name="destinationName" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="distanceValue">Distance</Label>
          <Input id="distanceValue" name="distanceValue" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="distanceUnit">Distance unit</Label>
          <Input id="distanceUnit" name="distanceUnit" defaultValue="km" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="modeDescription">Mode description</Label>
          <Input id="modeDescription" name="modeDescription" className="mt-1" placeholder="Articulated HGV, 40 t" />
        </div>
        <div>
          <Label htmlFor="massValue">Consignment mass</Label>
          <Input id="massValue" name="massValue" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="massUnit">Mass unit</Label>
          <Input id="massUnit" name="massUnit" defaultValue="kg" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="loadFactorPercent">Share of vehicle (%)</Label>
          <Input id="loadFactorPercent" name="loadFactorPercent" className="mt-1" />
          <Hint>
            Only applied when the factor is per vehicle-kilometre. A tonne-kilometre factor already accounts for
            utilisation, and the provenance says so.
          </Hint>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="legFactorId">Freight factor</Label>
          <Select id="legFactorId" name="emissionFactorId" className="mt-1">
            <option value="">Enter one manually below…</option>
            {factorOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.isPlaceholder ? "[PLACEHOLDER] " : ""}
                {option.label} — {option.summary}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="legManualValue">Manual factor value</Label>
          <Input id="legManualValue" name="manualFactorValue" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="legManualUnit">Per unit</Label>
          <Input id="legManualUnit" name="manualFactorUnit" className="mt-1" placeholder="t.km" />
        </div>
        <div>
          <Label htmlFor="legManualSource">Source</Label>
          <Input id="legManualSource" name="manualFactorSource" className="mt-1" />
        </div>
        <div className="sm:col-span-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="includesReturnTrip" className="h-4 w-4 rounded border-slate-300" />
            Include the return trip (doubles the distance)
          </label>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="legAssumptions">Assumptions</Label>
          <Textarea id="legAssumptions" name="assumptions" rows={2} className="mt-1" placeholder="Routing, load, empty running" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save leg"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function EndOfLifeRouteForm({
  assessmentId,
  inventoryItemId,
  factorOptions,
  currentTotalPercent,
  allowsCredits,
  disabled,
}: {
  assessmentId: string;
  inventoryItemId: string;
  factorOptions: FactorOption[];
  currentTotalPercent: number;
  allowsCredits: boolean;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveEndOfLifeRouteAction, emptyInventoryState);
  const [open, setOpen] = useState(false);

  if (disabled) return null;

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add route
      </Button>
    );
  }

  const remaining = Math.max(0, 100 - currentTotalPercent);

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="routeType">Route</Label>
          <Select id="routeType" name="route" defaultValue={LcaEndOfLifeRouteType.LANDFILL} className="mt-1">
            {Object.entries(EOL_ROUTE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="routePercent">Share of mass (%)</Label>
          <Input id="routePercent" name="percent" required defaultValue={remaining > 0 ? String(remaining) : ""} className="mt-1" />
          <Hint>Routes must total exactly 100%. Currently {currentTotalPercent}%.</Hint>
        </div>
        <div>
          <Label htmlFor="routeDescription">Description</Label>
          <Input id="routeDescription" name="routeDescription" className="mt-1" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="routeFactorId">Treatment factor</Label>
          <Select id="routeFactorId" name="emissionFactorId" className="mt-1">
            <option value="">Enter one manually below…</option>
            {factorOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.isPlaceholder ? "[PLACEHOLDER] " : ""}
                {option.label} — {option.summary}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="routeManualValue">Manual factor value</Label>
          <Input id="routeManualValue" name="manualFactorValue" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="routeManualUnit">Per unit</Label>
          <Input id="routeManualUnit" name="manualFactorUnit" className="mt-1" placeholder="kg" />
        </div>
        <div>
          <Label htmlFor="routeManualSource">Source</Label>
          <Input id="routeManualSource" name="manualFactorSource" className="mt-1" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h5 className="text-sm font-semibold text-slate-800">Recovery credit</h5>
        <Hint>
          {allowsCredits
            ? "This assessment's methodology allows an avoided-burden credit. It is calculated as its own class and never merged into gross emissions."
            : "This assessment's methodology uses a cut-off treatment, so no end-of-life credit applies. Anything entered here is recorded but not applied, and the calculation says so."}
        </Hint>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="recoveryRatePercent">Recovery rate (%)</Label>
            <Input id="recoveryRatePercent" name="recoveryRatePercent" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="avoidedFactorValue">Avoided factor</Label>
            <Input id="avoidedFactorValue" name="avoidedFactorValue" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="avoidedFactorUnit">Per unit</Label>
            <Input id="avoidedFactorUnit" name="avoidedFactorUnit" className="mt-1" placeholder="kg" />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="avoidedFactorSource">Avoided factor source</Label>
            <Input id="avoidedFactorSource" name="avoidedFactorSource" className="mt-1" />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="recoveryAssumptions">Recovery assumptions</Label>
            <Textarea id="recoveryAssumptions" name="recoveryAssumptions" rows={2} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save route"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function CorporateLinkForm({
  assessmentId,
  inventoryItemId,
  entries,
  sites,
  disabled,
}: {
  assessmentId: string;
  inventoryItemId: string;
  entries: { id: string; label: string }[];
  sites: { id: string; label: string }[];
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(createCorporateLinkAction, emptyInventoryState);
  const [open, setOpen] = useState(false);

  if (disabled) return null;

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Cite a corporate record
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <Notice tone="info">
        Citing a corporate record says where this product line&apos;s data came from. It moves no emissions: the corporate
        inventory keeps its full absolute figure and this product footprint keeps its own, so nothing is double-counted in
        either direction.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="linkType">Kind of record</Label>
          <Select id="linkType" name="linkType" defaultValue={LcaCorporateLinkType.FACILITY_ENERGY} className="mt-1">
            {Object.entries(CORPORATE_LINK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="linkSiteId">Site</Label>
          <Select id="linkSiteId" name="siteId" className="mt-1">
            <option value="">Not site-specific</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="activityEntryId">Corporate activity entry</Label>
          <Select id="activityEntryId" name="activityEntryId" className="mt-1">
            <option value="">None — link to the site only</option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="allocationPercent">Share attributed to this product (%)</Label>
          <Input id="allocationPercent" name="allocationPercent" defaultValue="100" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="allocationBasis">How that share was arrived at</Label>
          <Input id="allocationBasis" name="allocationBasis" required className="mt-1" placeholder="Share of line hours" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="linkNotes">Notes</Label>
          <Input id="linkNotes" name="notes" className="mt-1" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record citation"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}
