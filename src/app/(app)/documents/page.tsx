import Link from "next/link";
import { redirect } from "next/navigation";
import { FileScan, Trash2 } from "lucide-react";
import { DocumentStatus, SourceDocumentKind } from "@prisma/client";
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
import { DataTable, Td } from "@/components/ui/data-table";
import { RecordList } from "@/components/ui/record-list";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { AiUnavailableNotice } from "@/components/ai/ai-disclosure";
import { UploadForm } from "./upload-form";
import { deleteDocumentAction } from "./actions";

interface SearchParams {
  status?: string;
  kind?: string;
  siteId?: string;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await resolveAiActor();
  if (!actor) redirect("/login");

  const sp = await searchParams;
  const statusFilter = sp.status && sp.status in DOCUMENT_STATUS_LABELS ? (sp.status as DocumentStatus) : undefined;
  const kindFilter = sp.kind && sp.kind in DOCUMENT_KIND_LABELS ? (sp.kind as SourceDocumentKind) : undefined;

  const [documents, sites, availability, config] = await Promise.all([
    listDocuments(actor.siteIds, 50, { status: statusFilter, kind: kindFilter, siteId: sp.siteId || undefined }),
    prisma.site.findMany({
      where: { isActive: true, id: { in: actor.siteIds } },
      include: { entity: true },
      orderBy: [{ entity: { name: "asc" } }, { name: "asc" }],
    }),
    getAiAvailability(),
    getAiConfig(),
  ]);

  const kinds = Object.values(SourceDocumentKind).map((k) => ({ value: k, label: DOCUMENT_KIND_LABELS[k] }));
  const statuses = Object.values(DocumentStatus).map((s) => ({ value: s, label: DOCUMENT_STATUS_LABELS[s] }));
  const hasActiveFilters = Boolean(sp.status || sp.kind || sp.siteId);

  return (
    <div className="space-y-6">
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

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Uploaded documents</h2>

        <FilterBar action="/documents" hasActiveFilters={hasActiveFilters} clearHref="/documents">
          <div>
            <Label htmlFor="siteId">Site</Label>
            <Select id="siteId" name="siteId" defaultValue={sp.siteId ?? ""} className="mt-1">
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.entity.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="kind">Type</Label>
            <Select id="kind" name="kind" defaultValue={sp.kind ?? ""} className="mt-1">
              <option value="">All types</option>
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={sp.status ?? ""} className="mt-1">
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>

        <RecordList
          state={documents.length === 0 ? "empty" : "ready"}
          emptyTitle={hasActiveFilters ? "No documents match these filters" : "Nothing uploaded yet"}
          emptyDescription={hasActiveFilters ? "Try widening the site, type or status filters above." : "The first document you add will appear here."}
        >
          <div className="rounded-lg border border-slate-200 bg-white">
            <DataTable
              caption="Uploaded evidence documents"
              headers={[
                "Document",
                "Type",
                "Site",
                "Status",
                { label: "Extractions", align: "right" },
                { label: "Entries", align: "right" },
                { label: "", align: "right" },
              ]}
            >
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/documents/${doc.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-brand-700">
                      <FileScan className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{doc.filename}</span>
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {(doc.byteSize / 1024).toFixed(0)} KB · uploaded {new Date(doc.uploadedAt).toLocaleDateString("en-GB")} by {doc.uploadedBy.name}
                    </div>
                  </Td>
                  <Td>{DOCUMENT_KIND_LABELS[doc.kind]}</Td>
                  <Td>{doc.site?.name ?? <span className="text-slate-400">Not site-specific</span>}</Td>
                  <Td>
                    <StatusBadge domain="document" status={doc.status} />
                  </Td>
                  <Td align="right">{doc._count.extractions}</Td>
                  <Td align="right">{doc._count.activityEntries}</Td>
                  <Td align="right">
                    <DestructiveActionDialog
                      triggerLabel={`Delete ${doc.filename}`}
                      triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                      title={`Delete "${doc.filename}"?`}
                      description="This permanently removes the file and its extraction history. Refused if any activity entry was created from it."
                      dependents={[{ label: "Activity entries created from this document", count: doc._count.activityEntries }]}
                      confirmLabel="Delete"
                      formAction={deleteDocumentAction}
                    >
                      <input type="hidden" name="documentId" value={doc.id} />
                    </DestructiveActionDialog>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </div>
        </RecordList>
      </div>
    </div>
  );
}
