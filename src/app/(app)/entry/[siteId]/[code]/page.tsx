import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { defaultPeriodInputValue } from "@/lib/period";
import { EntryForm } from "./entry-form";
import { SurveyForm } from "./survey-form";

export default async function EntryFormPage({ params }: { params: Promise<{ siteId: string; code: string }> }) {
  const { siteId, code } = await params;

  const [site, dataPoint] = await Promise.all([
    prisma.site.findUnique({ where: { id: siteId } }),
    prisma.activityDataPoint.findUnique({
      where: { code },
      include: { factorOptions: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);

  if (!site || !dataPoint || (dataPoint.formType !== "QUANTITY" && dataPoint.formType !== "SURVEY")) notFound();

  return (
    <div>
      <Link href={`/entry/${siteId}`} className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        {site.name}
      </Link>
      <div className="mt-4">
        {dataPoint.formType === "SURVEY" ? (
          <SurveyForm
            site={{ id: site.id, name: site.name }}
            dataPoint={{
              code: dataPoint.code,
              promptTemplate: dataPoint.promptTemplate,
              helpText: dataPoint.helpText,
              frequency: dataPoint.frequency,
              factorOptions: dataPoint.factorOptions.map((o) => ({ id: o.id, label: o.label })),
            }}
            initialPeriodValue={defaultPeriodInputValue(dataPoint.frequency)}
          />
        ) : (
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
              factorOptions: dataPoint.factorOptions.map((o) => ({ id: o.id, label: o.label, unit: o.unit })),
            }}
            initialPeriodValue={defaultPeriodInputValue(dataPoint.frequency)}
          />
        )}
      </div>
    </div>
  );
}
