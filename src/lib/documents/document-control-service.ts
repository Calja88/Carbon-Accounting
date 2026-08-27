/**
 * Controlled document / revision lifecycle service (task T22,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §§1-2 "Controlled documents and
 * evidence" / "State machines").
 *
 * State machine: `DRAFT -> IN_REVIEW -> APPROVED -> EFFECTIVE -> OBSOLETE`.
 * Transitions are explicit, permission-checked functions here — never
 * generic CRUD — and every one commits its domain write and audit event
 * atomically in one transaction, plus an outbox notification for status
 * changes (Phase 2 spec §1: "the database outbox is the reliability
 * boundary").
 *
 * Immutability: `prisma/migrations/20260811160000_add_controlled_documents_and_evidence`
 * adds a `BEFORE UPDATE` trigger that blocks any content/classification/
 * retention change and any backward status move once a revision has left
 * DRAFT/IN_REVIEW. The checks in this module are the primary defence; the
 * trigger is defence-in-depth against a future direct-SQL write, matching
 * the T21 outbox-topic trigger pattern.
 *
 * Replacement: there is no "edit an approved revision" path.
 * `createSuccessorRevision` is the only way to change a document's content
 * once a revision has been approved — it always creates a new DRAFT row
 * linked back via `supersedesRevisionId` (T22 acceptance: "replacement
 * creates successor").
 */

import type { ControlledDocumentStatus, EvidenceClassification, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, assertFourEyes } from "@/lib/rbac/authorize";
import {
  findTenantControlledDocument,
  findTenantControlledDocumentRevision,
  findTenantEvidenceObject,
  toTenantRepositoryContext,
} from "@/lib/repositories/documents-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { enqueueTenantJob } from "@/lib/jobs/outbox-service";
import { resolveApprovalPin } from "@/lib/documents/storage/controlled-document-link-service";
import type { GraphClient } from "@/lib/documents/storage/graph/types";

export { TenantOwnershipError };

export class DocumentControlError extends Error {}

const REVISION_STATUS_TOPIC = "documents.controlled_document_revision_status_changed";

function idempotencyKeyFor(revisionId: string, status: ControlledDocumentStatus): string {
  return `${revisionId}:${status}`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getControlledDocument(context: OrganisationContext, documentId: string) {
  const ctx = toTenantRepositoryContext(context);
  const document = await findTenantControlledDocument(ctx, documentId);
  return prisma.controlledDocument.findUnique({
    where: { id: document.id },
    include: {
      currentRevision: true,
      revisions: { orderBy: { revisionNumber: "desc" } },
    },
  });
}

/**
 * Same tenant-scoped lookup as `getControlledDocument`, but with each
 * revision's evidence metadata and distribution records included — the
 * detail page needs both without a second round trip.
 */
export async function getControlledDocumentDetail(context: OrganisationContext, documentId: string) {
  const ctx = toTenantRepositoryContext(context);
  const document = await findTenantControlledDocument(ctx, documentId);
  return prisma.controlledDocument.findUnique({
    where: { id: document.id },
    include: {
      owner: { include: { user: { select: { name: true } } } },
      currentRevision: true,
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: { evidenceObject: true, distributions: { include: { audienceMembership: { include: { user: { select: { name: true } } } } } } },
      },
    },
  });
}

export async function listControlledDocuments(context: OrganisationContext) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.controlledDocument.findMany({
    where: tenantWhere(ctx, {}),
    include: { currentRevision: true },
    orderBy: { reference: "asc" },
  });
}

/** Loads a revision, verified in-tenant and (when supplied) attached to the expected document — the nested-parent-substitution guard. */
export async function getRevision(context: OrganisationContext, revisionId: string, expectedDocumentId?: string) {
  const ctx = toTenantRepositoryContext(context);
  return findTenantControlledDocumentRevision(ctx, revisionId, expectedDocumentId);
}

// ---------------------------------------------------------------------------
// Document creation
// ---------------------------------------------------------------------------

export interface CreateControlledDocumentInput {
  reference: string;
  title: string;
  category: string;
  classification?: EvidenceClassification;
  ownerMembershipId?: string | null;
  reviewIntervalMonths?: number | null;
  actorUserId: string;
}

/** Creates a controlled document with its first DRAFT revision (revision 1). */
export async function createControlledDocument(context: OrganisationContext, input: CreateControlledDocumentInput) {
  requirePermission(context, "ems.controlled_document.manage");
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const document = await tx.controlledDocument.create({
      data: {
        organisationId: txCtx.organisationId,
        reference: input.reference,
        title: input.title,
        category: input.category,
        classification: input.classification ?? "INTERNAL",
        ownerMembershipId: input.ownerMembershipId ?? null,
        reviewIntervalMonths: input.reviewIntervalMonths ?? null,
      },
    });

    const revision = await tx.controlledDocumentRevision.create({
      data: {
        documentId: document.id,
        organisationId: txCtx.organisationId,
        revisionNumber: 1,
        status: "DRAFT",
        classification: document.classification,
        preparedByUserId: input.actorUserId,
      },
    });

    await tx.controlledDocument.update({
      where: { id: document.id, organisationId: txCtx.organisationId },
      data: { currentRevisionId: revision.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "controlled_document.created",
      resourceType: "controlled_document",
      resourceId: document.id,
      summary: `Controlled document "${input.reference}" created with draft revision 1.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { reference: input.reference, title: input.title, category: input.category },
    });

    return { document, revision };
  });
}

// ---------------------------------------------------------------------------
// Evidence attachment (draft/in-review only — the migration trigger blocks
// this on any later status, this check is the fast, informative failure
// path before that trigger would ever fire).
// ---------------------------------------------------------------------------

function assertRevisionEditable(revision: { status: ControlledDocumentStatus }): void {
  if (revision.status !== "DRAFT" && revision.status !== "IN_REVIEW") {
    throw new DocumentControlError(
      `Revision is ${revision.status} and can no longer be edited. Create a successor revision instead.`,
    );
  }
}

export async function attachEvidenceToRevision(
  context: OrganisationContext,
  revisionId: string,
  evidenceObjectId: string,
  actorUserId: string,
) {
  requirePermission(context, "ems.controlled_document.manage");
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision) throw new TenantOwnershipError();
  assertRevisionEditable(revision);
  const evidence = await findTenantEvidenceObject(ctx, evidenceObjectId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.evidenceLink.upsert({
      where: {
        evidenceId_resourceType_resourceId: {
          evidenceId: evidence.id,
          resourceType: "controlled_document_revision",
          resourceId: revision.id,
        },
      },
      create: {
        evidenceId: evidence.id,
        organisationId: txCtx.organisationId,
        resourceType: "controlled_document_revision",
        resourceId: revision.id,
        linkedByUserId: actorUserId,
      },
      update: {},
    });

    const updated = await tx.controlledDocumentRevision.update({
      where: { id: revision.id, organisationId: txCtx.organisationId },
      data: {
        evidenceObjectId: evidence.id,
        checksumSha256: evidence.checksumSha256,
        mimeType: evidence.mimeType,
        sizeBytes: evidence.byteSize,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "evidence_object.linked",
      resourceType: "controlled_document_revision",
      resourceId: revision.id,
      summary: `Evidence "${evidence.filename}" attached to revision ${revision.revisionNumber}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { evidenceObjectId: evidence.id, checksumSha256: evidence.checksumSha256 },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

async function transitionStatus(
  context: OrganisationContext,
  revisionId: string,
  options: {
    from: ControlledDocumentStatus[];
    to: ControlledDocumentStatus;
    permission: "ems.controlled_document.manage" | "ems.controlled_document.approve";
    actorUserId: string;
    eventType:
      | "controlled_document_revision.submitted_for_review"
      | "controlled_document_revision.reviewed"
      | "controlled_document_revision.approved"
      | "controlled_document_revision.published_effective"
      | "controlled_document_revision.made_obsolete";
    summary: string;
    extraData?: Record<string, unknown>;
    guard?: (revision: NonNullable<Awaited<ReturnType<typeof findTenantControlledDocumentRevision>>>) => void;
    /**
     * Optional async work performed before the transaction opens (e.g. a
     * Microsoft Graph read, task SP04). Its returned fields are merged into
     * the same `controlledDocumentRevision.update` call that changes
     * `status`, so a field the immutability trigger guards (e.g.
     * `checksumSha256`) can still be set here: at that moment `OLD.status`
     * is still the pre-transition value the trigger allows editing under.
     * Throwing here aborts the whole transition before any write happens.
     */
    prepare?: (
      revision: NonNullable<Awaited<ReturnType<typeof findTenantControlledDocumentRevision>>>,
    ) => Promise<Record<string, unknown> | void>;
    /** Optional extra writes performed in the same transaction, after the main status update and its audit event. */
    extraTransaction?: (
      tx: Prisma.TransactionClient,
      txCtx: ReturnType<typeof toTenantRepositoryContext>,
      revision: NonNullable<Awaited<ReturnType<typeof findTenantControlledDocumentRevision>>>,
    ) => Promise<void>;
  },
) {
  requirePermission(context, options.permission);
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision || !options.from.includes(revision.status)) {
    throw new DocumentControlError(
      `Revision must be ${options.from.join(" or ")} to move to ${options.to} (it is ${revision?.status ?? "missing"}).`,
    );
  }
  options.guard?.(revision);
  const prepared = (await options.prepare?.(revision)) ?? {};

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.controlledDocumentRevision.update({
      where: { id: revision.id, organisationId: txCtx.organisationId },
      data: { status: options.to, ...options.extraData, ...prepared },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: options.eventType,
      resourceType: "controlled_document_revision",
      resourceId: revision.id,
      summary: options.summary,
      actorUserId: options.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: revision.status },
      after: { status: options.to },
    });

    await options.extraTransaction?.(tx, txCtx, revision);

    await enqueueTenantJob(tx, txCtx, {
      topic: REVISION_STATUS_TOPIC,
      payload: { controlledDocumentRevisionId: revision.id, documentId: revision.documentId, status: options.to },
      idempotencyKey: idempotencyKeyFor(revision.id, options.to),
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

export async function submitRevisionForReview(context: OrganisationContext, revisionId: string, actorUserId: string) {
  return transitionStatus(context, revisionId, {
    from: ["DRAFT"],
    to: "IN_REVIEW",
    permission: "ems.controlled_document.manage",
    actorUserId,
    eventType: "controlled_document_revision.submitted_for_review",
    summary: "Revision submitted for review.",
  });
}

export async function recordRevisionReview(context: OrganisationContext, revisionId: string, actorUserId: string) {
  return transitionStatus(context, revisionId, {
    from: ["IN_REVIEW"],
    to: "IN_REVIEW",
    permission: "ems.controlled_document.manage",
    actorUserId,
    eventType: "controlled_document_revision.reviewed",
    summary: "Revision reviewed.",
    extraData: { reviewedByUserId: actorUserId, reviewedAt: new Date() },
  });
}

export interface ApproveRevisionOptions {
  actorUserId: string;
  /** Whether four-eyes (author cannot approve their own revision) is enforced. Defaults to enabled — no organisation-level toggle exists yet (T14 note), so T22 defaults to the safer setting. */
  fourEyesEnabled?: boolean;
  /** Injectable Graph client for tests (task SP04) — defaults to the shared `MicrosoftGraphClient`. Ignored when the revision has no SharePoint reference. */
  graphClient?: GraphClient;
}

/**
 * Approves an IN_REVIEW revision. If the revision has a SharePoint-linked
 * (task SP04) external file reference, the exact version/checksum in force
 * right now is resolved and pinned atomically with the APPROVED transition
 * — `resolveApprovalPin` throws a blocking error rather than approving
 * against a missing/pruned/inaccessible version, and a revision with no
 * SharePoint reference approves exactly as before (T22 fallback behaviour
 * unchanged).
 */
export async function approveRevision(context: OrganisationContext, revisionId: string, options: ApproveRevisionOptions) {
  let pin: Awaited<ReturnType<typeof resolveApprovalPin>> = null;

  return transitionStatus(context, revisionId, {
    from: ["IN_REVIEW"],
    to: "APPROVED",
    permission: "ems.controlled_document.approve",
    actorUserId: options.actorUserId,
    eventType: "controlled_document_revision.approved",
    summary: "Revision approved.",
    extraData: { approvedByUserId: options.actorUserId, approvedAt: new Date() },
    guard: (revision) => {
      if (!revision.reviewedByUserId) {
        throw new DocumentControlError("Revision must be reviewed before it can be approved.");
      }
      assertFourEyes({
        enabled: options.fourEyesEnabled ?? true,
        actorUserId: options.actorUserId,
        authorUserId: revision.preparedByUserId ?? options.actorUserId,
      });
    },
    prepare: async (revision) => {
      pin = await resolveApprovalPin(revision.organisationId, revision.id, options.graphClient);
      if (!pin) return;
      return { checksumSha256: pin.checksumSha256, mimeType: pin.mimeType, sizeBytes: pin.byteSize };
    },
    extraTransaction: async (tx, txCtx) => {
      if (!pin) return;
      const updatedReference = await tx.externalFileReference.update({
        where: { id: pin.referenceId, organisationId: txCtx.organisationId },
        data: { versionId: pin.versionId, checksumSha256: pin.checksumSha256, byteSize: pin.byteSize, pinnedAt: new Date(), lastObservedAt: new Date() },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "external_file_reference.pinned",
        resourceType: "external_file_reference",
        resourceId: updatedReference.id,
        summary: `External file reference pinned to version ${updatedReference.versionId} at approval.`,
        actorUserId: options.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        after: { versionId: updatedReference.versionId, checksumSha256: updatedReference.checksumSha256 },
      });
    },
  });
}

export interface PublishRevisionEffectiveInput {
  actorUserId: string;
  effectiveDate?: Date;
  reviewDueDate?: Date | null;
}

/**
 * Moves an APPROVED revision to EFFECTIVE, points the document's
 * `currentRevisionId` at it, and — if a different revision of the same
 * document is currently EFFECTIVE — moves that one to OBSOLETE in the same
 * transaction, so a document never has two effective revisions at once.
 */
export async function publishRevisionEffective(
  context: OrganisationContext,
  revisionId: string,
  input: PublishRevisionEffectiveInput,
) {
  requirePermission(context, "ems.controlled_document.approve");
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision || revision.status !== "APPROVED") {
    throw new DocumentControlError(`Revision must be APPROVED to publish effective (it is ${revision?.status ?? "missing"}).`);
  }
  const effectiveDate = input.effectiveDate ?? new Date();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const previousEffective = await tx.controlledDocumentRevision.findFirst({
      where: {
        organisationId: txCtx.organisationId,
        documentId: revision.documentId,
        status: "EFFECTIVE",
        id: { not: revision.id },
      },
    });

    if (previousEffective) {
      await tx.controlledDocumentRevision.update({
        where: { id: previousEffective.id, organisationId: txCtx.organisationId },
        data: { status: "OBSOLETE", obsoleteDate: effectiveDate },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "controlled_document_revision.made_obsolete",
        resourceType: "controlled_document_revision",
        resourceId: previousEffective.id,
        summary: `Revision ${previousEffective.revisionNumber} superseded by revision ${revision.revisionNumber}.`,
        actorUserId: input.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: "EFFECTIVE" },
        after: { status: "OBSOLETE" },
      });
      await enqueueTenantJob(tx, txCtx, {
        topic: REVISION_STATUS_TOPIC,
        payload: { controlledDocumentRevisionId: previousEffective.id, documentId: revision.documentId, status: "OBSOLETE" },
        idempotencyKey: idempotencyKeyFor(previousEffective.id, "OBSOLETE"),
        correlationId: txCtx.correlationId,
        source: "web-app",
      });
    }

    const updated = await tx.controlledDocumentRevision.update({
      where: { id: revision.id, organisationId: txCtx.organisationId },
      data: { status: "EFFECTIVE", effectiveDate, reviewDueDate: input.reviewDueDate ?? null },
    });

    await tx.controlledDocument.update({
      where: { id: revision.documentId, organisationId: txCtx.organisationId },
      data: { currentRevisionId: revision.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "controlled_document_revision.published_effective",
      resourceType: "controlled_document_revision",
      resourceId: revision.id,
      summary: `Revision ${revision.revisionNumber} published effective.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "APPROVED" },
      after: { status: "EFFECTIVE", effectiveDate: effectiveDate.toISOString() },
    });

    await enqueueTenantJob(tx, txCtx, {
      topic: REVISION_STATUS_TOPIC,
      payload: { controlledDocumentRevisionId: revision.id, documentId: revision.documentId, status: "EFFECTIVE" },
      idempotencyKey: idempotencyKeyFor(revision.id, "EFFECTIVE"),
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor revisions — the only path to changing an approved document
// ---------------------------------------------------------------------------

export interface CreateSuccessorRevisionInput {
  documentId: string;
  changeSummary?: string | null;
  actorUserId: string;
}

/**
 * Creates a new DRAFT revision that will supersede the document's current
 * revision once approved and published. The revision being replaced must be
 * APPROVED, EFFECTIVE, or OBSOLETE — a DRAFT/IN_REVIEW revision is still
 * editable in place and does not need a successor.
 */
export async function createSuccessorRevision(context: OrganisationContext, input: CreateSuccessorRevisionInput) {
  requirePermission(context, "ems.controlled_document.manage");
  const ctx = toTenantRepositoryContext(context);
  const document = await findTenantControlledDocument(ctx, input.documentId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.controlledDocumentRevision.findFirst({
      where: { organisationId: txCtx.organisationId, documentId: document.id },
      orderBy: { revisionNumber: "desc" },
    });
    if (!latest) {
      throw new DocumentControlError("Document has no revisions to replace.");
    }
    if (latest.status === "DRAFT" || latest.status === "IN_REVIEW") {
      throw new DocumentControlError(
        `Revision ${latest.revisionNumber} is still ${latest.status} — edit it directly instead of creating a successor.`,
      );
    }

    const successor = await tx.controlledDocumentRevision.create({
      data: {
        documentId: document.id,
        organisationId: txCtx.organisationId,
        revisionNumber: latest.revisionNumber + 1,
        status: "DRAFT",
        classification: document.classification,
        changeSummary: input.changeSummary ?? null,
        preparedByUserId: input.actorUserId,
        supersedesRevisionId: latest.id,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "controlled_document_revision.created",
      resourceType: "controlled_document_revision",
      resourceId: successor.id,
      summary: `Successor revision ${successor.revisionNumber} created, replacing revision ${latest.revisionNumber}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { revisionNumber: successor.revisionNumber, supersedesRevisionId: latest.id },
    });

    return successor;
  });
}

// ---------------------------------------------------------------------------
// Discarding a draft — the "no removal action at all" gap this pass fills.
// A DRAFT revision has never been reviewed/approved, so it carries no
// governance weight of its own; the immutability trigger only starts
// protecting a revision once it leaves DRAFT/IN_REVIEW. The linked
// EvidenceObject (if any content was attached) is never deleted here —
// only the revision row and its attachment link.
// ---------------------------------------------------------------------------

/**
 * Discards a DRAFT controlled-document revision that was created by
 * mistake or is no longer needed. If it is revision 1 of a document that
 * has never had a current (EFFECTIVE) revision, the empty parent
 * `ControlledDocument` is discarded too — otherwise only the draft revision
 * is removed and the document (with its remaining revision history) is
 * left in place. Never allowed once the revision has left DRAFT: use
 * `createSuccessorRevision` or, once EFFECTIVE, let publishing a successor
 * retire it to OBSOLETE automatically.
 */
export async function discardDraftRevision(context: OrganisationContext, revisionId: string, actorUserId: string) {
  requirePermission(context, "ems.controlled_document.manage");
  const ctx = toTenantRepositoryContext(context);
  const revision = await findTenantControlledDocumentRevision(ctx, revisionId);
  if (!revision) throw new TenantOwnershipError();

  if (revision.status !== "DRAFT") {
    throw new DocumentControlError(`Only a DRAFT revision can be discarded (this one is ${revision.status}).`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const document = await tx.controlledDocument.findFirst({
      where: { id: revision.documentId, organisationId: txCtx.organisationId },
    });
    if (!document) throw new TenantOwnershipError();
    if (document.currentRevisionId === revision.id) {
      // Can only happen if a future change ever lets currentRevisionId
      // point at a non-EFFECTIVE revision — defence in depth.
      throw new DocumentControlError("This revision is the document's current revision and cannot be discarded.");
    }

    const otherRevisionCount = await tx.controlledDocumentRevision.count({
      where: { organisationId: txCtx.organisationId, documentId: document.id, id: { not: revision.id } },
    });

    try {
      await tx.controlledDocumentRevision.delete({ where: { id: revision.id, organisationId: txCtx.organisationId } });
    } catch {
      throw new DocumentControlError(
        "This draft revision is still referenced by another record (e.g. an environmental policy link or a pinned operational control) and cannot be discarded.",
      );
    }

    let documentAlsoDeleted = false;
    if (otherRevisionCount === 0 && document.currentRevisionId === null) {
      await tx.controlledDocument.delete({ where: { id: document.id, organisationId: txCtx.organisationId } });
      documentAlsoDeleted = true;
    }

    await recordAuditEvent(tx, txCtx, {
      eventType: "controlled_document_revision.discarded",
      resourceType: "controlled_document_revision",
      resourceId: revision.id,
      summary: documentAlsoDeleted
        ? `Draft revision ${revision.revisionNumber} discarded, along with its empty parent document "${document.reference}".`
        : `Draft revision ${revision.revisionNumber} discarded.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { revisionNumber: revision.revisionNumber, status: revision.status },
    });

    return { id: revision.id, documentAlsoDeleted, documentId: document.id };
  });
}
