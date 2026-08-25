import { redirect } from "next/navigation";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  BookMarked,
  ClipboardCheck,
  Gauge,
  Gavel,
  HeartPulse,
  Leaf,
  MessageSquare,
  Paperclip,
  ScrollText,
  Scale,
  ShieldCheck,
  Siren,
  Sparkles,
  Target,
  Truck,
  UsersRound,
  Workflow,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import {
  EMS_MODULE_CATEGORY_LABELS,
  EMS_MODULES,
  getVisibleEmsModules,
  isAvailable,
  type EmsModuleCategory,
} from "@/lib/ems/navigation/registry";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER: EmsModuleCategory[] = [
  "notifications",
  "foundation",
  "documents",
  "operations",
  "legal",
  "objectives",
  "assurance",
  "people",
  "review",
];

const MODULE_ICONS: Record<string, LucideIcon> = {
  notifications: Bell,
  programme: ScrollText,
  documents: BookMarked,
  evidence: Paperclip,
  processes: Workflow,
  aspects: Leaf,
  controls: ShieldCheck,
  monitoring: Gauge,
  providers: Truck,
  communications: MessageSquare,
  emergency: Siren,
  "legal-provider-health": HeartPulse,
  "legal-applicability": Scale,
  "legal-obligations": Gavel,
  "legal-evaluations": ClipboardCheck,
  "legal-other-requirements": BookMarked,
  objectives: Target,
  actions: ClipboardCheck,
  audits: ShieldCheck,
  incidents: AlertTriangle,
  nonconformities: AlertTriangle,
  "competence-requirements": UsersRound,
  "competence-people": UsersRound,
  "competence-assignments": ClipboardCheck,
  "competence-gaps": AlertTriangle,
  "competence-training": UsersRound,
  "management-review": Sparkles,
};

export default async function EmsHomePage() {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const visible = new Set(getVisibleEmsModules(context).map((m) => m.id));
  const modules = EMS_MODULES.filter((m) => visible.has(m.id));

  const activeProgramme = await prisma.emsProgramme.findFirst({
    where: { organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true, name: true, standardsProfile: true },
  });

  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    modules: modules.filter((m) => m.category === category),
  })).filter((group) => group.modules.length > 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Environmental management system</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every EMS workflow this organisation currently has, in one place. Cards you can&apos;t access because of
          your current role are hidden rather than shown disabled.
        </p>
      </div>

      {activeProgramme ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Active programme: <span className="font-medium text-slate-900">{activeProgramme.name}</span> (
          {activeProgramme.standardsProfile})
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No EMS programme is configured yet for this organisation.{" "}
          <Link href="/ems/programme" className="font-medium underline underline-offset-2">
            Set up the EMS programme, scope and context
          </Link>{" "}
          — the modules below can still be used once relevant records exist.
        </div>
      )}

      {byCategory.map(({ category, modules: categoryModules }) => (
        <section key={category} aria-labelledby={`ems-category-${category}`}>
          <h2 id={`ems-category-${category}`} className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {EMS_MODULE_CATEGORY_LABELS[category]}
          </h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categoryModules.map((mod) => {
              const Icon = MODULE_ICONS[mod.id] ?? Sparkles;
              if (isAvailable(mod)) {
                return (
                  <li key={mod.id}>
                    <Link
                      href={mod.href}
                      className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                    >
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        <Icon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                        {mod.label}
                      </span>
                      <span className="text-sm text-slate-500">{mod.description}</span>
                    </Link>
                  </li>
                );
              }
              return (
                <li key={mod.id}>
                  <div className="flex h-full flex-col gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-slate-400">
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {mod.label}
                    </span>
                    <span className="text-sm">{mod.description}</span>
                    <span className="mt-auto text-xs font-medium uppercase tracking-wide text-slate-400">
                      Planned — {mod.plannedTask}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
