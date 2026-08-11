/**
 * EMS programme and scope lifecycle service (task T23,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §§1-3 "EMS root and scope").
 *
 * State machines (spec §2):
 *   EmsProgramme:    DRAFT -> ACTIVE -> SUSPENDED -> CLOSED
 *   EmsScopeVersion: DRAFT -> IN_REVIEW -> APPROVED -> SUPERSEDED
 *
 * Transitions are explicit, permission-checked functions here — never
 * generic CRUD — and every one commits its domain write and audit event
 * atomically, following the T20/T22 pattern exactly
 * (document-control-service.ts).
 *
 * Immutability: `prisma/migrations/20260811170000_add_ems_programme_foundation`
 * adds a `BEFORE UPDATE` trigger blocking any boundary-defining field change
 * and any backward status move once a scope version has left
 * DRAFT/IN_REVIEW, mirroring the T22 controlled-document-revision trigger.
 * The checks in this module are the primary defence; the trigger is
 * defence-in-depth. Only one ACTIVE programme may exist per organisation —
 * enforced by a partial unique index, not application logic, so a race
 * between two activations cannot both win.
 *
 * "Site must belong to an included Entity" (spec §3) is enforced here: a
 * Site can only be added to a scope version's boundary once its Entity has
 * already been added to the same version.
 */

import type { EmsCertificationIntent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import {
  findTenantEmsProgramme,
  findTenantEmsScopeVersion,
  toTenantRepositoryContext,
} from "@/lib/repositories/ems-repository";
import { tenantWhere, TenantOwnershipError, assertOwned } from "@/lib/repositories/tenant-scope";
import { runInTenantTransaction } from "@/lib/repositories/transaction";
import { recordAuditEvent } from "@/lib/repositories/audit-repository";
import { enqueueTenantJob } from "@/lib/jobs/outbox-service";

export { TenantOwnershipError };

export class EmsProgrammeError extends Error {}

const PROGRAMME_STATUS_TOPIC = "ems.programme_status_changed";
const SCOPE_VERSION_STATUS_TOPIC = "ems.scope_version_status_changed";

/** Prisma's unique-constraint violation code — used to detect the "one ACTIVE programme per organisation" race. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getEmsProgramme(context: OrganisationContext, programmeId: string) {
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, programmeId);
  return prisma.emsProgramme.findUnique({
    where: { id: programme.id },
    include: { currentScopeVersion: true },
  });
}

export async function listEmsProgrammes(context: OrganisationContext) {
  const ctx = toTenantRepositoryContext(context);
  return prisma.emsProgramme.findMany({
    where: tenantWhere(ctx, {}),
    orderBy: { createdAt: "desc" },
  });
}

export async function getScopeVersion(context: OrganisationContext, scopeVersionId: string, expectedProgrammeId?: string) {
  const ctx = toTenantRepositoryContext(context);
  return findTenantEmsScopeVersion(ctx, scopeVersionId, expectedProgrammeId);
}

// ---------------------------------------------------------------------------
// Programme creation and lifecycle
// ---------------------------------------------------------------------------

export interface CreateEmsProgrammeInput {
  name: string;
  standardsProfile: string;
  standardsProfileVersion: string;
  certificationIntent?: EmsCertificationIntent;
  ownerMembershipId?: string | null;
  actorUserId: string;
}

export async function createEmsProgramme(context: OrganisationContext, input: CreateEmsProgrammeInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const programme = await tx.emsProgramme.create({
      data: {
        organisationId: txCtx.organisationId,
        name: input.name,
        standardsProfile: input.standardsProfile,
        standardsProfileVersion: input.standardsProfileVersion,
        certificationIntent: input.certificationIntent ?? "NONE",
        ownerMembershipId: input.ownerMembershipId ?? null,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_programme.created",
      resourceType: "ems_programme",
      resourceId: programme.id,
      summary: `EMS programme "${input.name}" created.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { name: input.name, standardsProfile: input.standardsProfile, standardsProfileVersion: input.standardsProfileVersion },
    });

    return programme;
  });
}

async function transitionProgrammeStatus(
  context: OrganisationContext,
  programmeId: string,
  options: {
    from: ("DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED")[];
    to: "DRAFT" | "ACTIVE" | "SUSPENDED" | "CLOSED";
    eventType: "ems_programme.activated" | "ems_programme.suspended" | "ems_programme.closed";
    summary: string;
    actorUserId: string;
  },
) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, programmeId);
  if (!options.from.includes(programme.status)) {
    throw new EmsProgrammeError(
      `Programme must be ${options.from.join(" or ")} to move to ${options.to} (it is ${programme.status}).`,
    );
  }

  try {
    return await runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
      const updated = await tx.emsProgramme.update({
        where: { id: programme.id, organisationId: txCtx.organisationId },
        data: { status: options.to },
      });

      await recordAuditEvent(tx, txCtx, {
        eventType: options.eventType,
        resourceType: "ems_programme",
        resourceId: programme.id,
        summary: options.summary,
        actorUserId: options.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: programme.status },
        after: { status: options.to },
      });

      await enqueueTenantJob(tx, txCtx, {
        topic: PROGRAMME_STATUS_TOPIC,
        payload: { programmeId: programme.id, status: options.to },
        idempotencyKey: `${programme.id}:${options.to}:${updated.updatedAt.toISOString()}`,
        correlationId: txCtx.correlationId,
        source: "web-app",
      });

      return updated;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new EmsProgrammeError("This organisation already has an active EMS programme.");
    }
    throw error;
  }
}

export async function activateEmsProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  return transitionProgrammeStatus(context, programmeId, {
    from: ["DRAFT", "SUSPENDED"],
    to: "ACTIVE",
    eventType: "ems_programme.activated",
    summary: "EMS programme activated.",
    actorUserId,
  });
}

export async function suspendEmsProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  return transitionProgrammeStatus(context, programmeId, {
    from: ["ACTIVE"],
    to: "SUSPENDED",
    eventType: "ems_programme.suspended",
    summary: "EMS programme suspended.",
    actorUserId,
  });
}

export async function closeEmsProgramme(context: OrganisationContext, programmeId: string, actorUserId: string) {
  return transitionProgrammeStatus(context, programmeId, {
    from: ["DRAFT", "ACTIVE", "SUSPENDED"],
    to: "CLOSED",
    eventType: "ems_programme.closed",
    summary: "EMS programme closed.",
    actorUserId,
  });
}

// ---------------------------------------------------------------------------
// Scope versions
// ---------------------------------------------------------------------------

export interface CreateScopeVersionInput {
  programmeId: string;
  statement: string;
  exclusions?: string | null;
  exclusionsRationale?: string | null;
  actorUserId: string;
}

/** Creates the first scope version (revision 1) of a programme. Use `createSuccessorScopeVersion` to replace an already-approved version. */
export async function createScopeVersion(context: OrganisationContext, input: CreateScopeVersionInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const existing = await tx.emsScopeVersion.findFirst({
      where: { organisationId: txCtx.organisationId, programmeId: programme.id },
      orderBy: { versionNumber: "desc" },
    });
    if (existing) {
      throw new EmsProgrammeError("Programme already has a scope version. Use createSuccessorScopeVersion to replace it.");
    }

    const version = await tx.emsScopeVersion.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        versionNumber: 1,
        statement: input.statement,
        exclusions: input.exclusions ?? null,
        exclusionsRationale: input.exclusionsRationale ?? null,
        preparedByUserId: input.actorUserId,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_scope_version.created",
      resourceType: "ems_scope_version",
      resourceId: version.id,
      summary: `Scope version 1 created for programme "${programme.name}".`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { versionNumber: 1 },
    });

    return version;
  });
}

export interface CreateSuccessorScopeVersionInput {
  programmeId: string;
  statement: string;
  exclusions?: string | null;
  exclusionsRationale?: string | null;
  actorUserId: string;
}

/** Creates a new DRAFT scope version that will supersede the programme's current approved version once approved. */
export async function createSuccessorScopeVersion(context: OrganisationContext, input: CreateSuccessorScopeVersionInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const latest = await tx.emsScopeVersion.findFirst({
      where: { organisationId: txCtx.organisationId, programmeId: programme.id },
      orderBy: { versionNumber: "desc" },
    });
    if (!latest) {
      throw new EmsProgrammeError("Programme has no scope version to replace. Use createScopeVersion instead.");
    }
    if (latest.status === "DRAFT" || latest.status === "IN_REVIEW") {
      throw new EmsProgrammeError(
        `Scope version ${latest.versionNumber} is still ${latest.status} — edit it directly instead of creating a successor.`,
      );
    }

    const successor = await tx.emsScopeVersion.create({
      data: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        versionNumber: latest.versionNumber + 1,
        statement: input.statement,
        exclusions: input.exclusions ?? null,
        exclusionsRationale: input.exclusionsRationale ?? null,
        preparedByUserId: input.actorUserId,
        supersedesVersionId: latest.id,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_scope_version.created",
      resourceType: "ems_scope_version",
      resourceId: successor.id,
      summary: `Successor scope version ${successor.versionNumber} created, replacing version ${latest.versionNumber}.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { versionNumber: successor.versionNumber, supersedesVersionId: latest.id },
    });

    return successor;
  });
}

export async function submitScopeVersionForReview(context: OrganisationContext, scopeVersionId: string, actorUserId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEmsScopeVersion(ctx, scopeVersionId);
  if (!version || version.status !== "DRAFT") {
    throw new EmsProgrammeError(`Scope version must be DRAFT to submit for review (it is ${version?.status ?? "missing"}).`);
  }

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const updated = await tx.emsScopeVersion.update({
      where: { id: version.id, organisationId: txCtx.organisationId },
      data: { status: "IN_REVIEW" },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_scope_version.submitted_for_review",
      resourceType: "ems_scope_version",
      resourceId: version.id,
      summary: `Scope version ${version.versionNumber} submitted for review.`,
      actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "DRAFT" },
      after: { status: "IN_REVIEW" },
    });

    return updated;
  });
}

export interface ApproveScopeVersionInput {
  actorUserId: string;
}

/**
 * Moves an IN_REVIEW scope version to APPROVED, points the programme's
 * `currentScopeVersionId` at it, and — if a different version is currently
 * the programme's current version — moves that one to SUPERSEDED in the same
 * transaction, so a programme never has two current scope versions at once
 * (mirrors document-control-service.ts's `publishRevisionEffective`).
 */
export async function approveScopeVersion(context: OrganisationContext, scopeVersionId: string, input: ApproveScopeVersionInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEmsScopeVersion(ctx, scopeVersionId);
  if (!version || version.status !== "IN_REVIEW") {
    throw new EmsProgrammeError(`Scope version must be IN_REVIEW to approve (it is ${version?.status ?? "missing"}).`);
  }
  const approvedAt = new Date();

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const programme = assertOwned(txCtx, await tx.emsProgramme.findFirst({ where: { id: version.programmeId } }));

    if (programme.currentScopeVersionId && programme.currentScopeVersionId !== version.id) {
      await tx.emsScopeVersion.update({
        where: { id: programme.currentScopeVersionId, organisationId: txCtx.organisationId },
        data: { status: "SUPERSEDED" },
      });
      await recordAuditEvent(tx, txCtx, {
        eventType: "ems_scope_version.superseded",
        resourceType: "ems_scope_version",
        resourceId: programme.currentScopeVersionId,
        summary: `Scope version superseded by version ${version.versionNumber}.`,
        actorUserId: input.actorUserId,
        correlationId: txCtx.correlationId,
        source: "web-app",
        before: { status: "APPROVED" },
        after: { status: "SUPERSEDED" },
      });
    }

    const updated = await tx.emsScopeVersion.update({
      where: { id: version.id, organisationId: txCtx.organisationId },
      data: { status: "APPROVED", approvedByUserId: input.actorUserId, approvedAt, effectiveDate: approvedAt },
    });

    await tx.emsProgramme.update({
      where: { id: programme.id, organisationId: txCtx.organisationId },
      data: { currentScopeVersionId: version.id },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "ems_scope_version.approved",
      resourceType: "ems_scope_version",
      resourceId: version.id,
      summary: `Scope version ${version.versionNumber} approved.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      before: { status: "IN_REVIEW" },
      after: { status: "APPROVED" },
    });

    await enqueueTenantJob(tx, txCtx, {
      topic: SCOPE_VERSION_STATUS_TOPIC,
      payload: { scopeVersionId: version.id, programmeId: programme.id, status: "APPROVED" },
      idempotencyKey: `${version.id}:APPROVED`,
      correlationId: txCtx.correlationId,
      source: "web-app",
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Scope boundary — entities, sites, activities
// ---------------------------------------------------------------------------

function assertScopeVersionEditable(version: { status: string }): void {
  if (version.status !== "DRAFT" && version.status !== "IN_REVIEW") {
    throw new EmsProgrammeError(`Scope version is ${version.status} and can no longer be edited. Create a successor version instead.`);
  }
}

export async function addScopeEntity(context: OrganisationContext, scopeVersionId: string, entityId: string) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEmsScopeVersion(ctx, scopeVersionId);
  if (!version) throw new TenantOwnershipError();
  assertScopeVersionEditable(version);

  const entity = assertOwned(ctx, await prisma.entity.findFirst({ where: { id: entityId } }));

  return prisma.emsScopeEntity.upsert({
    where: { scopeVersionId_entityId: { scopeVersionId: version.id, entityId: entity.id } },
    create: { scopeVersionId: version.id, organisationId: ctx.organisationId, entityId: entity.id },
    update: {},
  });
}

export interface AddScopeSiteOptions {
  /** When true, skips the "Entity already included" check for a documented boundary exception (Phase 2 spec §3). */
  allowExceptionWithoutEntity?: boolean;
}

/** Adds a Site to the boundary. Denies unless the Site's Entity has already been added to the same version, per "Site must belong to an included Entity unless a documented exception is supported later" — this is the one path that documented exception takes. */
export async function addScopeSite(
  context: OrganisationContext,
  scopeVersionId: string,
  siteId: string,
  options: AddScopeSiteOptions = {},
) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEmsScopeVersion(ctx, scopeVersionId);
  if (!version) throw new TenantOwnershipError();
  assertScopeVersionEditable(version);

  const site = assertOwned(ctx, await prisma.site.findFirst({ where: { id: siteId } }));

  if (!options.allowExceptionWithoutEntity) {
    const entityIncluded = await prisma.emsScopeEntity.findFirst({
      where: { scopeVersionId: version.id, entityId: site.entityId, organisationId: ctx.organisationId },
    });
    if (!entityIncluded) {
      throw new EmsProgrammeError("Site's Entity must be added to the scope boundary first (or pass allowExceptionWithoutEntity).");
    }
  }

  return prisma.emsScopeSite.upsert({
    where: { scopeVersionId_siteId: { scopeVersionId: version.id, siteId: site.id } },
    create: { scopeVersionId: version.id, organisationId: ctx.organisationId, siteId: site.id },
    update: {},
  });
}

export interface AddScopeActivityInput {
  description: string;
  siteId?: string | null;
}

export async function addScopeActivity(context: OrganisationContext, scopeVersionId: string, input: AddScopeActivityInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const version = await findTenantEmsScopeVersion(ctx, scopeVersionId);
  if (!version) throw new TenantOwnershipError();
  assertScopeVersionEditable(version);

  if (input.siteId) {
    assertOwned(ctx, await prisma.site.findFirst({ where: { id: input.siteId } }));
  }

  return prisma.emsScopeActivity.create({
    data: {
      scopeVersionId: version.id,
      organisationId: ctx.organisationId,
      description: input.description,
      siteId: input.siteId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Standard requirement mapping — identifiers/status only, never clause text
// ---------------------------------------------------------------------------

export interface UpsertStandardRequirementMapInput {
  programmeId: string;
  standardProfile: string;
  requirementKey: string;
  implementationStatus?: "NOT_STARTED" | "IN_PROGRESS" | "IMPLEMENTED" | "NOT_APPLICABLE";
  ownerMembershipId?: string | null;
  reviewDate?: Date | null;
  notes?: string | null;
  actorUserId: string;
}

export async function upsertStandardRequirementMap(context: OrganisationContext, input: UpsertStandardRequirementMapInput) {
  requirePermission(context, "ems.programme.manage");
  const ctx = toTenantRepositoryContext(context);
  const programme = await findTenantEmsProgramme(ctx, input.programmeId);

  return runInTenantTransaction(ctx, prisma, async (tx, txCtx) => {
    const row = await tx.standardRequirementMap.upsert({
      where: {
        programmeId_standardProfile_requirementKey: {
          programmeId: programme.id,
          standardProfile: input.standardProfile,
          requirementKey: input.requirementKey,
        },
      },
      create: {
        programmeId: programme.id,
        organisationId: txCtx.organisationId,
        standardProfile: input.standardProfile,
        requirementKey: input.requirementKey,
        implementationStatus: input.implementationStatus ?? "NOT_STARTED",
        ownerMembershipId: input.ownerMembershipId ?? null,
        reviewDate: input.reviewDate ?? null,
        notes: input.notes ?? null,
      },
      update: {
        implementationStatus: input.implementationStatus ?? undefined,
        ownerMembershipId: input.ownerMembershipId ?? undefined,
        reviewDate: input.reviewDate ?? undefined,
        notes: input.notes ?? undefined,
      },
    });

    await recordAuditEvent(tx, txCtx, {
      eventType: "standard_requirement_map.upserted",
      resourceType: "standard_requirement_map",
      resourceId: row.id,
      summary: `Requirement "${input.requirementKey}" (${input.standardProfile}) mapping updated.`,
      actorUserId: input.actorUserId,
      correlationId: txCtx.correlationId,
      source: "web-app",
      after: { standardProfile: input.standardProfile, requirementKey: input.requirementKey, implementationStatus: row.implementationStatus },
    });

    return row;
  });
}
