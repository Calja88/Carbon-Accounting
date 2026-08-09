import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { resolveAiActor, getAiAvailability } from "@/lib/ai";
import { AiAuthorizationError, assertDocumentInScope } from "@/lib/ai/authorization";
import { getAiConfig } from "@/lib/ai/config";
import { DOCUMENT_KIND_LABELS, getDocumentWithExtractions } from "@/lib/documents-service";
import { buildProposals } from "@/lib/document-proposals";
import type { DocumentExtractionResult } from "@/lib/ai/schemas";
import { documentExtractionResultSchema } from "@/lib/ai/schemas";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewScreen } from "./review-screen";

export default async function DocumentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ duplicateOf?: string }>;
}) {
  const { id } = await params;
  const { duplicateOf } = await searchParams;

  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  try {
    await assertDocumentInScope(actor, id);
  } catch (err) {
    if (err instanceof AiAuthorizationError) notFound();
    throw err;
  }

  const [document, sites, availability, config, duplicateDocument] = await Promise.all([
    getDocumentWithExtractions(id),
    prisma.site.findMany({
      where: { isActive: true, id: { in: actor.siteIds } },
      include: { entity: true },
      orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
    }),
    getAiAvailability(),
    getAiConfig(),
    duplicateOf ? prisma.sourceDocument.findUnique({ where: { id: duplicateOf }, select: { id: true, filename: true, uploadedAt: true } }) : null,
  ]);

  if (!document) notFound();

  const latest = document.extractions[0] ?? null;

  // A stored payload is re-validated on read, not trusted because it was
  // valid when written: the schema can move on between deployments, and a
  // stale shape must degrade to "re-run extraction", never to a broken page.
  const parsed = latest?.payload ? documentExtractionResultSchema.safeParse(latest.payload) : null;
  const result: DocumentExtractionResult | null = parsed?.success ? parsed.data : null;
  const proposalSet = result ? buildProposals(result) : null;

  const dataPointCodes = Array.from(new Set(proposalSet?.proposals.map((p) => p.dataPointCode) ?? []));
  const dataPoints = dataPointCodes.length
    ? await prisma.activityDataPoint.findMany({
        where: { code: { in: dataPointCodes } },
        include: { factorOptions: { orderBy: { sortOrder: "asc" } } },
      })
    : [];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Documents", href: "/documents" }, { label: document.filename }]} />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{document.filename}</h1>
          <StatusBadge domain="document" status={document.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {DOCUMENT_KIND_LABELS[document.kind]}
          {document.site ? ` · ${document.site.name} (${document.site.entity.name})` : " · not site-specific"} ·{" "}
          uploaded {new Date(document.uploadedAt).toLocaleDateString("en-GB")} by {document.uploadedBy.name}
        </p>
      </div>

      <ReviewScreen
        duplicateOf={
          duplicateDocument
            ? { id: duplicateDocument.id, filename: duplicateDocument.filename, uploadedAt: duplicateDocument.uploadedAt.toISOString() }
            : null
        }
        document={{
          id: document.id,
          filename: document.filename,
          mimeType: document.mimeType,
          status: document.status,
          siteId: document.siteId,
          notes: document.notes,
        }}
        extraction={
          latest
            ? {
                id: latest.id,
                status: latest.status,
                modelUsed: latest.modelUsed,
                confidence: latest.confidence === null ? null : Number(latest.confidence),
                warnings: latest.warnings,
                missingFields: latest.missingFields,
                errorMessage: latest.errorMessage,
                createdAt: latest.createdAt.toISOString(),
                createdBy: latest.createdBy.name,
                reviewedBy: latest.reviewedBy?.name ?? null,
                reviewedAt: latest.reviewedAt?.toISOString() ?? null,
                payloadValid: parsed ? parsed.success : false,
              }
            : null
        }
        result={result}
        proposalSet={proposalSet}
        dataPoints={dataPoints.map((dp) => ({
          code: dp.code,
          dataPointName: dp.dataPointName,
          scope: dp.scope,
          unitOptions: dp.unitOptions,
          frequency: dp.frequency,
          factorOptions: dp.factorOptions.map((o) => ({ id: o.id, label: o.label, subtypeKey: o.subtypeKey, unit: o.unit })),
        }))}
        sites={sites.map((s) => ({ id: s.id, name: s.name, entityName: s.entity.name }))}
        existingEntries={document.activityEntries.map((e) => ({
          id: e.id,
          label: e.activityDataPoint.dataPointName,
          code: e.activityDataPoint.code,
          site: e.site.name,
          value: `${Number(e.rawValue)} ${e.rawUnit}`,
          period: new Date(e.periodStart).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
          status: e.status,
          dataOrigin: e.dataOrigin,
        }))}
        aiAvailable={availability.available}
        aiUnavailableMessage={availability.message}
        autoAcceptEnabled={config.autoAcceptExtraction}
        minConfidence={config.minConfidence}
      />
    </div>
  );
}
