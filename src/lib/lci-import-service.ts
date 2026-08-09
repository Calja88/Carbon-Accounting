/**
 * Commit path for the LCI governance importer (src/lib/lci-import.ts).
 *
 * Same append-only discipline as commitFactorImport
 * (src/lib/factor-sets-service.ts): creates one new EmissionFactorSet + its
 * EmissionFactor rows in a single transaction, never edits or deletes an
 * existing set's rows, and a re-import of an already-present
 * (factor_id, source_version) pair is reported as a duplicate and skipped,
 * never overwritten. A new source_version for a known factor_id always
 * creates new, additional historical rows.
 *
 * Nothing here recalculates an already-issued LcaAssessmentVersion —
 * LcaCalculationResult snapshots are never touched by this module, and no
 * LCA recalculation is triggered on import (unlike the corporate
 * recalculatePendingEntries() path, which this module intentionally does
 * not call — this is reference-library data, not a corporate Scope 1/2/3
 * factor an AWAITING_FACTOR entry is blocked on).
 */

import { FactorSourceType, LciLicenseDecision, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/lca/audit-service";
import { DuplicateRow, RejectedRow, ValidatedLciRow, dedupKey, partitionDuplicates, sourceAllowsNumericImport } from "@/lib/lci-import";
import { ensureLciSourcesInitialized } from "@/lib/lci/source-registry";

const UK_DESNZ_SOURCE_ID = "UK-DESNZ-2026";

export interface LciImportPreview {
  fileName: string;
  sourceVersion: string | null;
  importable: ValidatedLciRow[];
  toImport: ValidatedLciRow[];
  duplicates: DuplicateRow[];
  rejected: RejectedRow[];
  counts: {
    total: number;
    importable: number;
    toImport: number;
    duplicates: number;
    rejectedMissingValue: number;
    rejectedOther: number;
  };
  /** Non-null only if the governance registry blocks numeric import for
   * this source — the caller must refuse to commit even if every row
   * individually looks well-formed. */
  governanceBlockReason: string | null;
}

/**
 * Builds a preview (brief item 14): validates + filters rows, checks
 * duplicates against the DB, and checks the source's registry-level
 * governance decision — all read-only, nothing committed yet.
 */
export async function buildLciImportPreview(
  fileName: string,
  importable: ValidatedLciRow[],
  rejected: RejectedRow[],
  counts: { total: number; importable: number; rejectedMissingValue: number; rejectedOther: number },
): Promise<LciImportPreview> {
  await ensureLciSourcesInitialized();

  const sourceVersion = importable[0]?.sourceVersion ?? null;

  // Governance gate: check the *registry's* current decision for this
  // source, independent of what the file's own license_decision column
  // says — a source that has since regressed to BLOCK must not be
  // importable even with a well-formed, ALLOW_WITH_ATTRIBUTION-tagged row.
  let governanceBlockReason: string | null = null;
  const lciSource = await prisma.lciSource.findUnique({ where: { sourceId: UK_DESNZ_SOURCE_ID } });
  if (!lciSource) {
    governanceBlockReason = `Source "${UK_DESNZ_SOURCE_ID}" is not present in the governance registry — refusing import until it is registered.`;
  } else if (!sourceAllowsNumericImport(lciSource.licenseDecision)) {
    governanceBlockReason = `Source "${UK_DESNZ_SOURCE_ID}" registry decision is ${lciSource.licenseDecision} (raw: "${lciSource.rawLicenseDecision}") — numeric import is not permitted.`;
  }

  const existingRows = await prisma.emissionFactor.findMany({
    where: { externalFactorId: { in: importable.map((r) => r.externalFactorId) } },
    select: { externalFactorId: true, sourceVersion: true },
  });
  const existingKeys = new Set(
    existingRows
      .filter((r): r is { externalFactorId: string; sourceVersion: string } => !!r.externalFactorId && !!r.sourceVersion)
      .map((r) => dedupKey(r.externalFactorId, r.sourceVersion)),
  );

  const { toImport, duplicates } = partitionDuplicates(importable, existingKeys);

  return {
    fileName,
    sourceVersion,
    importable,
    toImport,
    duplicates,
    rejected,
    counts: {
      total: counts.total,
      importable: counts.importable,
      toImport: toImport.length,
      duplicates: duplicates.length,
      rejectedMissingValue: counts.rejectedMissingValue,
      rejectedOther: counts.rejectedOther,
    },
    governanceBlockReason,
  };
}

export interface CommitLciImportInput {
  fileName: string;
  importedByUserId: string;
  /** Rows to actually insert — normally `preview.toImport` (duplicates
   * already excluded). */
  rows: ValidatedLciRow[];
  duplicateCount: number;
  rejected: RejectedRow[];
}

export interface CommitLciImportResult {
  factorSet: { id: string; name: string } | null;
  importedCount: number;
  duplicateCount: number;
  rejectedCount: number;
}

/**
 * Creates one new EmissionFactorSet + its EmissionFactor rows in a
 * transaction (append-only — never edits an existing set), linked to the
 * UK-DESNZ-2026 LciSource row. Writes LcaAuditEvent rows for source
 * registration (if this is the first import for it), the import itself, and
 * a rolled-up rejected-row summary (thousands of individual audit rows for
 * ~800 DATA_UNAVAILABLE rejects would be disproportionate — one event
 * carries the full per-row detail in `metadata.rejectedRows`, capped to keep
 * a single audit row bounded, with the total count always recorded even
 * when the sample is capped).
 */
export async function commitLciImport(input: CommitLciImportInput): Promise<CommitLciImportResult> {
  if (input.rows.length === 0) {
    // Nothing to import (e.g. a file of pure duplicates/rejects) is not an
    // error — it's a legitimate, reportable outcome.
    await recordAuditEvent({
      entityType: "emission_factor_import_rejected_row",
      action: "import_no_op",
      summary: `LCI import of "${input.fileName}" produced no new rows (0 importable, ${input.duplicateCount} duplicate, ${input.rejected.length} rejected).`,
      actorUserId: input.importedByUserId,
      metadata: { fileName: input.fileName, duplicateCount: input.duplicateCount, rejectedCount: input.rejected.length },
    });
    return { factorSet: null, importedCount: 0, duplicateCount: input.duplicateCount, rejectedCount: input.rejected.length };
  }

  const lciSource = await prisma.lciSource.findUnique({ where: { sourceId: UK_DESNZ_SOURCE_ID } });
  if (!lciSource) {
    throw new Error(`Source "${UK_DESNZ_SOURCE_ID}" is not registered in the governance registry — cannot commit.`);
  }
  if (!sourceAllowsNumericImport(lciSource.licenseDecision)) {
    throw new Error(`Source "${UK_DESNZ_SOURCE_ID}" registry decision (${lciSource.licenseDecision}) does not permit numeric import.`);
  }

  const first = input.rows[0];
  const sourceYear = first.sourceYear ?? new Date().getFullYear();

  const wasFirstImportForSource = (await prisma.emissionFactorSet.count({ where: { lciSourceId: lciSource.id } })) === 0;

  const factorSet = await prisma.$transaction(
    async (tx) => {
      const set = await tx.emissionFactorSet.create({
        data: {
          name: `${first.sourceName} v${first.sourceVersion}`,
          publisher: first.sourcePublisher ?? first.sourceName,
          sourceType: FactorSourceType.OFFICIAL_DEFRA_DESNZ,
          vintageYear: sourceYear,
          publishedDate: first.publicationDate,
          effectiveFrom: first.validFrom ?? first.publicationDate ?? new Date(),
          effectiveTo: first.validTo,
          sourceUrl: first.sourceUrl,
          isPlaceholder: false,
          notes:
            "Imported via the LCI governance pipeline. Characterised UK GHG conversion factors for product-LCA use — NOT a complete unit-process LCI database (see PACK_README.md). Every row requires human methodological review before use in a product assessment.",
          sourceFileName: input.fileName,
          importedByUserId: input.importedByUserId,
          sourceVersion: first.sourceVersion,
          publicationDate: first.publicationDate,
          sourceUpdatedDate: first.sourceUpdatedDate,
          methodologyUrl: first.methodologyUrl,
          licenseName: first.licenseName,
          licenseDecision: LciLicenseDecision.ALLOW_WITH_ATTRIBUTION,
          geography: first.geography,
          lciSourceId: lciSource.id,
        },
      });

      // createMany can't take a per-row Decimal-as-string safely across all
      // Prisma versions for arbitrary precision, so rows are created
      // individually inside the transaction — still one atomic unit, and
      // volumes here (hundreds to low thousands) are small enough that this
      // is not a performance concern for an admin-triggered batch import.
      for (const r of input.rows) {
        await tx.emissionFactor.create({
          data: {
            factorSetId: set.id,
            scope: r.scope,
            category: r.categoryLevel1 ?? "uncategorised",
            subtypeKey: buildSubtypeKey(r),
            region: r.geography ?? "UK",
            unit: r.denominatorUnit,
            co2eFactor: new Prisma.Decimal(r.factorValueRaw),
            notes: r.description,
            boundary: r.boundary,
            gwpBasis: r.description ?? null,
            referenceYear: r.sourceYear,
            lcaDataSource: r.name,
            externalFactorId: r.externalFactorId,
            sourceVersion: r.sourceVersion,
            isSecondaryData: true,
            isCharacterisedFactor: true,
            isFullUnitProcessLci: false,
            humanReviewRequired: true,
            automatedAssignmentAllowed: false,
            reviewNotes: r.reviewNotes,
            sourceLifecycleBoundary: r.sourceLifecycleBoundary,
            validFrom: r.validFrom,
            validTo: r.validTo,
          },
        });
      }

      return set;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  if (wasFirstImportForSource) {
    await recordAuditEvent({
      entityType: "lci_source",
      entityId: lciSource.id,
      action: "first_import",
      summary: `First factor import committed for source "${lciSource.sourceName}" (${lciSource.sourceId}).`,
      actorUserId: input.importedByUserId,
      metadata: { sourceId: lciSource.sourceId, licenseDecision: lciSource.licenseDecision },
    });
  }

  const REJECTED_SAMPLE_CAP = 200;
  await recordAuditEvent({
    entityType: "emission_factor_set",
    entityId: factorSet.id,
    action: "lci_import_committed",
    summary: `Imported ${input.rows.length} factor${input.rows.length === 1 ? "" : "s"} from "${input.fileName}" (source ${lciSource.sourceId} v${first.sourceVersion}) into a new factor set. ${input.duplicateCount} duplicate row(s) skipped, ${input.rejected.length} row(s) rejected.`,
    actorUserId: input.importedByUserId,
    metadata: {
      fileName: input.fileName,
      sourceId: lciSource.sourceId,
      sourceVersion: first.sourceVersion,
      importedCount: input.rows.length,
      duplicateCount: input.duplicateCount,
      rejectedCount: input.rejected.length,
      rejectedByReason: countByReason(input.rejected),
      rejectedRowsSample: input.rejected.slice(0, REJECTED_SAMPLE_CAP),
      rejectedRowsSampleTruncated: input.rejected.length > REJECTED_SAMPLE_CAP,
    },
  });

  return {
    factorSet: { id: factorSet.id, name: factorSet.name },
    importedCount: input.rows.length,
    duplicateCount: input.duplicateCount,
    rejectedCount: input.rejected.length,
  };
}

function buildSubtypeKey(r: ValidatedLciRow): string {
  return [r.categoryLevel2, r.categoryLevel3, r.categoryLevel4].filter(Boolean).join(" / ") || r.externalFactorId;
}

function countByReason(rejected: RejectedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return counts;
}

export async function getLciFactorSetSummaries() {
  return prisma.emissionFactorSet.findMany({
    where: { lciSourceId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { lciSource: true, importedBy: true, _count: { select: { factors: true } } },
  });
}
