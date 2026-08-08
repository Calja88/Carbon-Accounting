import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Boxes, Plus } from "lucide-react";
import { resolveAiActor } from "@/lib/ai";
import { listLcaProjects } from "@/lib/lca/service";
import { BOUNDARY_TYPE_LABELS } from "@/lib/lca/stages";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_TONES: Record<string, "neutral" | "info" | "success" | "warning"> = {
  DRAFT: "neutral",
  IN_PROGRESS: "info",
  UNDER_REVIEW: "warning",
  COMPLETE: "success",
  ARCHIVED: "neutral",
};

export default async function LcaListPage() {
  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const projects = await listLcaProjects(actor.entityIds);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Life cycle assessment</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Product studies built as structured projects — goal and scope, system boundary, life cycle inventory,
            results, hotspots and scenarios. Figures come from the same approved emission factors as the corporate
            inventory, calculated deterministically. The AI copilot helps you build and interpret a study; it never
            produces a number.
          </p>
        </div>
        <Link href="/lca/new">
          <Button>
            <Plus className="h-4 w-4" />
            New study
          </Button>
        </Link>
      </div>

      <div className="space-y-2">
        {projects.length === 0 && (
          <Card>
            <CardContent>
              <p className="text-sm text-slate-500">
                No studies yet. Start one and the goal-and-scope wizard will walk through the methodological choices a
                life cycle assessment needs before any inventory is entered.
              </p>
            </CardContent>
          </Card>
        )}

        {projects.map((project) => {
          const latest = project.results[0];
          return (
            <Link key={project.id} href={`/lca/${project.id}`}>
              <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                      <Boxes className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-slate-900">{project.name}</span>
                        <Badge tone={STATUS_TONES[project.status] ?? "neutral"}>
                          {project.status.replace(/_/g, " ").toLowerCase()}
                        </Badge>
                        {!project.goalScope?.confirmedAt && <Badge tone="warning">Goal &amp; scope unconfirmed</Badge>}
                      </div>
                      <div className="text-sm text-slate-500">
                        {project.productName}
                        {project.goalScope?.systemBoundaryType
                          ? ` · ${BOUNDARY_TYPE_LABELS[project.goalScope.systemBoundaryType]}`
                          : ""}
                        {project.goalScope?.functionalUnitDescription
                          ? ` · per ${project.goalScope.functionalUnitDescription}`
                          : " · functional unit not yet defined"}
                      </div>
                      <div className="text-xs text-slate-400">
                        {latest
                          ? `Last calculated ${Number(latest.totalKgCo2e).toFixed(3)} kgCO2e${latest.unmappedFlowCount > 0 ? `, ${latest.unmappedFlowCount} flow(s) still without a factor` : ""}`
                          : "Not calculated yet"}
                        {" · "}
                        {project._count.stages} stage{project._count.stages === 1 ? "" : "s"} ·{" "}
                        {project._count.scenarios} scenario{project._count.scenarios === 1 ? "" : "s"} · created by{" "}
                        {project.createdBy.name}
                      </div>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-blue-700">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
