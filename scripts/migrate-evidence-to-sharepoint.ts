/**
 * SP07 — dry-run-first migration of database-backed evidence to SharePoint
 * (Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md §"SP07 - Dry-run-first
 * evidence migration").
 *
 * Dry-run by default. Prints a JSON report only — no writes, no filenames,
 * no SharePoint URLs/tokens. `--apply` performs the actual, resumable
 * migration for `EvidenceObject` rows only (see
 * `src/lib/documents/storage/migration/evidence-migration-apply.ts` for why
 * LCA evidence and controlled-document revisions are dry-run-only in this
 * task) and refuses to run unless every safety precondition in
 * `assertApplySafetyPreconditions` is met.
 *
 * Usage:
 *   tsx scripts/migrate-evidence-to-sharepoint.ts --organisation <id> [--limit 500]
 *   tsx scripts/migrate-evidence-to-sharepoint.ts --organisation <id> --apply --confirm --batch-size 25
 */

import { PrismaClient } from "@prisma/client";
import {
  planEvidenceMigration,
  type EvidenceObjectSnapshot,
  type LcaEvidenceSnapshot,
  type MigrationItemSnapshot,
  type StorageConnectionSnapshot,
} from "../src/lib/documents/storage/migration/evidence-migration-plan";
import { assertApplySafetyPreconditions, applyEvidenceObjectMigration } from "../src/lib/documents/storage/migration/evidence-migration-apply";
import { systemTenantRepositoryContext } from "../src/lib/repositories/carbon-repository";
import { isUnderLegalHold } from "../src/lib/retention/legal-hold-service";
import { documentEvidenceStorage } from "../src/lib/documents/storage/provider";

interface CliArgs {
  organisationId: string;
  apply: boolean;
  confirm: boolean;
  batchSize: number;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  let organisationId: string | undefined;
  let apply = false;
  let confirm = false;
  let batchSize = 25;
  let limit = 1000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--organisation") {
      organisationId = argv[++i];
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--confirm") {
      confirm = true;
    } else if (arg === "--batch-size") {
      batchSize = Number(argv[++i]);
    } else if (arg === "--limit") {
      limit = Number(argv[++i]);
    } else if (arg === "--dry-run") {
      // Default behaviour; accepted explicitly for clarity in CI/docs.
    } else {
      throw new Error(`Unrecognised argument: ${arg}`);
    }
  }

  if (!organisationId) {
    throw new Error("--organisation <id> is required.");
  }

  return { organisationId, apply, confirm, batchSize, limit };
}

async function loadItems(prisma: PrismaClient, organisationId: string, limit: number): Promise<MigrationItemSnapshot[]> {
  const [evidenceObjects, lcaEvidence, controlledDocumentRevisions] = await Promise.all([
    prisma.evidenceObject.findMany({
      where: { organisationId },
      take: limit,
      select: {
        id: true,
        storageProvider: true,
        byteSize: true,
        mimeType: true,
        checksumSha256: true,
        malwareScanStatus: true,
        legalHold: true,
        retentionTombstonedAt: true,
        retentionUntil: true,
        controlledDocumentRevision: { select: { id: true } },
        externalFileReference: { select: { id: true } },
        blob: { select: { id: true } },
        links: { select: { id: true } },
      },
    }),
    prisma.lcaEvidence.findMany({
      where: { organisationId },
      take: limit,
      select: { id: true, assessmentId: true, storageProvider: true, sizeBytes: true, mimeType: true, checksumSha256: true },
    }),
    prisma.controlledDocumentRevision.findMany({
      where: { organisationId },
      take: limit,
      select: {
        id: true,
        documentId: true,
        status: true,
        evidenceObjectId: true,
        sizeBytes: true,
        mimeType: true,
        checksumSha256: true,
        externalFileReference: { select: { id: true } },
        currentForDocument: { select: { id: true } },
      },
    }),
  ]);

  const items: MigrationItemSnapshot[] = [];

  for (const e of evidenceObjects) {
    const underLegalHold = await isUnderLegalHold(
      systemTenantRepositoryContext(organisationId, "sp07-migration-dry-run"),
      "evidence_object",
      e.id,
    );
    const snapshot: EvidenceObjectSnapshot = {
      kind: "evidence_object",
      id: e.id,
      storageProvider: e.storageProvider,
      hasBlob: Boolean(e.blob),
      byteSize: e.byteSize,
      mimeType: e.mimeType,
      checksumSha256: e.checksumSha256,
      malwareScanStatus: e.malwareScanStatus,
      legalHold: e.legalHold,
      underLegalHold,
      retentionTombstonedAt: e.retentionTombstonedAt ? e.retentionTombstonedAt.toISOString() : null,
      retentionUntil: e.retentionUntil ? e.retentionUntil.toISOString() : null,
      linkedResourceCount: e.links.length,
      controlledDocumentRevisionId: e.controlledDocumentRevision?.id ?? null,
      alreadyHasExternalReference: Boolean(e.externalFileReference),
    };
    items.push(snapshot);
  }

  for (const l of lcaEvidence) {
    const snapshot: LcaEvidenceSnapshot = {
      kind: "lca_evidence",
      id: l.id,
      assessmentId: l.assessmentId,
      storageProvider: l.storageProvider,
      byteSize: l.sizeBytes,
      mimeType: l.mimeType,
      checksumSha256: l.checksumSha256,
    };
    items.push(snapshot);
  }

  for (const r of controlledDocumentRevisions) {
    const underLegalHold = await isUnderLegalHold(
      systemTenantRepositoryContext(organisationId, "sp07-migration-dry-run"),
      "controlled_document_revision",
      r.id,
    );
    items.push({
      kind: "controlled_document_revision",
      id: r.id,
      documentId: r.documentId,
      status: r.status,
      evidenceObjectId: r.evidenceObjectId,
      sizeBytes: r.sizeBytes,
      mimeType: r.mimeType,
      checksumSha256: r.checksumSha256,
      underLegalHold,
      retentionUntil: null,
      alreadyHasExternalReference: Boolean(r.externalFileReference),
      isCurrentRevision: Boolean(r.currentForDocument),
    });
  }

  return items;
}

async function loadStorageConnection(prisma: PrismaClient, organisationId: string): Promise<StorageConnectionSnapshot | null> {
  const connection = await prisma.organisationStorageConnection.findUnique({
    where: { organisationId },
    select: { status: true, siteBindings: { where: { status: "CONNECTED" }, select: { id: true }, take: 1 } },
  });
  if (!connection) return null;
  return {
    status: connection.status,
    activeSiteBindingId: connection.siteBindings[0]?.id ?? null,
  };
}

async function run(prisma: PrismaClient, args: CliArgs) {
  const items = await loadItems(prisma, args.organisationId, args.limit);
  const storageConnection = await loadStorageConnection(prisma, args.organisationId);

  const report = planEvidenceMigration({ organisationId: args.organisationId, storageConnection, items });

  if (!args.apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const preconditions = assertApplySafetyPreconditions({
    organisationId: args.organisationId,
    storageConnectionStatus: storageConnection?.status ?? null,
    activeSiteBindingId: storageConnection?.activeSiteBindingId ?? null,
    batchSize: args.batchSize,
    confirmed: args.confirm,
  });

  if (!preconditions.ok) {
    console.log(JSON.stringify({ ...report, apply: { ok: false, refusedReasons: preconditions.reasons } }, null, 2));
    process.exitCode = 1;
    return;
  }

  const provider = documentEvidenceStorage.forKey("sharepoint");
  if (!provider) {
    console.log(JSON.stringify({ ...report, apply: { ok: false, refusedReasons: ["No SharePoint EvidenceStorageProvider is registered."] } }, null, 2));
    process.exitCode = 1;
    return;
  }

  const ctx = systemTenantRepositoryContext(args.organisationId, "sp07-migration-apply");
  const applyCandidateIds = report.candidates.filter((c) => c.kind === "evidence_object" && c.applySupported).map((c) => c.id).slice(0, args.batchSize);

  const outcomes = [];
  for (const evidenceObjectId of applyCandidateIds) {
    outcomes.push(await applyEvidenceObjectMigration(ctx, evidenceObjectId, provider));
  }

  console.log(
    JSON.stringify(
      {
        ...report,
        apply: {
          ok: true,
          batchSize: args.batchSize,
          attempted: outcomes.length,
          migrated: outcomes.filter((o) => o.status === "migrated").length,
          alreadyMigrated: outcomes.filter((o) => o.status === "already_migrated").length,
          refused: outcomes.filter((o) => o.status === "refused").length,
          outcomes,
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    await run(prisma, args);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { parseArgs, run };
