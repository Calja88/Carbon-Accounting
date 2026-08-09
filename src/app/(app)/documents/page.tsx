import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, FileScan } from "lucide-react";
import { SourceDocumentKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAiAvailability, resolveAiActor } from "@/lib/ai";
import { getAiConfig } from "@/lib/ai/config";
import {
  ACCEPTED_DOCUMENT_EXTENSIONS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
  listDocuments,
} from "@/lib/documents-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiUnavailableNotice } from "@/components/ai/ai-disclosure";
import { UploadForm } from "./upload-form";

const STATUS_TONES: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  UPLOADED: "neutral",
  EXTRACTED: "info",
  EXTRACTION_FAILED: "danger",
  PARTIALLY_ACCEPTED: "warning",
  ACCEPTED: "success",
  REJECTED: "neutral",
};

export default async function DocumentsPage() {
  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const [documents, sites, availability, config] = await Promise.all([
    listDocuments(actor.siteIds),
    prisma.site.findMany({
      where: { isActive: true, id: { in: actor.siteIds } },
      include: { entity: true },
      orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
    }),
    getAiAvailability(),
    getAiConfig(),
  ]);

  const kinds = Object.values(SourceDocumentKind).map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Documents</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Upload invoices, Waste Transfer Notes, meter statements and other evidence. AI reads what a document says
          into a review screen; nothing becomes accounting data until you accept it, and the document stays linked to
          whatever it produced as audit evidence.
        </p>
      </div>

      {!availability.available && (
        <AiUnavailableNotice
          message={availability.message ?? "AI extraction is unavailable."}
          action="You can still upload documents here as evidence and attach them to entries you make by hand."
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <UploadForm
            sites={sites.map((s) => ({ id: s.id, name: s.name, entityName: s.entity.name }))}
            kinds={kinds}
            acceptedExtensions={ACCEPTED_DOCUMENT_EXTENSIONS}
            maxBytes={config.maxDocumentBytes}
          />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-900">Uploaded documents</h2>
        {documents.length === 0 && (
          <p className="text-sm text-slate-500">Nothing uploaded yet. The first document you add will appear here.</p>
        )}
        {documents.map((doc) => (
          <Link key={doc.id} href={`/documents/${doc.id}`}>
            <Card className="transition-all hover:-translate-y-0.5 hover:shadow-md">
              <CardContent className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <FileScan className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-slate-900">{doc.filename}</span>
                      <Badge tone={STATUS_TONES[doc.status] ?? "neutral"}>{DOCUMENT_STATUS_LABELS[doc.status]}</Badge>
                    </div>
                    <div className="text-sm text-slate-500">
                      {DOCUMENT_KIND_LABELS[doc.kind]}
                      {doc.site ? ` · ${doc.site.name}` : ""} · {(doc.byteSize / 1024).toFixed(0)} KB ·{" "}
                      {doc._count.extractions} extraction{doc._count.extractions === 1 ? "" : "s"} ·{" "}
                      {doc._count.activityEntries} entr{doc._count.activityEntries === 1 ? "y" : "ies"} created
                    </div>
                    <div className="text-xs text-slate-400">
                      Uploaded {new Date(doc.uploadedAt).toLocaleDateString("en-GB")} by {doc.uploadedBy.name}
                    </div>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand-700">
                  Review
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
