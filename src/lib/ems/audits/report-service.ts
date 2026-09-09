/**
 * Frozen, issued audit report (task T61, Docs/PHASE6_AUDIT_INCIDENT_CAPA_SPEC.md
 * §§1-3,6-9). `EmsAudit.status` moves `IN_PROGRESS -> REPORT_DRAFT ->
 * REPORT_ISSUED` (spec §2); this module is the only place that writes
 * either of those two statuses (mirrors the "only functions that write X"
 * convention `audit-service.ts` uses for scheduling).
 *
 * `issueAuditReport` is the one-way freeze: it snapshots the audit's
 * checklist/responses/findings into `AuditReportRevision.frozenPayload`,
 * computes a SHA-256 checksum of that exact payload, and takes a matching
 * `AuditCoverageSnapshot` — then flips `status -> ISSUED`. No function in
 * this codebase updates an `ISSUED` `AuditReportRevision` row again
 * (T61 acceptance: "issued report immutable"); `checklist-service.ts` and
 * `finding-service.ts` each independently refuse writes once the report for
 * their audit is ISSUED, so the frozen payload can never drift from what
 * was actually issued.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, hasPermission } from "@/lib/rbac/authorize";
import { findTenantEmsAudit, toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export { TenantOwnershipError };

export class AuditReportError extends Error {}

const PROGRAMME_MANAGE_PERMISSION = "ems.audit_programme.manage" as const;
const AUDIT_PERFORM_PERMISSION = "ems.audit.perform" as const;
const REPORT_ISSUE_PERMISSION = "ems.audit_report.issue" as const;

/** Only the audit's lead auditor, or someone with programme-management authority, may prepare/issue its report. */
async function assertLeadOrManager(context: OrganisationContext, auditId: string): Promise<void> {
  if (hasPermission(context, PROGRAMME_MANAGE_PERMISSION)) return;
  requirePermission(context, AUDIT_PERFORM_PERMISSION);
  const lead = await prisma.auditTeamMember.findFirst({
    where: { organisationId: context.organisationId, auditId, membershipId: context.membershipId, role: "LEAD_AUDITOR" },
    select: { id: true },
  });
  if (!lead) throw new AuditReportError("Only the lead auditor can prepare this audit's report.");
}

// ---------------------------------------------------------------------------
// Per-audit coverage — same dimensions as
// `programme-service.ts#getAuditProgrammeCoverageReport`, scoped to this
// one audit's own EmsAuditScope rows rather than the whole programme.
// ---------------------------------------------------------------------------

async function computeAuditCoverage(ctx: TenantRepositoryContext, auditId: string) {
  const scopes = await prisma.emsAuditScope.findMany({ where: tenantWhere(ctx, { auditId }) });
  return {
    siteIds: [...new Set(scopes.map((s) => s.siteId).filter((v): v is string => Boolean(v)))],
    processIds: [...new Set(scopes.map((s) => s.processId).filter((v): v is string => Boolean(v)))],
    aspectIds: [...new Set(scopes.map((s) => s.aspectId).filter((v): v is string => Boolean(v)))],
    obligationIds: [...new Set(scopes.map((s) => s.obligationId).filter((v): v is string => Boolean(v)))],
    requirementMapIds: [...new Set(scopes.map((s) => s.requirementMapId).filter((v): v is string => Boolean(v)))],
  };
}

// ---------------------------------------------------------------------------
// Draft -> issue
// ---------------------------------------------------------------------------

export async function createAuditReportDraft(context: OrganisationContext, auditId: string, actorUserId: string) {
  await assertLeadOrManager(context, auditId);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status !== "IN_PROGRESS") throw new AuditReportError("Only an audit in progress can move to report drafting.");

  const existing = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
  if (existing) throw new AuditReportError("A report already exists for this audit.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const revision = await tx.auditReportRevision.create({
      data: { organisationId: txCtx.organisationId, auditId: audit.id, preparerUserId: actorUserId },
    });
    await tx.emsAudit.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: audit.id } },
      data: { status: "REPORT_DRAFT" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.report_draft_started",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: "Audit report drafting started.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_PROGRESS" },
      after: { status: "REPORT_DRAFT" },
    });
    return revision;
  });
}

export async function recordReportReview(context: OrganisationContext, auditId: string, reviewerUserId: string) {
  await assertLeadOrManager(context, auditId);
  const ctx = toTenantRepositoryContext(context);
  const revision = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
  if (!revision) throw new TenantOwnershipError();
  if (revision.status !== "DRAFT") throw new AuditReportError("Only a draft report can be reviewed.");

  return prisma.auditReportRevision.update({
    where: { organisationId_id: { organisationId: ctx.organisationId, id: revision.id } },
    data: { reviewerUserId },
  });
}

/**
 * Issues the audit report: freezes the checklist/responses/findings
 * snapshot, computes its checksum, takes the coverage snapshot, and moves
 * both the report and the audit to their terminal ISSUED/REPORT_ISSUED
 * states. Sensitive permission (`ems.audit_report.issue`) — separate from
 * `ems.audit.perform`, which only lets a team member prepare a draft.
 */
export async function issueAuditReport(context: OrganisationContext, auditId: string, actorUserId: string) {
  requirePermission(context, REPORT_ISSUE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  if (audit.status !== "REPORT_DRAFT") throw new AuditReportError("Only an audit with a report in draft can be issued.");

  const revision = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
  if (!revision) throw new TenantOwnershipError();
  if (revision.status === "ISSUED") throw new AuditReportError("This audit's report has already been issued.");

  const [checklistVersion, findings, coverage] = await Promise.all([
    prisma.auditChecklistVersion.findFirst({
      where: tenantWhere(ctx, { auditId }),
      orderBy: { version: "desc" },
      include: { items: { include: { response: true }, orderBy: { sortOrder: "asc" } } },
    }),
    prisma.auditFinding.findMany({ where: tenantWhere(ctx, { auditId }), orderBy: { createdAt: "asc" } }),
    computeAuditCoverage(ctx, auditId),
  ]);

  const frozenPayload = {
    audit: { id: audit.id, title: audit.title, type: audit.type, criteriaSummary: audit.criteriaSummary, scheduledStart: audit.scheduledStart, scheduledEnd: audit.scheduledEnd },
    checklist: checklistVersion
      ? {
          version: checklistVersion.version,
          frozenAt: checklistVersion.frozenAt,
          items: checklistVersion.items.map((item) => ({
            question: item.question,
            criteriaReference: item.criteriaReference,
            expectedEvidence: item.expectedEvidence,
            response: item.response
              ? { result: item.response.result, notes: item.response.notes, auditorMembershipId: item.response.auditorMembershipId, respondedAt: item.response.respondedAt }
              : null,
          })),
        }
      : null,
    findings: findings.map((f) => ({
      id: f.id,
      classification: f.classification,
      status: f.status,
      statement: f.statement,
      objectiveEvidence: f.objectiveEvidence,
      criterionReference: f.criterionReference,
    })),
    issuedAt: new Date().toISOString(),
  };
  const checksumSha256 = createHash("sha256").update(JSON.stringify(frozenPayload)).digest("hex");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const issued = await tx.auditReportRevision.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: revision.id } },
      data: { status: "ISSUED", issuerUserId: actorUserId, issuedAt: new Date(), frozenPayload, checksumSha256 },
    });
    await tx.auditCoverageSnapshot.create({
      data: { organisationId: txCtx.organisationId, auditId: audit.id, reportRevisionId: issued.id, payload: coverage },
    });
    await tx.emsAudit.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: audit.id } },
      data: { status: "REPORT_ISSUED" },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_audit.report_issued",
      resourceType: "ems_audit",
      resourceId: audit.id,
      summary: "Audit report issued.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "REPORT_DRAFT" },
      after: { status: "REPORT_ISSUED", checksumSha256 },
    });
    return issued;
  });
}

/**
 * Non-disclosing read for the report download route: returns null for a
 * missing id, a foreign-tenant id, or a report that has not yet been
 * issued — all three are indistinguishable to the caller, matching the T22
 * evidence-download convention (`readEvidenceObjectBytes`).
 */
export async function getIssuedAuditReport(context: OrganisationContext, auditId: string) {
  requirePermission(context, "ems.view");
  try {
    const ctx = toTenantRepositoryContext(context);
    const audit = await findTenantEmsAudit(ctx, auditId);
    if (!audit) return null;
    const revision = await prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
    if (!revision || revision.status !== "ISSUED") return null;
    return revision;
  } catch {
    return null;
  }
}

export async function getAuditReportRevision(context: OrganisationContext, auditId: string) {
  requirePermission(context, "ems.view");
  const ctx = toTenantRepositoryContext(context);
  const audit = await findTenantEmsAudit(ctx, auditId);
  if (!audit) throw new TenantOwnershipError();
  return prisma.auditReportRevision.findFirst({ where: tenantWhere(ctx, { auditId }) });
}
