import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Leaf, Package, Sparkles } from "lucide-react";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { hasPermission } from "@/lib/rbac/authorize";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CARDS = [
  {
    id: "ems",
    title: "Environmental management",
    description: "ISO 14001 programme: aspects, controls, audits, objectives, and compliance.",
    href: "/ems",
    icon: Leaf,
    permission: "ems.view" as const,
  },
  {
    id: "lca",
    title: "Product footprint",
    description: "Product LCA assessments, suppliers, and lifecycle carbon results.",
    href: "/assessments",
    icon: Package,
    permission: "lca.view" as const,
  },
  {
    id: "ai",
    title: "AI assistance",
    description: "Configure AI provider settings and review the AI suggestion audit trail.",
    href: "/admin/ai",
    icon: Sparkles,
    permission: "ai.settings.manage" as const,
  },
];

export default async function AdvancedPage() {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  const cards = CARDS.filter((card) => hasPermission(context, card.permission));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Advanced</h1>
        <p className="mt-1 text-sm text-slate-500">
          Environmental management, product footprint, and AI tooling — beyond day-to-day carbon activity data.
        </p>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing here is available for your account yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ id, title, description, href, icon: Icon }) => (
            <Link key={id} href={href}>
              <Card className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardHeader>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Icon className="h-4 w-4" />
                  </span>
                  <CardTitle className="mt-2">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500">{description}</p>
                  <span className="mt-3 flex items-center gap-1 text-sm font-medium text-blue-700">
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
