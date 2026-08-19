/**
 * Audit findings (task T61, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-3,6-9). State machine per spec §2:
 *   DRAFT -> CONFIRMED -> ACTION_REQUIRED / ACCEPTED_OBSERVATION -> CLOSED
 *
 * `classification` is a stable, generic category (never a
 * certification-body-specific label — spec §3) set explicitly by the caller
 * on every write; nothing here infers or defaults it, and confirming a
 * finding never changes it, so a finding can never carry an automatic
 * certification judgement (T61 acceptance).
 */

import { prisma } from "@/lib/prisma";
import type { AuditFindingClassification } from "@prisma/client";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, hasPermission } from "@/lib/rbac/authorize";
import {
  findTenantEmsAudit,
  findTenantAuditFinding,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { AuditEventType } from "@/lib/audit/types";
import { linkEvidence, uploadEvidenceObject } from "@/lib/documents/evidence-service";

export { TenantOwnershipError };

export class AuditFindingError extends Error {}

const PROGRAMME_MANAGE_PERMISSION = "ems.audit_programme.manage" as const;
const AUDIT_PERFORM_PERMISSION = "ems.audit.perform" as const;

/** Same access rule as `checklist-service.ts#assertAuditExecutionAccess` — see that module for rationale. */
async function assertAuditExecutionAccess(context: OrganisationContext, auditId: string): Promise<void> {
  if (hasPermission(context, PROGRAMME_MANAGE_PERMISSION)) return;
  requirePermission(context, AUDIT_PERFORM_PERMISSION);
  const member = await prisma.auditTeamMember.findFirst({
    where: { organisationId: context.organisationId, auditId, membershipId: context.membershipId },
    select: { id: true },
  });
  if (!member) throw new AuditFindingError("Only an assigned team member can work on this audit.");
}

/** Only a LEAD_AUDITOR on the audit team, or someone with programme-management authority, may confirm/close a finding. */
async function assertConfirmationAuthority(context: OrganisationContext, auditId: string): Promise<void> {
  if (hasPermission(context, PROGRAMME_MANAGE_PERMISSION)) return;
  requirePermission(context, AUDIT_PERFORM_PERMISSION);
  const lead = await prisma.auditTeamMember.findFirst({
    where: { organisationId: context.organisationId, auditId, membershipId: context.membershipId, role: "LEAD_AUDITOR" },
    select: { id: true },
  });
  if (!lead) throw new AuditFindingError("Only the lead auditor can confirm or close a finding.");
}

async function assertReportNotIssued(context: OrganisationContext, auditId: string) {
  const ctx = toTenantRepositoryContext(context);
  const report = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
  if (report && report.status === "ISSUED") {
    throw new AuditFindingError("This audit's report has been issued; its findings can no longer change.");
  }
}

export interface CreateAuditFindingInput {
  classification: AuditFindingClassification;
  statement: string;
  objectiveEvidence?: string | null;
  criterionReference?: string | null;
  scopeRef?: { resourceType: string; resourceId: string } | null;
  questionResponseId?: string | null;
  ownerMembershipId?: string | null;
  dueDate?: Date | null;
  actorUserId: string;
}

export async function createAuditFinding(context: OrganisationContext, auditId: string, input: CreateAuditFindingInput) {
  if (!input.statement.trim()) throw new AuditFindingError("Enter the finding statement.");
  await assertAuditExecutionAccess(context, auditId);
  await assertReportNotIssued(context, auditId);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();

  if (input.ownerMembershipId) {
    const owner = await prisma.organisationMembership.findFirst({
      where: { id: input.ownerMembershipId, organisationId: ctx.organisationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!owner) throw new TenantOwnershipError();
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const finding = await tx.auditFinding.create({
      data: {
        organisationId: txCtx.organisationId,
        auditId: audit.id,
        questionResponseId: input.questionResponseId ?? null,
        classification: input.classification,
        statement: input.statement.trim(),
        objectiveEvidence: input.objectiveEvidence?.trim() || null,
        criterionReference: input.criterionReference?.trim() || null,
        scopeRef: input.scopeRef ?? undefined,
        ownerMembershipId: input.ownerMembershipId ?? null,
        dueDate: input.dueDate ?? null,
        createdByUserId: input.actorUserId,
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "audit_finding.created",
      resourceType: "audit_finding",
      resourceId: finding.id,
      summary: `Finding raised (${input.classification}).`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { auditId: audit.id, classification: input.classification },
    });
    return finding;
  });
}

export async function listAuditFindings(context: OrganisationContext, auditId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  return prisma.auditFinding.findMany({
    where: tenantWhere(ctx, { auditId }),
    orderBy: { createdAt: "asc" },
  });
}

async function transitionFinding(
  context: OrganisationContext,
  findingId: string,
  input: { to: "CONFIRMED" | "ACTION_REQUIRED" | "ACCEPTED_OBSERVATION" | "CLOSED"; from: string[]; actorUserId: string; eventType: AuditEventType },
) {
  const ctx = toTenantRepositoryContext(context);
  const finding = await findTenantAuditFinding(ctx, findingId);
  if (!finding) throw new TenantOwnershipError();
  await assertConfirmationAuthority(context, finding.auditId);
  await assertReportNotIssued(context, finding.auditId);
  if (!input.from.includes(finding.status)) {
    throw new AuditFindingError(`A finding in status ${finding.status} cannot move to ${input.to}.`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.auditFinding.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: finding.id } },
      data: {
        status: input.to,
        ...(input.to === "CONFIRMED" ? { confirmedAt: new Date(), confirmedByUserId: input.actorUserId } : {}),
      },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: input.eventType,
      resourceType: "audit_finding",
      resourceId: finding.id,
      summary: `Finding moved from ${finding.status} to ${input.to}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: finding.status },
      after: { status: input.to },
    });
    return updated;
  });
}

export async function confirmAuditFinding(context: OrganisationContext, findingId: string, actorUserId: string) {
  return transitionFinding(context, findingId, { to: "CONFIRMED", from: ["DRAFT"], actorUserId, eventType: "audit_finding.confirmed" });
}

export async function requireActionOnAuditFinding(context: OrganisationContext, findingId: string, actorUserId: string) {
  return transitionFinding(context, findingId, { to: "ACTION_REQUIRED", from: ["CONFIRMED"], actorUserId, eventType: "audit_finding.action_required" });
}

export async function acceptAuditFindingAsObservation(context: OrganisationContext, findingId: string, actorUserId: string) {
  return transitionFinding(context, findingId, { to: "ACCEPTED_OBSERVATION", from: ["CONFIRMED"], actorUserId, eventType: "audit_finding.accepted_observation" });
}

export async function closeAuditFinding(context: OrganisationContext, findingId: string, actorUserId: string) {
  return transitionFinding(context, findingId, {
    to: "CLOSED",
    from: ["ACTION_REQUIRED", "ACCEPTED_OBSERVATION"],
    actorUserId,
    eventType: "audit_finding.closed",
  });
}

export async function uploadEvidenceToFinding(
  context: OrganisationContext,
  input: { findingId: string; fileName: string; mimeType: string; bytes: Buffer; purpose?: string | null; actorUserId: string },
) {
  const ctx = toTenantRepositoryContext(context);
  const finding = await findTenantAuditFinding(ctx, input.findingId);
  if (!finding) throw new TenantOwnershipError();
  await assertAuditExecutionAccess(context, finding.auditId);

  const evidence = await uploadEvidenceObject(context, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes: input.bytes,
    uploadedByUserId: input.actorUserId,
  });
  await linkEvidence(context, {
    evidenceId: evidence.id,
    resourceType: "audit_finding",
    resourceId: finding.id,
    purpose: input.purpose,
    linkedByUserId: input.actorUserId,
  });
  return evidence;
}
