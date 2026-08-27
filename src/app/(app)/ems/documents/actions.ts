"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError, requirePermission } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  DocumentControlError,
  createControlledDocument,
  attachEvidenceToRevision,
  submitRevisionForReview,
  recordRevisionReview,
  approveRevision,
  publishRevisionEffective,
  createSuccessorRevision,
  discardDraftRevision,
} from "@/lib/documents/document-control-service";
import { EvidenceError, EvidenceLifecycleError, uploadEvidenceObject, unlinkEvidence, discardUnlinkedEvidenceObject } from "@/lib/documents/evidence-service";
import {
  createControlledDocumentFormSchema,
  createSuccessorRevisionFormSchema,
  publishRevisionEffectiveFormSchema,
  approveRevisionFormSchema,
  revisionIdFormSchema,
  distributeRevisionFormSchema,
  linkExistingEvidenceFormSchema,
} from "@/lib/documents/schemas";
import { prisma } from "@/lib/prisma";
import { toTenantRepositoryContext } from "@/lib/repositories/documents-repository";

export interface DocumentsActionState {
  error: string | null;
  message: string | null;
}

const emptyState: DocumentsActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation.";
  if (error instanceof DocumentControlError || error instanceof EvidenceError || error instanceof EvidenceLifecycleError) return error.message;
  if (error instanceof Error && error.message.includes("Unique constraint")) return "That reference is already in use.";
  throw error;
}

function revalidateDocuments(documentId?: string) {
  revalidatePath("/ems/documents");
  if (documentId) revalidatePath(`/ems/documents/${documentId}`);
  revalidatePath("/ems/evidence");
  revalidatePath("/ems");
}

export async function createControlledDocumentAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createControlledDocumentFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the document details." };
    const { document } = await createControlledDocument(context, {
      ...parsed.data,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      actorUserId: context.userId,
    });
    revalidateDocuments(document.id);
    return { ...emptyState, message: `Controlled document "${parsed.data.reference}" created as a draft.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function uploadRevisionEvidenceAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const revisionId = String(formData.get("revisionId") ?? "");
    const documentId = String(formData.get("documentId") ?? "");
    const file = formData.get("file");
    if (!revisionId) return { ...emptyState, error: "Missing revision." };
    if (!(file instanceof File) || file.size === 0) return { ...emptyState, error: "Choose a file to upload." };
    const bytes = Buffer.from(await file.arrayBuffer());
    const evidence = await uploadEvidenceObject(context, {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes,
      uploadedByUserId: context.userId,
    });
    await attachEvidenceToRevision(context, revisionId, evidence.id, context.userId);
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Evidence uploaded and attached to the draft revision." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function linkExistingEvidenceAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = linkExistingEvidenceFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Choose an evidence object." };
    await attachEvidenceToRevision(context, parsed.data.revisionId, parsed.data.evidenceId, context.userId);
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Existing evidence linked to the draft revision." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function submitRevisionForReviewAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = revisionIdFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: "Missing revision." };
    await submitRevisionForReview(context, parsed.data.revisionId, context.userId);
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Revision submitted for review." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordRevisionReviewAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = revisionIdFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: "Missing revision." };
    await recordRevisionReview(context, parsed.data.revisionId, context.userId);
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Review recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveRevisionAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = approveRevisionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: "Missing revision." };
    await approveRevision(context, parsed.data.revisionId, { actorUserId: context.userId });
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Revision approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function publishRevisionEffectiveAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = publishRevisionEffectiveFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the effective date." };
    await publishRevisionEffective(context, parsed.data.revisionId, {
      actorUserId: context.userId,
      effectiveDate: parsed.data.effectiveDate,
      reviewDueDate: parsed.data.reviewDueDate ?? null,
    });
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Revision published as the effective version." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createSuccessorRevisionAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createSuccessorRevisionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: "Missing document." };
    const successor = await createSuccessorRevision(context, {
      documentId: parsed.data.documentId,
      changeSummary: parsed.data.changeSummary || null,
      actorUserId: context.userId,
    });
    revalidateDocuments(successor.documentId);
    return { ...emptyState, message: `Draft revision ${successor.revisionNumber} created.` };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function discardDraftRevisionAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const revisionId = String(formData.get("revisionId") ?? "");
    const documentId = String(formData.get("documentId") ?? "");
    const result = await discardDraftRevision(context, revisionId, context.userId);
    revalidateDocuments(result.documentAlsoDeleted ? undefined : documentId);
    return { ...emptyState, message: result.documentAlsoDeleted ? "Draft revision and document deleted." : "Draft revision discarded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function unlinkEvidenceAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    await unlinkEvidence(context, String(formData.get("linkId") ?? ""), context.userId);
    revalidateDocuments(String(formData.get("documentId") ?? "") || undefined);
    return { ...emptyState, message: "Evidence link removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function discardUnlinkedEvidenceAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    await discardUnlinkedEvidenceObject(context, String(formData.get("evidenceId") ?? ""), context.userId);
    revalidateDocuments();
    return { ...emptyState, message: "Unlinked evidence discarded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function distributeRevisionAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const parsed = distributeRevisionFormSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the distribution details." };
    if (!parsed.data.audienceMembershipId && !parsed.data.audienceRole) {
      return { ...emptyState, error: "Choose a member or enter a role to distribute to." };
    }
    requirePermission(context, "ems.controlled_document.manage");
    // No dedicated distribution service exists yet; write the record directly,
    // tenant-scoped through the same repository lookup every other document
    // mutation uses, so this can't create a row against a foreign revision.
    const ctx = toTenantRepositoryContext(context);
    const { findTenantControlledDocumentRevision } = await import("@/lib/repositories/documents-repository");
    const revision = await findTenantControlledDocumentRevision(ctx, parsed.data.revisionId);
    if (!revision) return { ...emptyState, error: "That revision could not be found in this organisation." };
    await prisma.documentDistribution.create({
      data: {
        revisionId: revision.id,
        organisationId: context.organisationId,
        audienceMembershipId: parsed.data.audienceMembershipId || null,
        audienceRole: parsed.data.audienceRole || null,
      },
    });
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Distribution recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function acknowledgeDistributionAction(_previous: DocumentsActionState, formData: FormData): Promise<DocumentsActionState> {
  try {
    const context = await requireOrganisationContext();
    const documentId = String(formData.get("documentId") ?? "");
    const distributionId = String(formData.get("distributionId") ?? "");
    if (!distributionId) return { ...emptyState, error: "Missing distribution." };
    const distribution = await prisma.documentDistribution.findFirst({
      where: { id: distributionId, organisationId: context.organisationId },
    });
    if (!distribution) return { ...emptyState, error: "That distribution could not be found in this organisation." };
    await prisma.documentDistribution.update({
      where: { id: distribution.id },
      data: { acknowledgedAt: new Date() },
    });
    revalidateDocuments(documentId);
    return { ...emptyState, message: "Acknowledged." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}
