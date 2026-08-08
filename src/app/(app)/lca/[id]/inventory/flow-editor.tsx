"use client";

import { useActionState, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import {
  mapFactorAction,
  saveFlowAction,
  suggestFlowFactorAction,
  type FlowState,
  type FactorSuggestionState,
} from "../../actions";
import { FLOW_TYPE_LABELS } from "@/lib/lca/stages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { AiSuggestionBadge, AiUnavailableNotice, ConfidenceIndicator } from "@/components/ai/ai-disclosure";

const flowInitial: FlowState = { error: null, saved: false };
const suggestionInitial: FactorSuggestionState = {
  error: null,
  aiUnavailable: false,
  flowId: null,
  suggestedFactorId: null,
  reason: null,
  confidence: null,
  candidates: [],
};

const DQ_DIMENSIONS = [
  { name: "dqReliability", label: "Source reliability" },
  { name: "dqCompleteness", label: "Completeness" },
  { name: "dqTemporal", label: "Temporal relevance" },
  { name: "dqGeographical", label: "Geographical relevance" },
  { name: "dqTechnological", label: "Technological relevance" },
] as const;

export function AddFlowForm({ projectId, processId }: { projectId: string; processId: string }) {
  const [state, formAction, pending] = useActionState(saveFlowAction, flowInitial);
  const [open, setOpen] = useState(false);
  const [flowType, setFlowType] = useState("MATERIAL");

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add a flow
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="processId" value={processId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor={`name-${processId}`}>Flow name</Label>
          <Input id={`name-${processId}`} name="name" required placeholder="e.g. Aluminium foil, 8 µm" className="mt-1" />
        </div>
        <div>
          <Label htmlFor={`direction-${processId}`}>Direction</Label>
          <Select id={`direction-${processId}`} name="direction" defaultValue="INPUT" className="mt-1">
            <option value="INPUT">Input</option>
            <option value="OUTPUT">Output</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`flowType-${processId}`}>Type</Label>
          <Select
            id={`flowType-${processId}`}
            name="flowType"
            value={flowType}
            onChange={(e) => setFlowType(e.target.value)}
            className="mt-1"
          >
            {Object.entries(FLOW_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`quantity-${processId}`}>Quantity</Label>
          <Input id={`quantity-${processId}`} name="quantity" type="number" step="any" min="0" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor={`unit-${processId}`}>Unit</Label>
          <Input id={`unit-${processId}`} name="unit" required placeholder="e.g. kg, kWh, tonne.km" className="mt-1" />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="perFunctionalUnit" defaultChecked className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>
          This quantity is per functional unit
          <span className="block text-xs text-slate-500">
            Untick if it covers the whole reference flow — the engine will divide by the reference flow quantity, and
            will report the flow as a gap rather than guess if that quantity isn&apos;t recorded.
          </span>
        </span>
      </label>

      {flowType === "TRANSPORT" && (
        <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`mass-${processId}`}>Mass moved (tonnes)</Label>
            <Input id={`mass-${processId}`} name="transportMassTonnes" type="number" step="any" min="0" className="mt-1" />
          </div>
          <div>
            <Label htmlFor={`distance-${processId}`}>Distance (km)</Label>
            <Input id={`distance-${processId}`} name="transportDistanceKm" type="number" step="any" min="0" className="mt-1" />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            Give both and the engine computes tonne-kilometres itself, keeping the two inputs visible in the audit
            trail. Give only one and the flow is reported as incomplete rather than half-calculated.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`allocation-${processId}`}>Allocation to this product (%)</Label>
          <Input
            id={`allocation-${processId}`}
            name="allocationPercent"
            type="number"
            step="any"
            min="0"
            max="100"
            defaultValue={100}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`dataType-${processId}`}>Data type</Label>
          <Select id={`dataType-${processId}`} name="dataType" defaultValue="" className="mt-1">
            <option value="">— not recorded —</option>
            <option value="PRIMARY">Primary (measured here)</option>
            <option value="SECONDARY">Secondary (from a database or literature)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`year-${processId}`}>Reference year</Label>
          <Input id={`year-${processId}`} name="referenceYear" type="number" min="1990" max="2100" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`source-${processId}`}>Data source</Label>
          <Input id={`source-${processId}`} name="dataSource" placeholder="e.g. Supplier bill of materials, Jan 2026" className="mt-1" />
        </div>
        <div>
          <Label htmlFor={`geo-${processId}`}>Geography</Label>
          <Input id={`geo-${processId}`} name="geography" placeholder="e.g. UK" className="mt-1" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor={`supplier-${processId}`}>Supplier (optional)</Label>
          <Input id={`supplier-${processId}`} name="supplierName" className="mt-1" />
        </div>
      </div>

      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Data quality — 1 is best, 5 is worst</legend>
        <p className="text-xs text-slate-500">
          Leave a dimension blank if you haven&apos;t assessed it. Blank is reported as unknown, never assumed good.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-5">
          {DQ_DIMENSIONS.map((dim) => (
            <div key={dim.name}>
              <Label htmlFor={`${dim.name}-${processId}`} className="text-xs">
                {dim.label}
              </Label>
              <Select id={`${dim.name}-${processId}`} name={dim.name} defaultValue="" className="mt-1">
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor={`notes-${processId}`}>Notes</Label>
        <textarea
          id={`notes-${processId}`}
          name="notes"
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.saved && <p className="text-sm text-emerald-700">Flow saved.</p>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save flow"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

export interface FlowRow {
  id: string;
  name: string;
  unit: string;
  hasFactor: boolean;
  factorLabel: string | null;
  aiAssisted: boolean;
}

/**
 * Factor mapping for one flow.
 *
 * The candidate list is a database query against the platform's own approved
 * catalogue. AI ranks that list and explains its pick; it cannot add to the
 * list, and it never sees the factor values shown here. Mapping only happens
 * when the person presses the button.
 */
export function FactorMapper({
  projectId,
  flow,
  aiAvailable,
}: {
  projectId: string;
  flow: FlowRow;
  aiAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState(suggestFlowFactorAction, suggestionInitial);
  const isThisFlow = state.flowId === flow.id;

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          {flow.hasFactor ? (
            <span className="text-slate-700">
              Mapped to <span className="font-medium">{flow.factorLabel}</span>{" "}
              {flow.aiAssisted && <Badge tone="info">AI-suggested, accepted by a person</Badge>}
            </span>
          ) : (
            <span className="text-amber-800">
              No factor mapped — this flow contributes nothing to the total and is reported as a gap, not as zero.
            </span>
          )}
        </div>
        <form action={formAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="flowId" value={flow.id} />
          <Button type="submit" variant="secondary" size="sm" disabled={pending || !aiAvailable}>
            <Sparkles className="h-4 w-4" />
            {pending ? "Looking…" : "Find a factor"}
          </Button>
        </form>
      </div>

      {isThisFlow && state.aiUnavailable && (
        <AiUnavailableNotice
          message={state.error ?? "AI ranking is unavailable."}
          action="The candidate factors below still come from this platform's own catalogue — pick one by hand."
        />
      )}

      {isThisFlow && state.error && !state.aiUnavailable && <p className="text-sm text-red-600">{state.error}</p>}

      {isThisFlow && state.candidates.length === 0 && !state.error && (
        <p className="text-sm text-slate-600">
          NO FACTOR FOUND — the catalogue holds nothing applicable to this flow. Import a factor set covering it via
          Admin → Emission factors. Nothing is invented to fill the gap.
        </p>
      )}

      {isThisFlow && state.candidates.length > 0 && (
        <div className="space-y-2">
          {state.reason && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <AiSuggestionBadge />
                {state.confidence !== null && (
                  <ConfidenceIndicator state={state.confidence >= 0.7 ? "SUGGESTED" : "NEEDS_REVIEW"} confidence={state.confidence} />
                )}
              </div>
              <p className="text-sm text-slate-700">{state.reason}</p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1.5 pr-3" />
                  <th className="py-1.5 pr-3">Factor</th>
                  <th className="py-1.5 pr-3">Unit</th>
                  <th className="py-1.5 pr-3 text-right">kgCO2e / unit</th>
                  <th className="py-1.5">Source</th>
                </tr>
              </thead>
              <tbody>
                {state.candidates.map((candidate) => (
                  <tr key={candidate.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">
                      <form action={mapFactorAction}>
                        <input type="hidden" name="projectId" value={projectId} />
                        <input type="hidden" name="flowId" value={flow.id} />
                        <input type="hidden" name="emissionFactorId" value={candidate.id} />
                        {candidate.isSuggested && <input type="hidden" name="fromAiSuggestion" value="1" />}
                        <Button type="submit" variant="secondary" size="sm">
                          Map
                        </Button>
                      </form>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-800">
                      {candidate.label}
                      {candidate.isSuggested && (
                        <Badge tone="info" className="ml-2">
                          AI&apos;s pick
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{candidate.unit}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700">{candidate.value}</td>
                    <td className="py-1.5 text-xs text-slate-500">
                      {candidate.source}, vintage {candidate.vintage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            Factor values are read from this platform&apos;s approved catalogue and shown here for you to check. They were
            never sent to the model, and the model can only choose from this list — an id it invents is discarded before
            it reaches this screen.
          </p>
        </div>
      )}
    </div>
  );
}
