import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { resolveAiActor } from "@/lib/ai";
import { NewProjectForm } from "./new-project-form";

export default async function NewLcaProjectPage() {
  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const [entities, sites] = await Promise.all([
    prisma.entity.findMany({ where: { id: { in: actor.entityIds } }, orderBy: { name: "asc" } }),
    prisma.site.findMany({
      where: { isActive: true, id: { in: actor.siteIds } },
      include: { entity: true },
      orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="max-w-2xl">
      <Link href="/lca" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        All studies
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">New LCA study</h1>
      <p className="mt-1 text-sm text-slate-500">
        The next step after this is the goal-and-scope wizard, which is where the study&apos;s methodological choices get
        made and confirmed. Nothing is calculated until there is an inventory to calculate from.
      </p>

      <div className="mt-6">
        <NewProjectForm
          entities={entities.map((e) => ({ id: e.id, name: e.name }))}
          sites={sites.map((s) => ({ id: s.id, name: s.name, entityName: s.entity.name }))}
        />
      </div>
    </div>
  );
}
