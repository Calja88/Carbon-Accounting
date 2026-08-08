import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileScan } from "lucide-react";
import { getAiAvailability, resolveAiActor } from "@/lib/ai";
import { isSiteInScope } from "@/lib/ai/authorization";
import { prisma } from "@/lib/prisma";
import { explainCalculation } from "@/lib/explain-calculation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OriginBadge } from "@/components/ai/ai-disclosure";
import { ExplainPanel } from "./explain-panel";

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={mono ? "text-sm tabular-nums text-slate-900" : "text-sm font-medium text-slate-900"}>
        {value ?? <span className="italic text-slate-400">not recorded</span>}
      </dd>
    </div>
  );
}

/**
 * "How was this calculated?"
 *
 * Everything on this page comes from the stored calculation and the records
 * around it. The AI panel at the bottom can restate it in plainer language;
 * it cannot change a figure, because it is handed the finished numbers rather
 * than the inputs.
 */
export default async function CalculationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const owner = await prisma.calculation.findUnique({
    where: { id },
    select: { activityEntry: { select: { siteId: true } } },
  });
  if (!owner || !isSiteInScope(actor, owner.activityEntry.siteId)) notFound();

  const [explanation, availability] = await Promise.all([explainCalculation(id), getAiAvailability()]);
  if (!explanation) notFound();

  const e = explanation;

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/reports" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-3.5 w-3.5" />
        Reports
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">How this figure was calculated</h1>
        <p className="mt-1 text-sm text-slate-500">
          {e.activity.dataPointName} at {e.activity.siteName} ({e.activity.entityName}), {e.activity.periodLabel}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone="info">{e.scope.replace("_", " ")}</Badge>
          <Badge tone="neutral">{e.basis.replace(/_/g, " ").toLowerCase()}</Badge>
          {e.scope3Category && <Badge tone="neutral">{e.scope3Category}</Badge>}
          <OriginBadge origin="CALCULATED" />
          <OriginBadge
            origin={
              e.activity.dataOrigin === "AI_EXTRACTED"
                ? "AI_EXTRACTED"
                : e.activity.dataOrigin === "IMPORTED"
                  ? "IMPORTED"
                  : e.activity.dataOrigin === "DERIVED"
                    ? "DERIVED"
                    : "USER_ENTERED"
            }
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>The result</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tabular-nums text-slate-900">{e.result.kgCo2e} kgCO2e</div>
          <div className="text-sm text-slate-500">{e.result.tonnesCo2e} tonnes CO2e</div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-800">{e.result.equation}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity data</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Data point" value={`${e.activity.dataPointCode} — ${e.activity.dataPointName}`} />
            <Row label="Site" value={`${e.activity.siteName} (${e.activity.entityName})`} />
            <Row label="Period" value={e.activity.periodLabel} />
            <Row label="Type selected" value={e.activity.optionLabel} />
            <Row label="Entered value" value={`${e.activity.rawValue} ${e.activity.rawUnit}`} mono />
            {e.activity.unitConversionApplied && (
              <Row label="Converted for calculation" value={`${e.activity.canonicalValue} ${e.activity.canonicalUnit}`} mono />
            )}
            <Row label="Supplier named" value={e.activity.supplierName} />
            <Row label="Entered by" value={`${e.activity.enteredBy} on ${e.activity.enteredAt.toLocaleString("en-GB")}`} />
            <Row label="Notes" value={e.activity.notes} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Emission factor and its source</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Factor value" value={`${e.factor.value} kgCO2e per ${e.factor.unit}`} mono />
            <Row label="Factor name" value={`${e.factor.category}${e.factor.subtypeKey ? ` / ${e.factor.subtypeKey}` : ""}`} />
            <Row label="Source organisation" value={e.factor.publisher} />
            <Row label="Dataset" value={e.factor.source} />
            <Row label="Source type" value={e.factor.sourceType} />
            <Row label="Vintage / year" value={e.factor.vintage} />
            <Row label="Applicable geography" value={e.factor.region} />
            <Row label="Factor ID" value={e.factor.id} mono />
            <Row label="Imported" value={e.factor.importedAt ? e.factor.importedAt.toLocaleDateString("en-GB") : null} />
            <Row label="Reference" value={e.factor.sourceUrl} />
            <Row label="Factor notes" value={e.factor.factorNotes} />
          </dl>
          {e.factor.isPlaceholder && (
            <p className="mt-3 rounded-lg bg-amber-50/60 p-3 text-sm text-amber-900">
              This factor comes from a placeholder set that has not been verified against a published source.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculation record</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Data quality tier" value={e.result.dataQualityTier} />
            <Row label="Calculation engine" value={e.result.engineVersion} />
            <Row label="Calculated at" value={e.result.calculatedAt.toLocaleString("en-GB")} />
            <Row label="Attributed to" value={e.result.calculatedBy} />
            {e.derivedFrom && <Row label="Derived from" value={e.derivedFrom.description} />}
          </dl>
          {e.derivedFrom && (
            <Link
              href={`/calculations/${e.derivedFrom.calculationId}`}
              className="mt-3 inline-block text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              See the calculation this was derived from →
            </Link>
          )}
        </CardContent>
      </Card>

      {e.evidence.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {e.evidence.map((doc) => (
              <Link
                key={doc.documentId}
                href={`/documents/${doc.documentId}`}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <FileScan className="h-4 w-4 text-slate-400" />
                {doc.filename}
                <span className="text-xs text-slate-400">
                  uploaded {new Date(doc.uploadedAt).toLocaleDateString("en-GB")}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {e.caveats.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle>Caveats recorded by the platform</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
              {e.caveats.map((caveat, i) => (
                <li key={i}>{caveat}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ask AI about this result</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            AI can restate everything above in plainer language. It is given the finished figures and told to quote them
            exactly — it never recalculates, converts or re-rounds anything, and the record above is the source of truth
            either way.
          </p>
          <ExplainPanel calculationId={e.calculationId} aiAvailable={availability.available} />
        </CardContent>
      </Card>
    </div>
  );
}
