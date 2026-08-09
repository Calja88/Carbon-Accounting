import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/admin";
import { ensureLciSourcesInitialized, listLciSources } from "@/lib/lci/source-registry";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImportPanel } from "./import-panel";

const DECISION_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ALLOW_WITH_ATTRIBUTION: "success",
  CONDITIONAL_DATASET_LEVEL_REVIEW: "warning",
  BLOCK: "danger",
  METADATA_ONLY: "neutral",
};

const DECISION_LABEL: Record<string, string> = {
  ALLOW_WITH_ATTRIBUTION: "Allowed (with attribution)",
  CONDITIONAL_DATASET_LEVEL_REVIEW: "Conditional — dataset-level review",
  BLOCK: "Blocked",
  METADATA_ONLY: "Metadata only",
};

export default async function AdminLciSourcesPage() {
  const session = await requireAdminSession();
  if (!session) redirect("/");

  // Self-initialises the registry from the manifest, mirroring the AI
  // settings/catalogue self-init — no manual seed step required in
  // production for this page to always show the current registry.
  await ensureLciSourcesInitialized();
  const sources = await listLciSources();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">LCI data sources</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every external LCI/PCF data source considered for this platform, screened for its licence and redistribution
          terms. Only a source marked <strong>Allowed (with attribution)</strong> may ever have numeric factor values
          imported here — everything else is catalogued for discovery/audit only and is numerically blocked, whatever
          any individual file claims. This is not a complete LCI database: every imported row is a characterised UK
          GHG conversion factor, not a full unit-process life-cycle inventory.
        </p>
      </div>

      <div className="space-y-2">
        {sources.map((s) => {
          const importedFactorCount = s.factorSets.reduce((sum, set) => sum + set._count.factors, 0);
          return (
            <Card key={s.id}>
              <CardContent>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{s.sourceName}</span>
                      <Badge tone={DECISION_TONE[s.licenseDecision] ?? "neutral"}>
                        {DECISION_LABEL[s.licenseDecision] ?? s.licenseDecision}
                      </Badge>
                    </div>
                    <div className="text-sm text-slate-500">
                      {s.sourceId} {s.owner ? `· ${s.owner}` : ""} {s.coverage ? `· ${s.coverage}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Raw manifest decision: <code>{s.rawLicenseDecision}</code>
                      {s.relevance ? ` · relevance ${s.relevance}` : ""}
                      {s.lastChecked ? ` · last checked ${new Date(s.lastChecked).toLocaleDateString("en-GB")}` : ""}
                    </div>
                    {s.recommendedAction && <p className="mt-2 text-sm text-slate-600">{s.recommendedAction}</p>}
                  </div>
                  <div className="text-right text-sm text-slate-500">
                    {s.factorSets.length > 0 ? (
                      <div>
                        <div className="font-medium text-slate-900">
                          {importedFactorCount} factor{importedFactorCount === 1 ? "" : "s"} imported
                        </div>
                        <div>
                          {s.factorSets.length} version{s.factorSets.length === 1 ? "" : "s"}:{" "}
                          {s.factorSets.map((set) => set.sourceVersion ?? "?").join(", ")}
                        </div>
                      </div>
                    ) : (
                      <span>No factors imported yet</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ImportPanel />
    </div>
  );
}
