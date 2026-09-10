/**
 * Live binding for the board-sprint's own frozen management pack
 * (`FrozenBoardPack` in contracts.ts, rendered by
 * src/components/board/management-pack.tsx) — distinct from the
 * pre-existing T73 `ManagementReviewPack` (src/lib/ems/review/pack-service.ts),
 * whose payload is a different, unrelated shape (review/attendees/inputs)
 * that cannot carry an Overview snapshot, decisions, or pinned source
 * revisions. This module was missing entirely before Checkpoint B; BD08's
 * createFrozenManagementPack only ever produced the T73 pack, so this
 * board-sprint contract's own artifact was never generated or persisted.
 *
 * Generate/issue follow the exact same atomic-CAS, issue-once pattern
 * pack-service.ts already uses and Checkpoint B confirmed correct there:
 * a plain re-read-then-write does not fully close a generate/issue race
 * (a SELECT does not force Postgres to re-evaluate against a concurrent
 * writer's just-committed row the way an UPDATE's WHERE clause does), so
 * the write itself is the compare-and-swap.
 */
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import { canonicalStringify } from "@/lib/audit/integrity";
import { loadOverviewForContext, type OverviewSearchParams } from "./live-overview";
import type { FrozenBoardPack } from "./contracts";

export class BoardManagementPackError extends Error {}

const MANAGE_PERMISSION = "ems.management_review.manage" as const;
const VIEW_PERMISSION = "ems.view" as const;

type SnapshotBody = Pick<FrozenBoardPack, "reference" | "snapshot" | "sourceRevisions" | "decisions">;

function computeChecksum(body: SnapshotBody): string {
  return createHash("sha256").update(canonicalStringify(body)).digest("hex");
}

export interface GenerateBoardManagementPackInput {
  reference: string;
  overviewWindow: OverviewSearchParams;
  sourceRevisions: FrozenBoardPack["sourceRevisions"];
  decisions: FrozenBoardPack["decisions"];
  actorUserId: string;
}

/** Repeatable while DRAFT — mirrors generateManagementReviewPack's own contract. */
export async function generateBoardManagementPack(context: OrganisationContext, input: GenerateBoardManagementPackInput) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const overview = await loadOverviewForContext(context, input.overviewWindow);
  const body: SnapshotBody = {
    reference: input.reference,
    snapshot: overview,
    sourceRevisions: input.sourceRevisions,
    decisions: input.decisions,
  };
  const payloadSha256 = computeChecksum(body);

  return prisma.$transaction(async (tx) => {
    const current = await tx.boardManagementPack.findFirst({ where: tenantWhere(ctx, { reference: input.reference }) });
    if (!current) {
      return tx.boardManagementPack.create({
        data: {
          organisationId: ctx.organisationId,
          reference: input.reference,
          status: "DRAFT",
          snapshot: body as object,
          payloadSha256,
          preparedByUserId: input.actorUserId,
        },
      });
    }
    // The actual compare-and-swap: WHERE status = 'DRAFT' is re-evaluated
    // by Postgres against the latest committed row if this UPDATE had to
    // wait on a concurrent issuer's lock, so a pack issued in the interim
    // is never overwritten — affects 0 rows instead.
    const cas = await tx.boardManagementPack.updateMany({
      where: { organisationId: ctx.organisationId, id: current.id, status: "DRAFT" },
      data: { snapshot: body as object, payloadSha256 },
    });
    if (cas.count === 0) {
      throw new BoardManagementPackError("This pack has already been issued and cannot be regenerated.");
    }
    return tx.boardManagementPack.findUniqueOrThrow({ where: { id: current.id } });
  });
}

/** One-way freeze — never overwrites an already-ISSUED pack, never reissuable. */
export async function issueBoardManagementPack(context: OrganisationContext, reference: string, actorUserId: string, approvedByUserId?: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const current = await prisma.boardManagementPack.findFirst({ where: tenantWhere(ctx, { reference }) });
  if (!current) throw new BoardManagementPackError("Generate the pack before issuing it.");
  if (current.status === "ISSUED") throw new BoardManagementPackError("This pack has already been issued.");

  return prisma.$transaction(async (tx) => {
    const cas = await tx.boardManagementPack.updateMany({
      where: { organisationId: ctx.organisationId, id: current.id, status: "DRAFT" },
      data: { status: "ISSUED", issuedAt: new Date(), approvedByUserId: approvedByUserId ?? null },
    });
    if (cas.count === 0) {
      throw new BoardManagementPackError("This pack was issued by a concurrent request; reload and retry.");
    }
    return tx.boardManagementPack.findUniqueOrThrow({ where: { id: current.id } });
  });
}

/** Renders only the saved snapshot — never refetches current records to fill an issued pack. */
export async function getBoardManagementPack(context: OrganisationContext, reference: string): Promise<FrozenBoardPack | null> {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const row = await prisma.boardManagementPack.findFirst({ where: tenantWhere(ctx, { reference }) });
  if (!row) return null;
  const body = row.snapshot as unknown as SnapshotBody;
  const [preparer, approver] = await Promise.all([
    prisma.user.findUnique({ where: { id: row.preparedByUserId } }),
    row.approvedByUserId ? prisma.user.findUnique({ where: { id: row.approvedByUserId } }) : Promise.resolve(null),
  ]);
  return {
    id: row.id,
    reference: row.reference,
    version: row.version,
    status: row.status === "ISSUED" ? "issued" : "draft",
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    preparedBy: preparer?.name ?? "Unknown",
    approvedBy: approver?.name ?? null,
    snapshot: body.snapshot,
    sourceRevisions: body.sourceRevisions,
    decisions: body.decisions,
    payloadSha256: row.payloadSha256,
  };
}
