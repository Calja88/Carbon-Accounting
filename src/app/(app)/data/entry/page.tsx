import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";
import { ENTITY_LOGOS } from "@/lib/entity-logos";

export default async function EntrySiteListPage() {
  const entities = await prisma.entity.findMany({
    include: { sites: { where: { isActive: true }, orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  const sites = entities.flatMap((entity) => entity.sites.map((site) => ({ site, entity })));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Enter data</h1>
        <p className="mt-1 text-sm text-slate-500">Pick a site to enter or review its activity data.</p>
      </div>

      <RecordList
        state={sites.length === 0 ? "empty" : "ready"}
        emptyTitle="No active sites"
        emptyDescription="Sites are managed outside this platform — see the README for the current site register."
      >
        <div className="rounded-lg border border-slate-200 bg-white">
          <DataTable
            caption="Sites you can enter activity data for"
            headers={["Site", "Operating unit", "Address", { label: "", align: "right" }]}
          >
            {sites.map(({ site, entity }) => (
              <tr key={site.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/data/entry/${site.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {site.name}
                  </Link>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    {ENTITY_LOGOS[entity.name] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image adds no value here
                      <img src={ENTITY_LOGOS[entity.name]} alt="" className="h-3.5 w-auto" />
                    ) : null}
                    {entity.name}
                  </span>
                </Td>
                <Td>{site.address ?? <span className="text-slate-400">—</span>}</Td>
                <Td align="right">
                  <Link href={`/data/entry/${site.id}`} className="text-sm font-medium text-brand-700 hover:text-brand-800">
                    Open →
                  </Link>
                </Td>
              </tr>
            ))}
          </DataTable>
        </div>
      </RecordList>
    </div>
  );
}
