import { redirect } from "next/navigation";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  listEvidenceObjects,
  hasClassificationClearance,
  activeEvidenceStorageProviderName,
  formatBytes,
} from "@/lib/documents/evidence-service";
import { EvidenceSearchForm } from "./evidence-forms";

export const dynamic = "force-dynamic";

/** "database" today; a future SharePoint provider (SP01+) registers under its own name — this label map is the only place that needs updating when it does. */
const PROVIDER_LABELS: Record<string, string> = {
  database: "Database (built-in)",
};

const SCAN_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  PENDING: "neutral",
  CLEAN: "success",
  SKIPPED: "neutral",
  INFECTED: "danger",
  FAILED: "warning",
};

export default async function EvidenceHubPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  let context;
  try {
    context = await requireOrganisationContext();
    requirePermission(context, "ems.view");
  } catch (error) {
    if (error instanceof OrganisationAccessError || error instanceof PermissionDeniedError) redirect("/");
    throw error;
  }

  const { q } = await searchParams;
  const canManage = hasPermission(context, "ems.controlled_document.manage");
  const providerName = activeEvidenceStorageProviderName();

  const evidence = await listEvidenceObjects(context, { search: q });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Evidence hub</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Every shared evidence object uploaded across the EMS (task T22) — controlled-document content, monitoring
          readings, incident evidence and more, in one searchable place. All content shown is synthetic.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-1 p-4 text-sm">
          <p className="font-medium text-slate-700">
            Storage connection: {PROVIDER_LABELS[providerName] ?? providerName}
          </p>
          {providerName === "database" ? (
            <p className="text-slate-500">
              Evidence bytes are stored in the application database. No SharePoint site is connected for this
              organisation yet — once the SharePoint integration (SP01+) is available, an administrator can connect
              it and evidence uploaded after that point will show its SharePoint status here without any change to
              this page.
            </p>
          ) : (
            <p className="text-slate-500">External file health is shown per item below.</p>
          )}
        </CardContent>
      </Card>

      <EvidenceSearchForm initialQuery={q ?? ""} />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">Filename</th>
              <th scope="col" className="px-4 py-2">Classification</th>
              <th scope="col" className="px-4 py-2">Retention</th>
              <th scope="col" className="px-4 py-2">Scan status</th>
              <th scope="col" className="px-4 py-2">Uploaded</th>
              <th scope="col" className="px-4 py-2">Download</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {evidence.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No evidence objects match this organisation{q ? " and search" : ""} yet.
                </td>
              </tr>
            )}
            {evidence.map((item) => {
              const cleared = hasClassificationClearance(context, item.classification);
              const tombstoned = Boolean(item.retentionTombstonedAt);
              return (
                <tr id={`evidence-${item.id}`} key={item.id} className="scroll-mt-24 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-900">{item.filename}</span>
                    <span className="ml-2 text-xs text-slate-400">{formatBytes(item.byteSize)}</span>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={item.classification === "RESTRICTED" ? "warning" : "neutral"}>{item.classification}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {item.retentionCategory}
                    {item.legalHold && <Badge tone="danger" className="ml-1">LEGAL HOLD</Badge>}
                    {tombstoned && <Badge tone="warning" className="ml-1">RETENTION TOMBSTONE</Badge>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={SCAN_TONE[item.malwareScanStatus] ?? "neutral"}>{item.malwareScanStatus}</Badge>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{item.uploadedAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2">
                    {tombstoned || item.malwareScanStatus === "INFECTED" || !cleared ? (
                      <span className="text-xs text-slate-400">
                        {tombstoned ? "Bytes removed under retention" : !cleared ? "Not authorised" : "Blocked"}
                      </span>
                    ) : (
                      <a
                        href={`/api/ems/evidence/${item.id}`}
                        className="text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
                      >
                        Download
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canManage && (
        <p className="text-xs text-slate-400">
          Restricted-classification evidence is hidden from download unless you hold document-management permission.
        </p>
      )}
    </div>
  );
}
