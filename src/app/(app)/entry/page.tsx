import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";

export default async function EntrySiteListPage() {
  const entities = await prisma.entity.findMany({
    include: { sites: { where: { isActive: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Data entry</h1>
      <p className="mt-1 text-sm text-slate-500">Pick a site to enter its activity data.</p>

      <div className="mt-6 space-y-6">
        {entities.map((entity) => (
          <div key={entity.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{entity.name}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entity.sites.map((site) => (
                <Link key={site.id} href={`/entry/${site.id}`}>
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent>
                      <div className="font-medium text-slate-900">{site.name}</div>
                      {site.address && <div className="text-sm text-slate-500">{site.address}</div>}
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
