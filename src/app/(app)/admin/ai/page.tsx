import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin";
import { AI_TASK_LABELS, AI_TASK_TYPES } from "@/lib/ai";
import { defaultAiConfig, ensureAiSettingsRow } from "@/lib/ai/config";
import { loadCatalog } from "@/lib/ai/catalog-store";
import { getAiUsageSummary } from "@/lib/ai/audit";
import { isProviderConfigured } from "@/lib/ai/provider-registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AiSettingsForm } from "./settings-form";

export default async function AdminAiPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/");

  // Creating the row on first visit is what makes these settings editable
  // without a migration-time seed or a deploy step.
  const settings = await ensureAiSettingsRow();
  const [catalog, usage] = await Promise.all([loadCatalog(), getAiUsageSummary(24)]);

  const defaults = defaultAiConfig();
  const byTask = new Map(settings.taskModels.map((tm) => [tm.task, tm]));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">AI settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          AI in this platform interprets, classifies, extracts, explains and suggests. It never calculates an emissions
          figure and never writes accounting data on its own — every number comes from the deterministic engine and an
          approved emission factor, and every AI suggestion is accepted by a person before it counts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage in the last 24 hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-semibold text-slate-900">{usage.requestsToday}</div>
              <div className="text-xs text-slate-500">requests</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-slate-900">{usage.failuresToday}</div>
              <div className="text-xs text-slate-500">not successful</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-slate-900">{usage.fallbacksToday}</div>
              <div className="text-xs text-slate-500">used a fallback model</div>
            </div>
            <div>
              <div className="text-2xl font-semibold text-slate-900">
                {usage.reportedCostTodayUsd === null || usage.reportedCostTodayUsd === 0
                  ? "—"
                  : `$${usage.reportedCostTodayUsd.toFixed(4)}`}
              </div>
              <div className="text-xs text-slate-500">provider-reported cost</div>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Cost is shown only when OpenRouter itself reports one; this platform never estimates a price. A dash means
            nothing chargeable was reported, which is what free-model usage looks like.
          </p>

          {usage.byFeature.length > 0 && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">By feature</h3>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {usage.byFeature.slice(0, 8).map((f) => (
                    <li key={f.feature} className="flex justify-between gap-3">
                      <span className="truncate">{f.feature}</span>
                      <span className="tabular-nums">{f.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">By model</h3>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {usage.byModel.slice(0, 8).map((m) => (
                    <li key={m.model} className="flex justify-between gap-3">
                      <span className="truncate">{m.model}</span>
                      <span className="tabular-nums">{m.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">By outcome</h3>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-600">
                  {usage.byStatus.map((s) => (
                    <li key={s.status} className="flex justify-between gap-3">
                      <span className="truncate">{s.status}</span>
                      <span className="tabular-nums">{s.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <AiSettingsForm
        settings={{
          aiEnabled: settings.aiEnabled,
          openRouterEnabled: settings.openRouterEnabled,
          freeOnly: settings.freeOnly,
          allowFreeRouter: settings.allowFreeRouter,
          autoAcceptExtraction: settings.autoAcceptExtraction,
          minConfidence: Number(settings.minConfidence),
          loggingLevel: settings.loggingLevel,
          requestsPerMinute: settings.requestsPerMinute,
          requestsPerDay: settings.requestsPerDay,
        }}
        taskModels={AI_TASK_TYPES.map((task) => ({
          task,
          label: AI_TASK_LABELS[task],
          modelId: byTask.get(task)?.modelId ?? defaults.taskModels[task].modelId,
          fallbackModelId: byTask.get(task)?.fallbackModelId ?? defaults.taskModels[task].fallbackModelId,
        }))}
        models={catalog.models}
        catalogRefreshedAt={catalog.refreshedAt?.toISOString() ?? null}
        providerConfigured={isProviderConfigured()}
      />
    </div>
  );
}
