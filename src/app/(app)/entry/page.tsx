import Link from "next/link";
import { MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { ENTITY_LOGOS } from "@/lib/entity-logos";

export default async function EntrySiteListPage() {
  const entities = await prisma.entity.findMany({
    include: { sites: { where: { isActive: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Data entry</h1>
        <p className="mt-1 text-sm text-slate-500">Pick a site to enter its activity data.</p>
      </div>

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
