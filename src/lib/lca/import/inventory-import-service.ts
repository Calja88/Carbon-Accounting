/**
 * The database side of the inventory/BOM import: gathering what the validator
 * needs to check a file against, and committing a confirmed preview.
 *
 * Committing is one transaction, so a partially-applied import cannot leave an
 * assessment in a state nobody chose. Every created and updated line is
 * recorded in the audit trail with the row number it came from, so a figure
 * can be traced back to the line of the spreadsheet that produced it.
 */

import { LcaFactorSelectionMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent, recordAuditEvents } from "../audit-service";
import { LCA_FACTOR_CATEGORIES } from "../factor-categories";
import {
  uncertaintyStatusFor,
  type DuplicateStrategy,
  type InventoryImportContext,
  type PreparedInventoryRow,
} from "./inventory-import";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export async function buildImportContext(assessmentId: string): Promise<InventoryImportContext> {
  const assessment = await prisma.lcaAssessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { entityId: true },
  });

  const [processes, existingItems, suppliers, factors] = await Promise.all([
    prisma.lcaProcess.findMany({
      where: { assessmentId },
      select: { id: true, name: true, stage: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.lcaInventoryItem.findMany({
      where: { assessmentId },
      select: { id: true, processId: true, name: true, partNumber: true },
    }),
    prisma.supplier.findMany({ where: { entityId: assessment.entityId }, select: { id: true, name: true } }),
    // Only categories a product model can use — the corporate library is large,
    // and a spend-based corporate factor is not a candidate for a BOM line.
    prisma.emissionFactor.findMany({
      where: { category: { in: LCA_FACTOR_CATEGORIES.map((c) => c.key) } },
      select: {
        id: true,
        category: true,
        subtypeKey: true,
        region: true,
        unit: true,
        co2eFactor: true,
        factorSet: { select: { name: true, isPlaceholder: true } },
      },
    }),
  ]);

  return {
    processes,
    existingItems,
    suppliers,
    factors: factors.map((f) => ({
      id: f.id,
      category: f.category,
      subtypeKey: f.subtypeKey,
      region: f.region,
      unit: f.unit,
      co2eFactor: f.co2eFactor.toString(),
      setName: f.factorSet.name,
      isPlaceholder: f.factorSet.isPlaceholder,
    })),
  };
}

export interface CommitImportInput {
  assessmentId: string;
  rows: PreparedInventoryRow[];
  duplicateStrategy: DuplicateStrategy;
  actorUserId: string;
  fileName: string;
}

export interface CommitImportOutcome {
  created: number;
  updated: number;
  skipped: number;
}

function toItemData(row: PreparedInventoryRow) {
  return {
    itemType: row.itemType,
    name: row.name,
    componentName: row.componentName,
    partNumber: row.partNumber,
    materialName: row.materialName,
    supplierId: row.supplierId,
    quantity: row.quantity,
    unit: row.unit,
    recycledContentPercent: row.recycledContentPercent,
    wastePercent: row.wastePercent,
    dataType: row.dataType,
    dataSource: row.dataSource,
    geography: row.geography,
    classification: row.classification,
    factorSelectionMode: row.emissionFactorId
      ? LcaFactorSelectionMode.LIBRARY_FACTOR
      : row.manualFactorValue
        ? LcaFactorSelectionMode.MANUAL
        : LcaFactorSelectionMode.NONE,
    emissionFactorId: row.emissionFactorId,
    manualFactorValue: row.manualFactorValue,
    manualFactorUnit: row.manualFactorUnit,
    manualFactorSource: row.manualFactorSource,
    temporalScore: row.temporalScore,
    geographicalScore: row.geographicalScore,
    technologicalScore: row.technologicalScore,
    completenessScore: row.completenessScore,
    reliabilityScore: row.reliabilityScore,
    uncertaintyPercent: row.uncertaintyPercent,
    uncertaintyStatus: uncertaintyStatusFor(row.uncertaintyPercent),
    notes: row.notes,
  } satisfies Omit<Prisma.LcaInventoryItemUncheckedCreateInput, "assessmentId" | "processId">;
}

export async function commitInventoryImport(context: OrganisationContext, input: CommitImportInput): Promise<CommitImportOutcome> {
  await requireAssessmentInScope(context, input.assessmentId);

  // The preview step matches processId/duplicateOfItemId against a
  // tenant-scoped candidate list (buildImportContext), but the commit step
  // receives the client-submitted rows wholesale — a tampered row could
  // otherwise point a "duplicateStrategy: update" at any inventory item's
  // id, or a process at another assessment's id. Every id used in a write
  // below is re-verified against this assessment right here.
  const [validProcessIds, validDuplicateIds] = await Promise.all([
    prisma.lcaProcess.findMany({ where: { assessmentId: input.assessmentId }, select: { id: true } }),
    prisma.lcaInventoryItem.findMany({ where: { assessmentId: input.assessmentId }, select: { id: true } }),
  ]);
  const processIds = new Set(validProcessIds.map((p) => p.id));
  const duplicateIds = new Set(validDuplicateIds.map((i) => i.id));
  for (const row of input.rows) {
    if (!processIds.has(row.processId)) throw new TenantOwnershipError();
    if (row.duplicateOfItemId && !duplicateIds.has(row.duplicateOfItemId)) throw new TenantOwnershipError();
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  const auditEvents: Parameters<typeof recordAuditEvents>[0] = [];

  await prisma.$transaction(async (tx) => {
    // Appended after whatever is already there, so an import never reorders
    // lines somebody has arranged by hand.
    const lastSortOrder = await tx.lcaInventoryItem.aggregate({
      where: { assessmentId: input.assessmentId },
      _max: { sortOrder: true },
    });
    let sortOrder = (lastSortOrder._max.sortOrder ?? 0) + 10;

    for (const row of input.rows) {
      const data = toItemData(row);

      if (row.duplicateOfItemId) {
        if (input.duplicateStrategy === "skip") {
          skipped += 1;
          continue;
        }
        if (input.duplicateStrategy === "update") {
          const before = await tx.lcaInventoryItem.findUnique({ where: { id: row.duplicateOfItemId } });
          await tx.lcaInventoryItem.update({ where: { id: row.duplicateOfItemId }, data });
          updated += 1;
          auditEvents.push({
            assessmentId: input.assessmentId,
            entityType: "inventory_item",
            entityId: row.duplicateOfItemId,
            action: "updated",
            actorUserId: input.actorUserId,
            summary: `"${row.name}" updated from imported file ${input.fileName}: ${row.quantity} ${row.unit}.`,
            before: before ? { quantity: before.quantity.toString(), unit: before.unit, emissionFactorId: before.emissionFactorId } : undefined,
            after: { quantity: row.quantity, unit: row.unit, emissionFactorId: row.emissionFactorId },
            metadata: { source: "inventory_import", fileName: input.fileName },
          });
          continue;
        }
        // create_new falls through to the create below.
      }

      const item = await tx.lcaInventoryItem.create({
        data: { ...data, assessmentId: input.assessmentId, processId: row.processId, sortOrder },
      });
      sortOrder += 10;
      created += 1;

      auditEvents.push({
        assessmentId: input.assessmentId,
        entityType: "inventory_item",
        entityId: item.id,
        action: "created",
        actorUserId: input.actorUserId,
        summary: `"${row.name}" imported from ${input.fileName}: ${row.quantity} ${row.unit}${row.emissionFactorId ? ", with a factor matched from the library" : row.manualFactorValue ? ", with a manually sourced factor" : ", awaiting a factor"}.`,
        after: {
          quantity: row.quantity,
          unit: row.unit,
          dataType: row.dataType,
          emissionFactorId: row.emissionFactorId,
          manualFactorSource: row.manualFactorSource,
        },
        metadata: { source: "inventory_import", fileName: input.fileName },
      });
    }
  });

  await recordAuditEvents(auditEvents);

  await recordAuditEvent({
    assessmentId: input.assessmentId,
    entityType: "bom_import",
    action: "imported",
    actorUserId: input.actorUserId,
    summary: `Inventory import from ${input.fileName}: ${created} line(s) created, ${updated} updated, ${skipped} skipped as duplicates (strategy: ${input.duplicateStrategy}).`,
    after: { created, updated, skipped, duplicateStrategy: input.duplicateStrategy },
  });

  return { created, updated, skipped };
}
