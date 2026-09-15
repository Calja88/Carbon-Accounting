import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, SetupState } from "@/components/ui/primitives";
import { ENTITY_LOGOS } from "@/lib/entity-logos";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { accessibleSiteFilter, accessibleEntityFilter, toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";

export default async function EntrySiteListPage() {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  const ctx = toTenantRepositoryContext(context);
  const entities = await prisma.entity.findMany({
    where: tenantWhere(ctx, accessibleEntityFilter(context)),
    include: { sites: { where: { isActive: true, ...accessibleSiteFilter(context) }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  const hasSites = entities.some((entity) => entity.sites.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Activity data"
        title="Data entry"
        description="Pick a site to enter or review its activity data for a period. Each entry is matched to an emission factor when it is saved."
      />

      {!hasSites && (
        <SetupState
          title="No sites available to you yet"
          detail="Activity data is entered per site. Once a site is added to your organisation and you have access to it, it appears here."
          actions={[{ label: "Open admin", href: "/admin" }]}
        />
      )}

      <div className="space-y-6">
        {entities.map((entity) => (
          <div key={entity.id}>
            <div className="mb-2 flex items-center gap-2">
              {ENTITY_LOGOS[entity.name] ? (
                // eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image adds no value here
                <img src={ENTITY_LOGOS[entity.name]} alt={entity.name} className="h-4 w-auto" />
              ) : null}
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{entity.name}</h2>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entity.sites.map((site) => (
                <Link key={site.id} href={`/entry/${site.id}`}>
                  <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <CardContent className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <MapPin className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="font-medium text-slate-900">{site.name}</div>
                        {site.address && <div className="text-sm text-slate-500">{site.address}</div>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
