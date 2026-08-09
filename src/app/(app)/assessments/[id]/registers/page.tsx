import { notFound } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listAssumptions, listExclusions } from "@/lib/lca/registers-service";
import { canApproveLca, checkCanEditAssessment, getLcaActor } from "@/lib/lca/permissions";
import { MATERIALITY_LABELS } from "@/lib/lca/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveActionDialog } from "@/components/ui/destructive-action-dialog";
import { DataTable, EmptyState, Notice, PageHeading, SectionCard, Td } from "@/components/lca/ui";
import { AssumptionForm, ExclusionForm } from "./register-forms";
import {
  approveAssumptionAction,
  approveExclusionAction,
  deleteAssumptionAction,
  deleteExclusionAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function RegistersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [assessment, assumptions, exclusions, users, processes, items, actor] = await Promise.all([
    prisma.lcaAssessment.findUnique({ where: { id } }),
    listAssumptions(id),
    listExclusions(id),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.lcaProcess.findMany({ where: { assessmentId: id }, orderBy: [{ sortOrder: "asc" }], select: { id: true, name: true } }),
    prisma.lcaInventoryItem.findMany({ where: { assessmentId: id }, orderBy: [{ sortOrder: "asc" }], select: { id: true, name: true } }),
    getLcaActor(),
  ]);
  if (!assessment) notFound();

  const permission = checkCanEditAssessment(actor, assessment.status);
  const canEdit = permission.ok;
  const canApprove = canApproveLca(actor);

  const excludedInventoryLines = await prisma.lcaInventoryItem.findMany({
    where: { assessmentId: id, isExcluded: true },
    select: { id: true, name: true, exclusionReason: true },
  });

  return (
    <div className="space-y-6">
      <PageHeading
        title="Assumptions and exclusions"
        description="The two registers a reviewer reads before they look at any number: what the model assumed, and what it left out."
      />

      {!canEdit && <Notice tone="info">{permission.reason}</Notice>}

      <SectionCard
        title="Assumptions register"
        description="Every judgement the model rests on, with its rationale, source, materiality and approval. Editing an approved entry withdraws the approval, because a sign-off cannot carry over to wording nobody approved."
        actions={canEdit ? <AssumptionForm assessmentId={id} users={users} processes={processes} items={items} /> : null}
      >
        {assumptions.length === 0 ? (
          <EmptyState
            title="No assumptions recorded"
            description="Most product assessments rest on assumptions worth stating even when the data is good — a mass taken from a drawing rather than a scale, a factor used as a stand-in, a distance estimated from a route."
          />
        ) : (
          <DataTable
            headers={["Assumption", "Category", "Rationale", "Source", "Uncertainty", "Materiality", "Applies to", "Owner", "Approval", ""]}
          >
            {assumptions.map((assumption) => (
              <tr key={assumption.id}>
                <Td className="font-medium text-slate-900">{assumption.assumption}</Td>
                <Td className="text-xs">{assumption.category}</Td>
                <Td className="text-xs">{assumption.rationale}</Td>
                <Td className="text-xs">{assumption.source ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">{assumption.uncertainty ?? <span className="text-slate-400">—</span>}</Td>
                <Td>
                  <Badge tone={assumption.materiality === "HIGH" ? "warning" : assumption.materiality === "MEDIUM" ? "info" : "neutral"}>
                    {MATERIALITY_LABELS[assumption.materiality]}
                  </Badge>
                </Td>
                <Td className="text-xs">
                  {assumption.inventoryItem?.name ?? assumption.process?.name ?? <span className="text-slate-400">Whole assessment</span>}
                </Td>
                <Td className="text-xs">{assumption.owner?.name ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">
                  {assumption.approvedAt ? (
                    <span className="text-emerald-700">
                      {assumption.approvedBy?.name} · {assumption.approvedAt.toISOString().slice(0, 10)}
                    </span>
                  ) : canApprove ? (
                    <form action={approveAssumptionAction}>
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="assumptionId" value={assumption.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                    </form>
                  ) : (
                    <span className="text-amber-700">Awaiting approval</span>
                  )}
                </Td>
                <Td align="right">
                  {canEdit && (
                    <DestructiveActionDialog
                      triggerLabel="Remove assumption"
                      triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                      title="Remove this assumption?"
                      description={assumption.assumption}
                      confirmLabel="Remove"
                      formAction={deleteAssumptionAction}
                    >
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="assumptionId" value={assumption.id} />
                    </DestructiveActionDialog>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard
        title="Exclusions register"
        description="What was left out, why, and roughly how much it would have contributed. Exclusions stay visible to reviewers — they are never hidden once approved."
        actions={canEdit ? <ExclusionForm assessmentId={id} users={users} processes={processes} /> : null}
      >
        {exclusions.length === 0 ? (
          <EmptyState
            title="No exclusions recorded"
            description="If nothing has been left out, this register is correctly empty. If a cut-off rule has been applied, each excluded item belongs here with an estimate of its relevance."
          />
        ) : (
          <DataTable
            headers={["Excluded", "Rationale", "Estimated relevance", { label: "Share", align: "right" }, "Applies to", "Owner", "Approval", ""]}
          >
            {exclusions.map((exclusion) => (
              <tr key={exclusion.id}>
                <Td className="font-medium text-slate-900">{exclusion.excludedItem}</Td>
                <Td className="text-xs">{exclusion.rationale}</Td>
                <Td className="text-xs">{exclusion.estimatedRelevance}</Td>
                <Td align="right">
                  {exclusion.estimatedPercentOfTotal ? `${exclusion.estimatedPercentOfTotal.toString()}%` : "—"}
                </Td>
                <Td className="text-xs">{exclusion.process?.name ?? <span className="text-slate-400">Whole assessment</span>}</Td>
                <Td className="text-xs">{exclusion.owner?.name ?? <span className="text-slate-400">—</span>}</Td>
                <Td className="text-xs">
                  {exclusion.approvedAt ? (
                    <span className="text-emerald-700">
                      {exclusion.approvedBy?.name} · {exclusion.approvedAt.toISOString().slice(0, 10)}
                    </span>
                  ) : canApprove ? (
                    <form action={approveExclusionAction}>
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="exclusionId" value={exclusion.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </Button>
                    </form>
                  ) : (
                    <span className="text-amber-700">Awaiting approval</span>
                  )}
                </Td>
                <Td align="right">
                  {canEdit && (
                    <DestructiveActionDialog
                      triggerLabel="Remove exclusion"
                      triggerIcon={<Trash2 className="h-3.5 w-3.5" />}
                      title="Remove this exclusion?"
                      description={exclusion.excludedItem}
                      confirmLabel="Remove"
                      formAction={deleteExclusionAction}
                    >
                      <input type="hidden" name="assessmentId" value={id} />
                      <input type="hidden" name="exclusionId" value={exclusion.id} />
                    </DestructiveActionDialog>
                  )}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {excludedInventoryLines.length > 0 && (
        <SectionCard
          title="Inventory lines marked as excluded"
          description="Lines switched off in the model. Each should also appear in the exclusions register above with its estimated relevance."
        >
          <DataTable headers={["Line", "Reason recorded on the line"]}>
            {excludedInventoryLines.map((line) => (
              <tr key={line.id}>
                <Td className="font-medium text-slate-900">{line.name}</Td>
                <Td className="text-xs">
                  {line.exclusionReason ?? <span className="font-medium text-red-700">No reason recorded</span>}
                </Td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}
    </div>
  );
}
