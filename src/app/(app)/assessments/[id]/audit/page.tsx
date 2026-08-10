import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { countAuditEvents, listAuditEvents } from "@/lib/lca/audit-service";
import { getLcaContext } from "@/lib/lca/permissions";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { Badge } from "@/components/ui/badge";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";

export const dynamic = "force-dynamic";

const ENTITY_LABELS: Record<string, string> = {
  assessment: "Assessment",
  product: "Product",
  product_version: "Product version",
  process: "Process",
  process_output: "Co-product",
  inventory_item: "Inventory line",
  transport_leg: "Transport leg",
  end_of_life_route: "End-of-life route",
  bom_import: "Inventory import",
  factor_assignment: "Factor assignment",
  methodology: "Methodology",
  allocation: "Allocation",
  assumption: "Assumption",
  exclusion: "Exclusion",
  evidence: "Evidence",
  calculation_run: "Calculation run",
  status: "Status",
  approval: "Approval",
  version: "Version",
  scenario: "Scenario",
  report_export: "Report export",
  verification: "Verification",
  supplier: "Supplier",
  supplier_pcf: "Supplier PCF",
  corporate_link: "Corporate citation",
};

const ACTION_TONES: Record<string, "success" | "info" | "warning" | "danger" | "neutral"> = {
  created: "success",
  updated: "info",
  deleted: "danger",
  status_changed: "warning",
  calculated: "info",
  approved: "success",
  issued: "success",
  superseded: "warning",
  imported: "info",
  exported: "neutral",
  copied: "neutral",
  supplier_pcf_applied: "info",
};

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getLcaContext();
  if (!context) notFound();
  try {
    await requireAssessmentInScope(context, id);
  } catch (err) {
    if (err instanceof TenantOwnershipError || err instanceof PermissionDeniedError) notFound();
    throw err;
  }

  const [assessment, events, total] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id } }),
    listAuditEvents(id, 500),
    countAuditEvents(id),
  ]);
  if (!assessment) notFound();

  return (
    <div className="space-y-6">
      <PageHeading
        title="Audit trail"
        description="Every material change to this assessment, in the order it happened. Append-only: a correction is another event, never a rewrite."
      />

      <Notice tone="info" title="What is recorded">
        Assessment creation, inventory and model changes, factor assignments, methodology and allocation changes,
        exclusions and assumptions, approvals, calculation runs, status changes, issued versions, scenarios, report
        exports and verification records. Each event names who made the change and, where a figure moved, what it was
        before and after.
      </Notice>

      <SectionCard
        title="Events"
        description={total > events.length ? `Showing the most recent ${events.length} of ${total}.` : `${total} event(s).`}
      >
        {events.length === 0 ? (
          <EmptyState title="No events yet" description="The audit trail fills as the assessment is built." />
        ) : (
          <DataTable headers={["When", "What", "Action", "Summary", "Who"]}>
            {events.map((event) => (
              <tr key={event.id}>
                <Td className="whitespace-nowrap text-xs">
                  {event.occurredAt.toISOString().slice(0, 10)}
                  <span className="block text-slate-500">{event.occurredAt.toISOString().slice(11, 16)}</span>
                </Td>
                <Td className="text-xs">{ENTITY_LABELS[event.entityType] ?? event.entityType}</Td>
                <Td>
                  <Badge tone={ACTION_TONES[event.action] ?? "neutral"}>{event.action.replace(/_/g, " ")}</Badge>
                </Td>
                <Td className="text-sm">
                  {event.summary}
                  {(event.before || event.after) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                        Before and after
                      </summary>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        {event.before !== null && (
                          <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                            {JSON.stringify(event.before, null, 2)}
                          </pre>
                        )}
                        {event.after !== null && (
                          <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
                            {JSON.stringify(event.after, null, 2)}
                          </pre>
                        )}
                      </div>
                    </details>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-xs">{event.actor?.name ?? <span className="text-slate-400">System</span>}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>
    </div>
  );
}
