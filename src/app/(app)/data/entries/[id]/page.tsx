import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getActivityEntryDetail } from "@/lib/entries-explorer-service";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProvenanceStrip } from "@/components/ui/provenance-strip";
import { OriginBadge } from "@/components/ai/ai-disclosure";

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
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
 * Record detail for an activity entry that has no Calculation yet (still
 * AWAITING_FACTOR). An entry that *does* have a calculation is opened
 * through the existing, more detailed /calculations/[id] explainability
 * page instead (see the explorer's row-link logic) — this page exists
 * specifically so "awaiting factor" is never a dead end or a broken link
 * to a calculation that doesn't exist.
 */
export default async function ActivityEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const entry = await getActivityEntryDetail(id);
  if (!entry) notFound();

  // An entry with a calculation belongs at the richer explainability page.
  if (entry.calculations.length > 0) redirect(`/calculations/${entry.calculations[0].id}`);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        items={[{ label: "Data", href: "/data/entry" }, { label: "Historical data", href: "/data/entries" }, { label: entry.activityDataPoint.dataPointName }]}
      />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{entry.activityDataPoint.dataPointName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {entry.site.name} ({entry.site.entity.name}) ·{" "}
          {entry.periodStart.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge domain="activityEntry" status={entry.status} />
          <OriginBadge origin={entry.dataOrigin} />
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent>
          <p className="text-sm font-medium text-amber-900">Awaiting emission factor</p>
          <p className="mt-1 text-sm text-amber-800">
            This activity data is saved and complete, but no emission factor has been imported for this category yet
            — no calculation exists for it. A figure will appear automatically, and this page will redirect to it,
            once a matching factor is imported.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity data</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Data point" value={`${entry.activityDataPoint.code} — ${entry.activityDataPoint.dataPointName}`} />
            <Row label="Site" value={`${entry.site.name} (${entry.site.entity.name})`} />
            <Row
              label="Period"
              value={`${entry.periodStart.toLocaleDateString("en-GB", { timeZone: "UTC" })} – ${entry.periodEnd.toLocaleDateString("en-GB", { timeZone: "UTC" })}`}
            />
            <Row label="Type selected" value={entry.factorOption?.label} />
            <Row label="Entered value" value={`${Number(entry.rawValue)} ${entry.rawUnit}`} mono />
            <Row label="Canonical value" value={`${Number(entry.canonicalValue)} ${entry.canonicalUnit}`} mono />
            <Row label="Supplier named" value={entry.supplierName} />
            <Row label="Data quality tier" value={entry.dataQualityTier} />
            <Row label="Entered by" value={`${entry.enteredBy.name} on ${entry.enteredAt.toLocaleString("en-GB")}`} />
            <Row label="Notes" value={entry.notes} />
            {entry.plausibilityFlagged && <Row label="Plausibility flag" value={entry.plausibilityReason} />}
          </dl>
        </CardContent>
      </Card>

      {entry.sourceDocument && (
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
          </CardHeader>
          <CardContent>
            <ProvenanceStrip
              origin={entry.dataOrigin}
              evidence={{ label: entry.sourceDocument.filename, href: `/documents/${entry.sourceDocument.id}` }}
            />
          </CardContent>
        </Card>
      )}

      <Link href="/data/entries" className="text-sm font-medium text-brand-700 hover:text-brand-800">
        ← Back to historical data
      </Link>
    </div>
  );
}
