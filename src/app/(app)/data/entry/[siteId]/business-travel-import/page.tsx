import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { ExpenseInImportForm } from "./import-form";

export default async function BusinessTravelImportPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) notFound();

  return (
    <div className="max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "Enter data", href: "/data/entry" },
          { label: site.name, href: `/data/entry/${siteId}` },
          { label: "Import business travel" },
        ]}
      />

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">Import business travel from ExpenseIn</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bulk-load rail, flight and hotel travel for {site.name} straight from an ExpenseIn export, instead of entering
        each month by hand. Imported entries go through the same calculation, plausibility check and audit trail as
        anything entered manually.
      </p>

      <div className="mt-6">
        <ExpenseInImportForm site={{ id: site.id, name: site.name }} />
      </div>
    </div>
  );
}
