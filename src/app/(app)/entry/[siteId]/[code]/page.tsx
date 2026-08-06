import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { defaultPeriodInputValue } from "@/lib/period";
import { EntryForm } from "./entry-form";

export default async function EntryFormPage({ params }: { params: Promise<{ siteId: string; code: string }> }) {
  const { siteId, code } = await params;

  const [site, dataPoint] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.activityDataPoint.findUnique({
      where: { code },
      include: { factorOptions: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);

  if (!site || !dataPoint || dataPoint.formType !== "QUANTITY") notFound();

  return (
    <div>
      <Link href={`/entry/${siteId}`} className="text-sm text-emerald-700 hover:underline">
        ← {site.name}
      </Link>
      <div className="mt-4">
        <EntryForm
          site={{ id: site.id, name: site.name }}
          dataPoint={{
            code: dataPoint.code,
            dataPointName: dataPoint.dataPointName,
            promptTemplate: dataPoint.promptTemplate,
            helpText: dataPoint.helpText,
            sourceSystemHint: dataPoint.sourceSystemHint,
            unitOptions: dataPoint.unitOptions,
            frequency: dataPoint.frequency,
            factorOptions: dataPoint.factorOptions.map((o) => ({ id: o.id, label: o.label })),
          }}
          initialPeriodValue={defaultPeriodInputValue(dataPoint.frequency)}
        />
      </div>
    </div>
  );
}
