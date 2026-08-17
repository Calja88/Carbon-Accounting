/**
 * Other requirements and manual legal sources (task T46,
 * Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §§1-2,5,9). CRUD and controlled
 * evidence for `OtherRequirementSource` — the manually entered permit,
 * consent, regulator notice, contract, customer requirement or voluntary
 * commitment record a competent user creates instead of waiting for the
 * T41/T42 legislation.gov.uk provider sync to surface a change event.
 *
 * This module only ever manages the source record itself (type, issuing
 * party, reference, dates, evidence, status). It never assesses
 * applicability, creates an obligation, or decides anything about
 * compliance — once a source exists here, `applicability-service.ts`'s
 * `createApplicabilityAssessment` accepts its id exactly like a
 * `LegalInstrument` id (spec §9 "records follow identical applicability/
 * approval/version rules"), and everything downstream of that is T43/T44's
 * existing, unmodified state machine.
 *
 * Reuses `ems.legal_source.manage` (catalogued at T40/T42 time for "manage
 * legal/compliance register sources" but, until now, only wired to the T42
 * provider-health page) rather than adding a new permission code — a
 * manual source is exactly that catalogue entry's description, and the
 * template grant already matches T43's `ems.applicability.assess` set
 * (Sustainability Lead, EMS Contributor, Site Manager), the same
 * "competent user" population who assesses applicability.
 */

import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { findTenantOtherRequirementSource, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";
import type { OtherRequirementSourceStatus, OtherRequirementSourceType } from "@prisma/client";

export { TenantOwnershipError };

export class OtherRequirementSourceError extends Error {}

const MANAGE_PERMISSION = "ems.legal_source.manage" as const;

export interface OtherRequirementSourceFields {
  type: OtherRequirementSourceType;
  title: string;
  issuingParty: string;
  reference?: string | null;
  description?: string | null;
  ownerMembershipId: string;
  issuedAt?: Date | null;
  effectiveFrom?: Date | null;
  expiryDate?: Date | null;
  nextReviewAt?: Date | null;
}

export interface CreateOtherRequirementSourceInput extends OtherRequirementSourceFields {
  actorUserId: string;
}

export interface UpdateOtherRequirementSourceInput extends OtherRequirementSourceFields {
  actorUserId: string;
}

function assertFields(fields: Pick<OtherRequirementSourceFields, "title" | "issuingParty">) {
  if (!fields.title.trim()) throw new OtherRequirementSourceError("Enter a title.");
  if (!fields.issuingParty.trim()) throw new OtherRequirementSourceError("Enter the issuing party or authority.");
}

async function validateOwner(context: OrganisationContext, ownerMembershipId: string) {
  const owner = await prisma.organisationMembership.findFirst({
    where: { id: ownerMembershipId, organisationId: context.organisationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new TenantOwnershipError();
}

export async function listOtherRequirementSources(context: OrganisationContext) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.otherRequirementSource.findMany({
    where: tenantWhere(ctx, {}),
    include: { owner: { include: { user: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOtherRequirementSource(context: OrganisationContext, sourceId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const source = await findTenantOtherRequirementSource(ctx, sourceId);
  if (!source) throw new TenantOwnershipError();
  return source;
}

export async function createOtherRequirementSource(context: OrganisationContext, input: CreateOtherRequirementSourceInput) {
  requirePermission(context, MANAGE_PERMISSION);
  assertFields(input);
  await validateOwner(context, input.ownerMembershipId);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const source = await tx.otherRequirementSource.create({
      data: {
        organisationId: txCtx.organisationId,
        type: input.type,
        title: input.title.trim(),
        issuingParty: input.issuingParty.trim(),
        reference: input.reference || null,
        description: input.description || null,
        ownerMembershipId: input.ownerMembershipId,
        issuedAt: input.issuedAt ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        expiryDate: input.expiryDate ?? null,
        nextReviewAt: input.nextReviewAt ?? null,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "other_requirement_source.created",
      resourceType: "other_requirement_source",
      resourceId: source.id,
      summary: `Other requirement source recorded: ${input.title}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { type: input.type, issuingParty: input.issuingParty, title: input.title },
    });
    return source;
  });
}

/** Edits an other-requirement source's own fields. Only while ACTIVE — once EXPIRED/SUPERSEDED/WITHDRAWN, a record is closed history, not a live source to keep editing. */
export async function updateOtherRequirementSource(
  context: OrganisationContext,
  sourceId: string,
  input: UpdateOtherRequirementSourceInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertFields(input);
  const ctx = toTenantRepositoryContext(context);
  const source = await findTenantOtherRequirementSource(ctx, sourceId);
  if (!source) throw new TenantOwnershipError();
  if (source.status !== "ACTIVE") throw new OtherRequirementSourceError("Only an active source can be edited.");
  await validateOwner(context, input.ownerMembershipId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.otherRequirementSource.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: source.id } },
      data: {
        type: input.type,
        title: input.title.trim(),
        issuingParty: input.issuingParty.trim(),
        reference: input.reference || null,
        description: input.description || null,
        ownerMembershipId: input.ownerMembershipId,
        issuedAt: input.issuedAt ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        expiryDate: input.expiryDate ?? null,
        nextReviewAt: input.nextReviewAt ?? null,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "other_requirement_source.updated",
      resourceType: "other_requirement_source",
      resourceId: source.id,
      summary: `Other requirement source updated: ${input.title}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { type: input.type, issuingParty: input.issuingParty, title: input.title },
    });
    return updated;
  });
}

const STATUS_TRANSITIONS: Record<OtherRequirementSourceStatus, OtherRequirementSourceStatus[]> = {
  ACTIVE: ["EXPIRED", "SUPERSEDED", "WITHDRAWN"],
  EXPIRED: [],
  SUPERSEDED: [],
  WITHDRAWN: [],
};

/** Closes an other-requirement source out of ACTIVE. Never deletes the row — it stays visible, reviewable history (mirrors ApplicabilityAssessment/ComplianceObligationVersion: nothing in this module ever removes a record). */
export async function changeOtherRequirementSourceStatus(
  context: OrganisationContext,
  sourceId: string,
  status: OtherRequirementSourceStatus,
  actorUserId: string,
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const source = await findTenantOtherRequirementSource(ctx, sourceId);
  if (!source) throw new TenantOwnershipError();
  const allowed = STATUS_TRANSITIONS[source.status as OtherRequirementSourceStatus] ?? [];
  if (!allowed.includes(status)) {
    throw new OtherRequirementSourceError(`Cannot move an other-requirement source from ${source.status} to ${status}.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.otherRequirementSource.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: source.id } },
      data: { status },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "other_requirement_source.status_changed",
      resourceType: "other_requirement_source",
      resourceId: source.id,
      summary: `Other requirement source moved from ${source.status} to ${status}.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: source.status },
      after: { status },
    });
    return updated;
  });
}

export async function attachEvidenceToOtherRequirementSource(
  context: OrganisationContext,
  input: { sourceId: string; evidenceId: string; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const source = await findTenantOtherRequirementSource(ctx, input.sourceId);
  if (!source) throw new TenantOwnershipError();
  return linkEvidence(context, {
    evidenceId: input.evidenceId,
    resourceType: "other_requirement_source",
    resourceId: source.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
}

export async function uploadEvidenceToOtherRequirementSource(
  context: OrganisationContext,
  input: { sourceId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const source = await findTenantOtherRequirementSource(ctx, input.sourceId);
  if (!source) throw new TenantOwnershipError();
  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "other_requirement_source",
    resourceId: source.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}
