import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { resolveAiActor } from "@/lib/ai";
import { AiAuthorizationError, assertLcaProjectInScope } from "@/lib/ai/authorization";
import { Badge } from "@/components/ui/badge";
import { ProjectNav } from "./project-nav";

/**
 * Shared chrome for one study. The authorization check lives here so every
 * tab underneath inherits it — a page can't be added later that forgets it.
 */
export default async function LcaProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  try {
    await assertLcaProjectInScope(actor, id);
  } catch (err) {
    if (err instanceof AiAuthorizationError) notFound();
    throw err;
  }

  const project = await prisma.lcaProject.findUnique({
    where: { id },
    include: { goalScope: { select: { confirmedAt: true, functionalUnitDescription: true } } },
  });
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <Link href="/lca" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        All studies
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{project.name}</h1>
          <Badge tone="neutral">{project.status.replace(/_/g, " ").toLowerCase()}</Badge>
          {!project.goalScope?.confirmedAt && <Badge tone="warning">Goal &amp; scope unconfirmed</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {project.productName}
          {project.goalScope?.functionalUnitDescription
            ? ` · functional unit: ${project.goalScope.functionalUnitDescription}`
            : " · functional unit not yet defined"}
        </p>
      </div>

      <ProjectNav projectId={id} />

      {children}
    </div>
  );
}
