"use client";

import { useActionState, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import type { AiModelInfo } from "@/lib/ai/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  refreshCatalogAction,
  saveAiSettingsAction,
  type AiSettingsState,
  type CatalogRefreshState,
} from "./actions";

const settingsInitial: AiSettingsState = { error: null, saved: false };
const catalogInitial: CatalogRefreshState = { error: null, message: null };

export interface TaskModelRow {
  task: string;
  label: string;
  modelId: string;
  fallbackModelId: string | null;
}

export interface SettingsFormProps {
  settings: {
    aiEnabled: boolean;
    openRouterEnabled: boolean;
    freeOnly: boolean;
    allowFreeRouter: boolean;
    autoAcceptExtraction: boolean;
    minConfidence: number;
    loggingLevel: string;
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  taskModels: TaskModelRow[];
  models: AiModelInfo[];
  catalogRefreshedAt: string | null;
  providerConfigured: boolean;
}

function CostBadge({ cost }: { cost: AiModelInfo["cost"] }) {
  if (cost === "FREE") return <Badge tone="success">Free</Badge>;
  if (cost === "PAID") return <Badge tone="warning">Paid</Badge>;
  return <Badge tone="neutral">Price unknown</Badge>;
}

function Toggle({
  name,
  label,
  description,
  defaultChecked,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-brand-500/30"
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
      </span>
    </label>
  );
}

/**
 * Model pickers offer whatever the live catalogue reports, so an
 * administrator changes routing without a code change. A model that isn't in
 * the catalogue (not yet fetched, or brand new) can still be typed in — the
 * free-only safeguard then judges it on the documented `:free` convention
 * rather than on a capability guess.
 */
function ModelSelect({
  name,
  value,
  models,
  freeOnly,
  allowEmpty,
}: {
  name: string;
  value: string;
  models: AiModelInfo[];
  freeOnly: boolean;
  allowEmpty?: boolean;
}) {
  const [custom, setCustom] = useState(value !== "" && !models.some((m) => m.id === value));

  if (custom || models.length === 0) {
    return (
      <div className="space-y-1">
        <Input name={name} defaultValue={value} placeholder="e.g. openrouter/free" />
        {models.length > 0 && (
          <button type="button" onClick={() => setCustom(false)} className="text-xs text-brand-700 hover:text-brand-800">
            Choose from the catalogue instead
          </button>
        )}
      </div>
    );
  }

  const usable = freeOnly ? models.filter((m) => m.cost === "FREE") : models;

  return (
    <div className="space-y-1">
      <Select name={name} defaultValue={value}>
        {allowEmpty && <option value="">— none —</option>}
        {usable.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id} — {m.cost === "FREE" ? "free" : m.cost === "PAID" ? "paid" : "price unknown"}
            {m.supportsImages ? ", vision" : ""}
            {m.supportsStructuredOutputs ? ", structured" : ""}
          </option>
        ))}
      </Select>
      <button type="button" onClick={() => setCustom(true)} className="text-xs text-brand-700 hover:text-brand-800">
        Enter a model id by hand
      </button>
    </div>
  );
}

export function AiSettingsForm(props: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(saveAiSettingsAction, settingsInitial);
  const [catalogState, catalogAction, refreshing] = useActionState(refreshCatalogAction, catalogInitial);
  const [freeOnly, setFreeOnly] = useState(props.settings.freeOnly);

  const freeModels = props.models.filter((m) => m.cost === "FREE");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Model catalogue</CardTitle>
          <form action={catalogAction}>
            <Button type="submit" variant="secondary" size="sm" disabled={refreshing || !props.providerConfigured}>
              <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {refreshing ? "Refreshing…" : "Refresh from OpenRouter"}
            </Button>
          </form>
        </CardHeader>
        <CardContent className="space-y-2">
          {!props.providerConfigured && (
            <p className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
              No <code className="font-mono">OPENROUTER_API_KEY</code> is set on this deployment, so the catalogue
              can&apos;t be refreshed and no AI feature will run. Core carbon accounting is unaffected.
            </p>
          )}
          <p className="text-sm text-slate-600">
            {props.models.length > 0
              ? `${props.models.length} models known, ${freeModels.length} of them free. Capability and price come from OpenRouter's own metadata — this platform keeps no hand-maintained model list.`
              : "The catalogue hasn't been loaded yet. Until it is, free-only mode falls back to OpenRouter's documented `:free` naming convention, and models that need image input can't be selected because their capabilities can't be confirmed."}
          </p>
          {props.catalogRefreshedAt && (
            <p className="text-xs text-slate-400">
              Last refreshed {new Date(props.catalogRefreshedAt).toLocaleString("en-GB")}.
            </p>
          )}
          {catalogState.message && <p className="text-sm text-emerald-700">{catalogState.message}</p>}
          {catalogState.error && <p className="text-sm text-red-600">{catalogState.error}</p>}
        </CardContent>
      </Card>

      <form action={formAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Availability and safety</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Toggle
              name="aiEnabled"
              label="AI features enabled"
              description="Turn this off and every AI affordance disappears behind a clear message. Data entry, calculation and reporting are unaffected."
              defaultChecked={props.settings.aiEnabled}
            />
            <Toggle
              name="openRouterEnabled"
              label="OpenRouter enabled"
              description="The AI provider this deployment calls. Off means no outbound AI requests at all."
              defaultChecked={props.settings.openRouterEnabled}
            />
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50">
              <input
                type="checkbox"
                name="freeOnly"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-brand-500/30"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800">Free models only</span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  The router will only call a model whose pricing metadata confirms it is free. If no free model is
                  available for a task the request fails and the user is told AI is temporarily unavailable — it never
                  falls through to a paid model.
                </span>
              </span>
            </label>
            <Toggle
              name="allowFreeRouter"
              label="Allow OpenRouter's free-model router"
              description="Lets openrouter/free be used as a last-resort fallback. It survives an individual free model being retired, which is the most common failure here."
              defaultChecked={props.settings.allowFreeRouter}
            />
            <Toggle
              name="autoAcceptExtraction"
              label="Auto-accept document extractions"
              description="Off by design. With it off, an extraction always goes to the review screen and only a person's acceptance creates accounting data."
              defaultChecked={props.settings.autoAcceptExtraction}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model for each task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-500">
              Each task routes to its own model, with a fallback tried if the first is unavailable. Changing these takes
              effect on the next request — no redeploy, no code change.
            </p>
            {props.taskModels.map((row) => (
              <div key={row.task} className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[12rem_1fr_1fr]">
                <div>
                  <p className="text-sm font-medium text-slate-800">{row.label}</p>
                  <p className="text-xs text-slate-400">{row.task}</p>
                </div>
                <div>
                  <Label htmlFor={`model-${row.task}`} className="text-xs text-slate-500">
                    Model
                  </Label>
                  <ModelSelect name={`model-${row.task}`} value={row.modelId} models={props.models} freeOnly={freeOnly} />
                </div>
                <div>
                  <Label htmlFor={`fallback-${row.task}`} className="text-xs text-slate-500">
                    Fallback
                  </Label>
                  <ModelSelect
                    name={`fallback-${row.task}`}
                    value={row.fallbackModelId ?? ""}
                    models={props.models}
                    freeOnly={freeOnly}
                    allowEmpty
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thresholds, limits and logging</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="minConfidence">Minimum confidence</Label>
              <Input
                id="minConfidence"
                name="minConfidence"
                type="number"
                step="0.05"
                min="0"
                max="1"
                defaultValue={props.settings.minConfidence}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-slate-400">
                Suggestions below this are called out as needing careful review. It never auto-rejects anything.
              </p>
            </div>
            <div>
              <Label htmlFor="loggingLevel">AI logging level</Label>
              <Select id="loggingLevel" name="loggingLevel" defaultValue={props.settings.loggingLevel} className="mt-1">
                <option value="MINIMAL">Minimal — task, model, status, timing, tokens</option>
                <option value="STANDARD">Standard — the above plus validated structured output</option>
                <option value="VERBOSE">Verbose — the above, for diagnosing routing problems</option>
              </Select>
              <p className="mt-1 text-xs text-slate-400">
                Full prompts and raw document text are never stored at any level, and API keys never are.
              </p>
            </div>
            <div>
              <Label htmlFor="requestsPerMinute">AI requests per user, per minute</Label>
              <Input
                id="requestsPerMinute"
                name="requestsPerMinute"
                type="number"
                min="1"
                max="600"
                defaultValue={props.settings.requestsPerMinute}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="requestsPerDay">AI requests per user, per day</Label>
              <Input
                id="requestsPerDay"
                name="requestsPerDay"
                type="number"
                min="1"
                max="100000"
                defaultValue={props.settings.requestsPerDay}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.saved && <p className="text-sm text-emerald-700">Settings saved.</p>}

        <Button type="submit" disabled={pending}>
          <Save className="h-4 w-4" />
          {pending ? "Saving…" : "Save AI settings"}
        </Button>
      </form>

      {props.models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Models available</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-4">Model</th>
                    <th className="py-2 pr-4">Provider</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4 text-right">Context</th>
                    <th className="py-2 pr-4">Capabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {props.models
                    .slice()
                    .sort((a, b) => (a.cost === b.cost ? a.id.localeCompare(b.id) : a.cost === "FREE" ? -1 : 1))
                    .slice(0, 120)
                    .map((m) => (
                      <tr key={m.id} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-800">{m.name}</td>
                        <td className="py-2 pr-4 text-slate-500">{m.provider}</td>
                        <td className="py-2 pr-4">
                          <CostBadge cost={m.cost} />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-slate-600">
                          {m.contextLength ? m.contextLength.toLocaleString("en-GB") : "—"}
                        </td>
                        <td className="py-2 pr-4 text-slate-600">
                          {[
                            m.supportsImages ? "images" : null,
                            m.supportsFiles ? "files" : null,
                            m.supportsStructuredOutputs ? "structured output" : null,
                            m.supportsTools ? "tools" : null,
                          ]
                            .filter(Boolean)
                            .join(", ") || "text only"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Capabilities shown are only those OpenRouter&apos;s metadata confirms. Nothing here is inferred from a
              model&apos;s name or reputation. Showing the first 120 of {props.models.length}.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
