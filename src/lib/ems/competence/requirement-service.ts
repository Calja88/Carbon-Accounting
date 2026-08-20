/**
 * Competence requirement versioning and scope mapping (task T70,
 * Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §§2-3). Depends on T23
 * (EmsProgramme/context foundation) and T33 (OperationalControl), both
 * already on this branch.
 *
 * Fixed decisions this module enforces (spec §2):
 *  - state machine is DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED, narrower
 *    than the T44/T50 obligation/objective state machines (no IN_REVIEW
 *    step) — the catalogue has only one competence-domain manage permission
 *    (`ems.competence.manage`), not a separate approve permission, so there
 *    is no maker-checker/four-eyes step to enforce here, unlike
 *    ComplianceObligationVersion/EnvironmentalObjectiveVersion;
 *  - `CompetenceRequirement.activeVersionId` only ever moves inside
 *    `activateCompetenceRequirementVersion` — approving a version does not
 *    itself activate it, so a requirement can be approved ahead of its
 *    effective date without becoming the live requirement yet;
 *  - a version that has left DRAFT is never edited in place — the
 *    migration's `competence_requirement_version_immutable_once_approved`
 *    trigger is defence-in-depth, mirroring the T44/T50 convention exactly.
 *    `createSuccessorCompetenceRequirementVersion` is the only way to change
 *    an approved/active/superseded version's content;
 *  - `CompetenceRequirementScope` maps a version to exactly one of
 *    role/process/aspect/control/obligation-version/emergency-scenario per
 *    row (spec §3) — `validateScopes` rejects a row with zero or more than
 *    one target set, and checks same-Organisation ownership of whichever
 *    target is referenced.
 */

import type { CompetenceRequirementScopeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantCompetenceRequirement,
  findTenantCompetenceRequirementVersion,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";

export { TenantOwnershipError };

export class CompetenceRequirementError extends Error {}

const MANAGE_PERMISSION = "ems.competence.manage" as const;
const VIEW_PERMISSION = "ems.competence.view" as const;

export interface CompetenceRequirementScopeInput {
  scopeType: CompetenceRequirementScopeType;
  roleId?: string | null;
  processId?: string | null;
  aspectId?: string | null;
  controlId?: string | null;
  obligationVersionId?: string | null;
  emergencyScenarioId?: string | null;
  emergencyRoleLabel?: string | null;
}

export interface CompetenceRequirementDraftFields {
  title: string;
  description: string;
  renewalRule?: string | null;
  acceptableEvidence?: string | null;
  scopes: CompetenceRequirementScopeInput[];
}

export interface CreateCompetenceRequirementInput extends CompetenceRequirementDraftFields {
  requirementKey: string;
  actorUserId: string;
}

export interface UpdateCompetenceRequirementVersionDraftInput extends CompetenceRequirementDraftFields {
  actorUserId: string;
}

export interface CreateSuccessorCompetenceRequirementVersionInput extends CompetenceRequirementDraftFields {
  actorUserId: string;
  revisionRationale: string;
}

// ---------------------------------------------------------------------------
// Scope validation
// ---------------------------------------------------------------------------

async function validateScopes(context: OrganisationContext, scopes: CompetenceRequirementScopeInput[]) {
  const ctx = toTenantRepositoryContext(context);
  const validated: CompetenceRequirementScopeInput[] = [];

  for (const scope of scopes) {
    const roleId = scope.roleId || null;
    const processId = scope.processId || null;
    const aspectId = scope.aspectId || null;
    const controlId = scope.controlId || null;
    const obligationVersionId = scope.obligationVersionId || null;
    const emergencyScenarioId = scope.emergencyScenarioId || null;
    const emergencyRoleLabel = scope.emergencyRoleLabel?.trim() || null;

    const targetCount = [roleId, processId, aspectId, controlId, obligationVersionId, emergencyScenarioId, emergencyRoleLabel].filter(
      Boolean,
    ).length;
    if (targetCount !== 1) {
      throw new CompetenceRequirementError("Each scope must identify exactly one role, process, aspect, control, obligation version, or emergency role.");
    }

    if (scope.scopeType === "ROLE" && roleId) {
      const row = await prisma.roleDefinition.findFirst({ where: tenantWhere(ctx, { id: roleId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (scope.scopeType === "PROCESS" && processId) {
      const row = await prisma.activityProcess.findFirst({ where: tenantWhere(ctx, { id: processId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (scope.scopeType === "ASPECT" && aspectId) {
      const row = await prisma.environmentalAspect.findFirst({ where: tenantWhere(ctx, { id: aspectId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (scope.scopeType === "CONTROL" && controlId) {
      const row = await prisma.operationalControl.findFirst({ where: tenantWhere(ctx, { id: controlId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (scope.scopeType === "OBLIGATION" && obligationVersionId) {
      const row = await prisma.complianceObligationVersion.findFirst({ where: tenantWhere(ctx, { id: obligationVersionId }) });
      if (!row) throw new TenantOwnershipError();
    } else if (scope.scopeType === "EMERGENCY_ROLE" && (emergencyScenarioId || emergencyRoleLabel)) {
      if (emergencyScenarioId) {
        const row = await prisma.emergencyScenario.findFirst({ where: tenantWhere(ctx, { id: emergencyScenarioId }) });
        if (!row) throw new TenantOwnershipError();
      }
    } else {
      throw new CompetenceRequirementError("Scope type does not match the identifying field supplied.");
    }

    validated.push({ scopeType: scope.scopeType, roleId, processId, aspectId, controlId, obligationVersionId, emergencyScenarioId, emergencyRoleLabel });
  }

  return validated;
}

function assertRequiredFields(fields: CompetenceRequirementDraftFields) {
  if (!fields.title.trim()) throw new CompetenceRequirementError("Enter a title.");
  if (!fields.description.trim()) throw new CompetenceRequirementError("Enter a description.");
}

function draftData(fields: CompetenceRequirementDraftFields) {
  return {
    title: fields.title.trim(),
    description: fields.description.trim(),
    renewalRule: fields.renewalRule?.trim() || null,
    acceptableEvidence: fields.acceptableEvidence?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const versionInclude = {
  scopes: true,
} as const;

export async function listCompetenceRequirements(context: OrganisationContext) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  return prisma.competenceRequirement.findMany({
    where: tenantWhere(ctx, {}),
    include: {
      activeVersion: true,
      versions: { orderBy: { version: "desc" }, include: versionInclude },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCompetenceRequirementVersion(context: OrganisationContext, versionId: string) {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantCompetenceRequirementVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  return prisma.competenceRequirementVersion.findUnique({
    where: { id: version.id },
    include: { requirement: true, ...versionInclude },
  });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export async function createCompetenceRequirement(context: OrganisationContext, input: CreateCompetenceRequirementInput) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  if (!input.requirementKey.trim()) throw new CompetenceRequirementError("Enter a requirement key.");
  const scopes = await validateScopes(context, input.scopes);
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const requirement = await tx.competenceRequirement.create({
      data: { organisationId: txCtx.organisationId, requirementKey: input.requirementKey.trim() },
    });

    const version = await tx.competenceRequirementVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        requirementId: requirement.id,
        version: 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_requirement_version.created",
      resourceType: "competence_requirement_version",
      resourceId: version.id,
      summary: `Competence requirement drafted: ${input.title}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { requirementId: requirement.id, title: input.title },
    });

    return { requirement, version };
  });
}

// ---------------------------------------------------------------------------
// Draft editing (DRAFT only)
// ---------------------------------------------------------------------------

export async function updateCompetenceRequirementVersionDraft(
  context: OrganisationContext,
  versionId: string,
  input: UpdateCompetenceRequirementVersionDraftInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantCompetenceRequirementVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new CompetenceRequirementError("Only a draft version can be edited.");
  const scopes = await validateScopes(context, input.scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    await tx.competenceRequirementScope.deleteMany({ where: tenantWhere(txCtx, { requirementVersionId: version.id }) });

    const updated = await tx.competenceRequirementVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: {
        ...draftData(input),
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_requirement_version.created",
      resourceType: "competence_requirement_version",
      resourceId: version.id,
      summary: "Draft competence requirement version updated.",
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { title: input.title },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Approval / activation
// ---------------------------------------------------------------------------

export async function approveCompetenceRequirementVersion(context: OrganisationContext, versionId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantCompetenceRequirementVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "DRAFT") throw new CompetenceRequirementError("Only a draft version can be approved.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.competenceRequirementVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: new Date() },
    });
    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_requirement_version.approved",
      resourceType: "competence_requirement_version",
      resourceId: version.id,
      summary: "Competence requirement version approved.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "APPROVED" },
    });
    return updated;
  });
}

/**
 * Activates an APPROVED version, moves the requirement's active pointer,
 * and supersedes whatever version was previously ACTIVE — all in one
 * transaction, mirroring `approveEnvironmentalObjectiveVersion` (T50).
 */
export async function activateCompetenceRequirementVersion(context: OrganisationContext, versionId: string, actorUserId: string) {
  requirePermission(context, MANAGE_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantCompetenceRequirementVersion(ctx, versionId);
  if (!version) throw new TenantOwnershipError();
  if (version.status !== "APPROVED") throw new CompetenceRequirementError("Only an approved version can be activated.");

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const requirement = await tx.competenceRequirement.findFirst({ where: tenantWhere(txCtx, { id: version.requirementId }) });
    if (!requirement) throw new TenantOwnershipError();

    if (requirement.activeVersionId && requirement.activeVersionId !== version.id) {
      const previousActive = await tx.competenceRequirementVersion.findFirst({
        where: tenantWhere(txCtx, { id: requirement.activeVersionId }),
      });
      if (previousActive) {
        await tx.competenceRequirementVersion.update({
          where: { organisationId_id: { organisationId: txCtx.organisationId, id: previousActive.id } },
          data: { status: "SUPERSEDED" },
        });
        await recordAuditEvent(tx, txCtx, {
          eventType: "competence_requirement_version.superseded",
          resourceType: "competence_requirement_version",
          resourceId: previousActive.id,
          summary: "Competence requirement version superseded by a newly activated version.",
          actorUserId,
          correlationId: txCtx.correlationId,
          source: "web-app",
          before: { status: previousActive.status },
          after: { status: "SUPERSEDED" },
        });
      }
    }

    const updated = await tx.competenceRequirementVersion.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: version.id } },
      data: { status: "ACTIVE" },
    });

    await tx.competenceRequirement.update({
      where: { organisationId_id: { organisationId: txCtx.organisationId, id: requirement.id } },
      data: { activeVersionId: version.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_requirement_version.activated",
      resourceType: "competence_requirement_version",
      resourceId: version.id,
      summary: "Competence requirement version activated.",
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "APPROVED" },
      after: { status: "ACTIVE" },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Successor versions
// ---------------------------------------------------------------------------

export async function createSuccessorCompetenceRequirementVersion(
  context: OrganisationContext,
  requirementId: string,
  input: CreateSuccessorCompetenceRequirementVersionInput,
) {
  requirePermission(context, MANAGE_PERMISSION);
  assertRequiredFields(input);
  if (!input.revisionRationale.trim()) throw new CompetenceRequirementError("Enter a revision rationale.");
  const ctx = toTenantRepositoryContext(context);
  const requirement = await findTenantCompetenceRequirement(ctx, requirementId);
  if (!requirement) throw new TenantOwnershipError();
  const scopes = await validateScopes(context, input.scopes);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.competenceRequirementVersion.findFirst({
      where: tenantWhere(txCtx, { requirementId: requirement.id }),
      orderBy: { version: "desc" },
    });
    if (!latest) throw new CompetenceRequirementError("Requirement has no versions to replace.");
    if (latest.status === "DRAFT") {
      throw new CompetenceRequirementError(`Version ${latest.version} is still DRAFT — edit it directly instead of creating a successor.`);
    }

    const successor = await tx.competenceRequirementVersion.create({
      data: {
        organisationId: txCtx.organisationId,
        requirementId: requirement.id,
        version: latest.version + 1,
        ...draftData(input),
        preparedByUserId: input.actorUserId,
        revisionRationale: input.revisionRationale.trim(),
        supersedesVersionId: latest.id,
        scopes: { create: scopes.map((scope) => ({ organisationId: txCtx.organisationId, ...scope })) },
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "competence_requirement_version.created",
      resourceType: "competence_requirement_version",
      resourceId: successor.id,
      summary: `Successor version ${successor.version} created, replacing version ${latest.version}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { version: successor.version, supersedesVersionId: latest.id },
    });

    return successor;
  });
}
