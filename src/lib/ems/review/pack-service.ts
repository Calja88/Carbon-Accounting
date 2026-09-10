/**
 * Deterministic management-review pack generation, freeze-on-issue and
 * optional labelled AI narrative (task T73, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §§1,4-6, PR sequence P7-06/P7-07). Depends on `review-service.ts` (T72)
 * for `ManagementReview`/`ManagementReviewInputLink`/`ManagementReviewAttendee`,
 * already on this branch.
 *
 * Fixed decisions this module enforces (spec §1/§4/§6):
 *  - `generateManagementReviewPack` computes `payload`/`checksumSha256` from
 *    the review's *current* `ManagementReviewInputLink`/`ManagementReviewAttendee`
 *    rows, sorted deterministically (input key then source record id;
 *    person id), and may be called repeatedly while the pack is DRAFT — the
 *    same inputs at the same cutoff always serialize to the same checksum
 *    (spec acceptance "repeated generation from same snapshot is stable"),
 *    because the checksum is a SHA-256 of `canonicalStringify` (recursively
 *    key-sorted JSON, `src/lib/audit/integrity.ts`'s hash-chain helper), not
 *    a raw `JSON.stringify` of an object whose key order happens to be
 *    fixed;
 *  - `issueManagementReviewPack` recomputes the payload/checksum one final
 *    time inside the same transaction that freezes it, copies every current
 *    `ManagementReviewInputLink` into its own `ManagementReviewInputSnapshot`
 *    row, sets `status: "ISSUED"`, and moves the review INPUT_COLLECTION ->
 *    PACK_ISSUED — after which no field on this pack row (or its snapshots)
 *    is ever written again, the same `AuditReportRevision`
 *    (`report-service.ts#issueAuditReport`, T61) issue-once convention;
 *  - only an INPUT_COLLECTION review can generate/issue a pack; a pack
 *    already ISSUED can never be regenerated or reissued;
 *  - an AI narrative (`ManagementReviewAiNarrative`) can only be added to an
 *    already-ISSUED pack (never a live/draft one), is always caller-supplied
 *    content — this module never calls a live AI model or invents narrative
 *    text itself, generating prose is a UI/AI-feature concern outside T73 —
 *    starts `PENDING_REVIEW`, and must be explicitly marked
 *    `REVIEWED`/`REJECTED` by a human before `minutes-service.ts` may
 *    reference it; it is never merged into `payload`, a decision, or a
 *    minute revision's authoritative content by any code path here.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantManagementReview,
  findTenantManagementReviewPack,
  findTenantManagementReviewPackByReviewId,
  findTenantManagementReviewAiNarrative,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { canonicalStringify } from "@/lib/audit/integrity";

export { TenantOwnershipError };

export class ManagementReviewPackError extends Error {}

const MANAGE_PERMISSION = "ems.management_review.manage" as const;
const VIEW_PERMISSION = "ems.view" as const;

export const MANAGEMENT_REVIEW_PACK_GENERATOR_VERSION = "t73-pack-v1" as const;

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface ReviewForPack {
  id: string;
  reference: string;
  periodStart: Date;
  periodEnd: Date;
  cutoffDate: Date;
  agendaTemplateVersionId: string;
}

/** Pure, deterministic pack payload builder — same live rows always produce the same object shape/ordering. */
async function buildPackPayload(ctx: TenantRepositoryContext, review: ReviewForPack) {
  const inputLinks = await prisma.managementReviewInputLink.findMany({
    where: tenantWhere(ctx, { reviewId: review.id }),
  });
  const sortedLinks = [...inputLinks].sort(
    (a, b) => compareStrings(a.inputDefinitionKey, b.inputDefinitionKey) || compareStrings(a.sourceRecordId, b.sourceRecordId),
  );

  const attendees = await prisma.managementReviewAttendee.findMany({
    where: tenantWhere(ctx, { reviewId: review.id }),
  });
  const sortedAttendees = [...attendees].sort((a, b) => compareStrings(a.personId, b.personId));

  return {
    generatorVersion: MANAGEMENT_REVIEW_PACK_GENERATOR_VERSION,
    review: {
      id: review.id,
      reference: review.reference,
      periodStart: review.periodStart.toISOString(),
      periodEnd: review.periodEnd.toISOString(),
      cutoffDate: review.cutoffDate.toISOString(),
      agendaTemplateVersionId: review.agendaTemplateVersionId,
    },
    attendees: sortedAttendees.map((attendee) => ({
      personId: attendee.personId,
      role: attendee.role,
      invited: attendee.invited,
    })),
    inputs: sortedLinks.map((link) => ({
      inputDefinitionKey: link.inputDefinitionKey,
      sourceType: link.sourceType,
      sourceRecordId: link.sourceRecordId,
      sourceVersionLabel: link.sourceVersionLabel,
      summary: link.summary ?? null,
      isStale: link.isStale,
    })),
  };
}

function computeChecksum(payload: unknown): string {
  return createHash("sha256").update(canonicalStringify(payload)).digest("hex");
}

// ---------------------------------------------------------------------------
// Generate (repeatable, DRAFT only) / issue (one-way freeze)
// ---------------------------------------------------------------------------

export async function generateManagementReviewPack(context: OrganisationContext, reviewId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "INPUT_COLLECTION") {
    throw new ManagementReviewPackError("A pack can only be generated while the review is in input collection.");
  }

  const existing = await findTenantManagementReviewPackByReviewId(ctx, review.id);
  if (existing && existing.status === "ISSUED") {
    throw new ManagementReviewPackError("This review's pack has already been issued and cannot be regenerated.");
  }

  const payload = await buildPackPayload(ctx, review);
  const checksumSha256 = computeChecksum(payload);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // Checkpoint B fix: the previous unconditional upsert let a delayed
    // generate call overwrite a payload issueManagementReviewPack had
    // already frozen, if the issue committed between this function's
    // pre-transaction read and its write. A plain re-read-then-write here
    // would not fully close that window either (Postgres re-evaluates an
    // UPDATE's WHERE clause against the latest committed row when it was
    // blocked waiting on a concurrent writer's lock, but a SELECT does
    // not) — so the write itself must be the conditional: updateMany's
    // WHERE clause acts as the actual compare-and-swap when a row already
    // exists, and a fresh row is protected by its own unique constraint.
    const currentPack = await tx.managementReviewPack.findFirst({ where: tenantWhere(txCtx, { reviewId: review.id }) });
    let pack;
    if (!currentPack) {
      pack = await tx.managementReviewPack.create({
        data: {
          organisationId: txCtx.organisationId,
          reviewId: review.id,
          agendaTemplateVersionId: review.agendaTemplateVersionId,
          cutoffDate: review.cutoffDate,
          generatorVersion: MANAGEMENT_REVIEW_PACK_GENERATOR_VERSION,
          payload: toJsonInput(payload),
          checksumSha256,
          generatedAt: new Date(),
        },
      });
    } else {
      const casResult = await tx.managementReviewPack.updateMany({
        where: { organisationId: txCtx.organisationId, id: currentPack.id, status: "DRAFT" },
        data: { payload: toJsonInput(payload), checksumSha256, generatedAt: new Date() },
      });
      if (casResult.count === 0) {
        throw new ManagementReviewPackError("This review's pack has already been issued and cannot be regenerated.");
      }
      pack = await tx.managementReviewPack.findUniqueOrThrow({
        where: { organisationId_id: { organisationId: txCtx.organisationId, id: currentPack.id } },
      });
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_pack.generated",
      resourceType: "management_review_pack",
      resourceId: pack.id,
      summary: `Management review pack generated (checksum ${checksumSha256.slice(0, 12)}).`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reviewId: review.id, checksumSha256 },
    });

    return pack;
  });
}

export async function issueManagementReviewPack(context: OrganisationContext, reviewId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  if (review.status !== "INPUT_COLLECTION") {
    throw new ManagementReviewPackError("Only a review in input collection can have its pack issued.");
  }

  const pack = await findTenantManagementReviewPackByReviewId(ctx, review.id);
  if (!pack) throw new ManagementReviewPackError("Generate the pack before issuing it.");
  if (pack.status === "ISSUED") throw new ManagementReviewPackError("This pack has already been issued.");

  const payload = await buildPackPayload(ctx, review);
  const checksumSha256 = computeChecksum(payload);
  const inputLinks = await prisma.managementReviewInputLink.findMany({ where: tenantWhere(ctx, { reviewId: review.id }) });

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    // CAS: re-prove DRAFT status inside the transaction rather than trusting
    // the pre-transaction read above (BD08 carried-forward Astra finding —
    // the prior unconditional update let two concurrent issue calls both
    // succeed, double-writing input snapshots and silently re-stamping
    // issuedAt/issuedByUserId). A losing racer gets an explicit conflict,
    // never a second silent freeze.
    const casResult = await tx.managementReviewPack.updateMany({
      where: { organisationId: txCtx.organisationId, id: pack.id, status: "DRAFT" },
      data: {
        payload: toJsonInput(payload),
        checksumSha256,
        generatedAt: new Date(),
        status: "ISSUED",
        issuedByUserId: actorUserId,
        issuedAt: new Date(),
      },
    });
    if (casResult.count !== 1) {
      throw new ManagementReviewPackError("This pack was issued by a concurrent request; reload and retry.");
    }
    const issued = await tx.managementReviewPack.findUniqueOrThrow({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: pack.id } },
    });

    for (const link of inputLinks) {
      await tx.managementReviewInputSnapshot.create({
        data: {
          organisationId: txCtx.organisationId,
          packId: issued.id,
          inputDefinitionKey: link.inputDefinitionKey,
          sourceType: link.sourceType,
          sourceRecordId: link.sourceRecordId,
          sourceVersionLabel: link.sourceVersionLabel,
          summary: link.summary ?? undefined,
          isStale: link.isStale,
        },
      });
    }

    await tx.managementReview.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: review.id } },
      data: { status: "PACK_ISSUED" },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_pack.issued",
      resourceType: "management_review_pack",
      resourceId: issued.id,
      summary: `Management review pack issued (checksum ${checksumSha256.slice(0, 12)}).`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "ISSUED", checksumSha256, inputSnapshotCount: inputLinks.length },
    });

    return issued;
  });
}

export async function getManagementReviewPack(context: OrganisationContext, reviewId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const review = await findTenantManagementReview(ctx, reviewId);
  if (!review) throw new TenantOwnershipError();
  return prisma.managementReviewPack.findFirst({
    where: tenantWhere(ctx, { reviewId: review.id }),
    include: {
      inputSnapshots: { orderBy: { inputDefinitionKey: "asc" } },
      aiNarratives: { orderBy: { generatedAt: "desc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Optional, labelled AI narrative (spec §1/§6 AI boundary)
// ---------------------------------------------------------------------------

export interface AddManagementReviewAiNarrativeInput {
  content: string;
  actorUserId: string;
}

export async function addManagementReviewAiNarrative(
  context: OrganisationContext,
  packId: string,
  input: AddManagementReviewAiNarrativeInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  if (!input.content.trim()) throw new ManagementReviewPackError("Enter narrative content.");
  const ctx = toTenantRepositoryContext(context);
  const pack = await findTenantManagementReviewPack(ctx, packId);
  if (!pack) throw new TenantOwnershipError();
  if (pack.status !== "ISSUED") throw new ManagementReviewPackError("AI narrative can only be attached to an issued pack.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const narrative = await tx.managementReviewAiNarrative.create({
      data: {
        organisationId: txCtx.organisationId,
        packId: pack.id,
        content: input.content.trim(),
        generatedByUserId: input.actorUserId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_ai_narrative.added",
      resourceType: "management_review_ai_narrative",
      resourceId: narrative.id,
      summary: "AI-drafted narrative attached to management review pack, pending human review.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { packId: pack.id, status: "PENDING_REVIEW" },
    });

    return narrative;
  });
}

export interface ReviewManagementReviewAiNarrativeInput {
  decision: "REVIEWED" | "REJECTED";
  rejectionReason?: string | null;
  actorUserId: string;
}

export async function reviewManagementReviewAiNarrative(
  context: OrganisationContext,
  narrativeId: string,
  input: ReviewManagementReviewAiNarrativeInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const narrative = await findTenantManagementReviewAiNarrative(ctx, narrativeId);
  if (!narrative) throw new TenantOwnershipError();
  if (narrative.status !== "PENDING_REVIEW") throw new ManagementReviewPackError("This narrative has already been reviewed.");
  if (input.decision === "REJECTED" && !input.rejectionReason?.trim()) {
    throw new ManagementReviewPackError("Enter a reason for rejecting this narrative.");
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.managementReviewAiNarrative.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: narrative.id } },
      data: {
        status: input.decision,
        reviewedByUserId: input.actorUserId,
        reviewedAt: new Date(),
        rejectionReason: input.decision === "REJECTED" ? input.rejectionReason!.trim() : null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "management_review_ai_narrative.reviewed",
      resourceType: "management_review_ai_narrative",
      resourceId: narrative.id,
      summary: `AI narrative marked ${input.decision}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "PENDING_REVIEW" },
      after: { status: input.decision },
    });

    return updated;
  });
}
