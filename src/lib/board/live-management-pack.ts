/**
 * Live binding for the board-sprint's own frozen management pack
 * (`FrozenBoardPack` in contracts.ts, rendered by
 * src/components/board/management-pack.tsx).
 *
 * Checkpoint B corrective handoff §7: this is no longer a standalone
 * `BoardManagementPack` row with its own generate/issue/status/audit
 * lifecycle running alongside the pre-existing T73 `ManagementReviewPack`
 * (`@/lib/ems/review/pack-service.ts`) — there is now exactly ONE
 * management-pack lifecycle. The board's Overview snapshot, decisions and
 * pinned source revisions are a validated, versioned `board` section folded
 * into that SAME `ManagementReviewPack.payload`, covered by that pack's one
 * canonical checksum, and frozen by that pack's one issue-once CAS. This
 * module is now a thin adapter: it builds the board section from real,
 * server-derived data and calls straight through to pack-service.ts; it
 * never writes to `prisma.boardManagementPack` again.
 *
 * `BoardManagementPack` the table/migration is left entirely alone —
 * existing rows are untouched legacy data (no destructive cleanup), but no
 * runtime code path reads or writes it from here on.
 */
import type { Prisma } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, PermissionDeniedError } from "@/lib/rbac/authorize";
import { getLcaScenarioModel } from "./live-lca";
import { getLatestRun } from "@/lib/lca/calculation-service";
import { requireAssessmentInScope } from "@/lib/repositories/lca-repository";
import {
  generateManagementReviewPack,
  issueManagementReviewPack,
  getManagementReviewPack,
  BOARD_PACK_SCHEMA_VERSION,
  type BoardPackInput,
} from "@/lib/ems/review/pack-service";
import { loadOverviewForContext, type OverviewSearchParams } from "./live-overview";
import type { FrozenBoardPack } from "./contracts";

export class BoardManagementPackError extends Error {}

const VIEW_PERMISSION = "ems.view" as const;

export interface GenerateBoardManagementPackInput {
  reviewId: string;
  reference: string;
  overviewWindow: OverviewSearchParams;
  sourceRevisions: FrozenBoardPack["sourceRevisions"];
  decisions: FrozenBoardPack["decisions"];
  actorUserId: string;
  lcaScenarioId?: string;
}

/**
 * The board section is always built here, from the real Overview
 * live-loader and the caller's own already-resolved source
 * revisions/decisions — never accepted as a caller-supplied summary,
 * actor identity, or approval status. `pack-service.ts` treats the result
 * as opaque data it hashes and stores, never reinterprets.
 */
async function buildBoardSection(context: OrganisationContext, input: GenerateBoardManagementPackInput, tx: Prisma.TransactionClient): Promise<BoardPackInput> {
  const overview = await loadOverviewForContext(context, input.overviewWindow, tx);
  if (overview.carbon.state !== "ready" || overview.attention.state !== "ready") {
    throw new BoardManagementPackError("The management pack cannot freeze an incomplete performance snapshot.");
  }
  const lca = input.lcaScenarioId ? await getLcaScenarioModel(context, input.lcaScenarioId, tx) : null;
  if (input.lcaScenarioId && !lca) throw new BoardManagementPackError("The LCA scenario is unavailable for this pack.");
  const preparer = await tx.user.findUnique({ where: { id: context.userId }, select: { name: true } });
  const sourceRevisions = await Promise.all(input.sourceRevisions.map(async (source) => {
    if (source.kind === "lca_assessment") {
      await requireAssessmentInScope(context, source.id, tx);
      const run = await getLatestRun(source.id, tx);
      if (!run) throw new BoardManagementPackError("A referenced LCA calculation is missing.");
      return { ...source, revision: `run ${run.id} · ${run.runAt.toISOString()} · ${run.engineVersion}` };
    }
    if (source.kind === "nonconformity" || source.kind === "corrective_action") {
      const where = { id: source.id, organisationId: context.organisationId };
      const record = source.kind === "nonconformity" ? await tx.nonconformity.findFirst({ where }) : await tx.correctiveAction.findFirst({ where });
      if (!record) throw new BoardManagementPackError("A referenced EMS record is missing.");
      return { ...source, revision: `${record.status} @ ${record.updatedAt.toISOString()}` };
    }
    return source;
  }));
  return {
    reference: input.reference,
    overviewWindow: input.overviewWindow,
    snapshot: overview,
    sourceRevisions,
    decisions: input.decisions,
    lca,
    preparedBy: preparer?.name ?? "Name not recorded",
  };
}

/** Repeatable while DRAFT — delegates entirely to pack-service.ts's own generate. */
export async function generateBoardManagementPack(context: OrganisationContext, input: GenerateBoardManagementPackInput) {
  return generateManagementReviewPack(context, input.reviewId, input.actorUserId, (tx) => buildBoardSection(context, input, tx));
}

/** One-way freeze — delegates entirely to pack-service.ts's own issue. */
export async function issueBoardManagementPack(context: OrganisationContext, input: GenerateBoardManagementPackInput) {
  return issueManagementReviewPack(context, input.reviewId, input.actorUserId, (tx) => buildBoardSection(context, input, tx));
}

interface StoredBoardSection {
  schemaVersion: number;
  reference: string;
  snapshot: FrozenBoardPack["snapshot"];
  sourceRevisions: FrozenBoardPack["sourceRevisions"];
  decisions: FrozenBoardPack["decisions"];
  lca: FrozenBoardPack["lca"];
  preparedBy: string;
}

function parseBoardSection(payload: unknown): StoredBoardSection | null {
  if (!payload || typeof payload !== "object") return null;
  const board = (payload as Record<string, unknown>).board;
  if (!board || typeof board !== "object") return null;
  const b = board as Record<string, unknown>;
  if (b.schemaVersion !== BOARD_PACK_SCHEMA_VERSION) return null;
  if (typeof b.reference !== "string" || !b.snapshot || !Array.isArray(b.sourceRevisions) || !Array.isArray(b.decisions)) return null;
  return {
    schemaVersion: b.schemaVersion,
    reference: b.reference,
    snapshot: b.snapshot as FrozenBoardPack["snapshot"],
    sourceRevisions: b.sourceRevisions as FrozenBoardPack["sourceRevisions"],
    decisions: b.decisions as FrozenBoardPack["decisions"],
    lca: (b.lca ?? null) as FrozenBoardPack["lca"],
    preparedBy: typeof b.preparedBy === "string" ? b.preparedBy : "Name not recorded in snapshot",
  };
}

/**
 * Renders only the saved `board` section of the one management-review
 * pack — never refetches current records to fill an issued pack. Returns
 * null when the pack has no validated board section (an ordinary T73-only
 * review) or doesn't exist yet.
 */
export async function getBoardManagementPack(context: OrganisationContext, reviewId: string): Promise<FrozenBoardPack | null> {
  requirePermission(context, VIEW_PERMISSION);
  requirePermission(context, "carbon.view");
  requirePermission(context, "lca.view");
  if (context.access.mode !== "ORGANISATION_WIDE") throw new PermissionDeniedError("ENTITY_NOT_IN_SCOPE");
  const pack = await getManagementReviewPack(context, reviewId);
  if (!pack) return null;
  const board = parseBoardSection(pack.payload);
  if (!board) return null;

  return {
    id: pack.id,
    reference: board.reference,
    version: 1,
    status: pack.status === "ISSUED" ? "issued" : "draft",
    issuedAt: pack.issuedAt ? pack.issuedAt.toISOString() : null,
    preparedBy: board.preparedBy,
    // Checkpoint B corrective handoff §7: the merged lifecycle has one
    // issuer, not a separate preparer/approver pair — ManagementReviewPack
    // carries no approver field of its own, so this is never fabricated.
    approvedBy: null,
    snapshot: board.snapshot,
    sourceRevisions: board.sourceRevisions,
    decisions: board.decisions,
    payloadSha256: pack.checksumSha256 ?? "",
    cutoffDate: pack.cutoffDate.toISOString(),
    lca: board.lca,
    // The checksum covers payload.inputs. Relational snapshot rows are provenance,
    // never an alternative source of displayed historical values.
    inputs: ((pack.payload as { inputs?: { inputDefinitionKey: string; sourceType: string; sourceRecordId: string; sourceVersionLabel: string | null; summary: unknown }[] }).inputs ?? []).map((s) => ({ key: s.inputDefinitionKey, sourceType: s.sourceType, sourceRecordId: s.sourceRecordId, revision: s.sourceVersionLabel, summary: s.summary })),
  };
}
