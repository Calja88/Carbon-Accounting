/**
 * Phase 1 tenancy (T12) — structural backfill planning.
 *
 * Pure planning logic for linking the existing single-tenant data set (all
 * Entities/Sites/Users, created before Organisation existed) into one
 * Organisation, per PHASE1_TENANCY_RBAC_SPEC.md §9 "Backfill command":
 *
 *   - link existing Entities (and their Sites) to the target Organisation;
 *   - create ACTIVE memberships for current Users;
 *   - translate each User's legacy `Role` into a system role-template
 *     assignment;
 *   - never read or report environmental/measurement values — only IDs and
 *     counts.
 *
 * This module never touches Prisma. `scripts/backfill-organisation.ts` loads
 * the current database state, calls `planBackfill`, and only then decides
 * whether to write (`--apply`) or just report (dry-run default). Keeping the
 * decision logic here — with no I/O — makes it possible to unit test
 * idempotency and conflict handling against synthetic in-memory fixtures
 * without a live database.
 */

import { Role } from "@prisma/client";
// Type-only: RoleTemplateKey is never read as a runtime value in this file.
// The mapping below uses the enum's own string literals directly instead of
// `RoleTemplateKey.X`, so it no longer depends on `@prisma/client`'s
// generated runtime enum object being present — only on the *type* lining
// up, which `tsc` still checks. See role-templates.ts for the matching fix.
import type { RoleTemplateKey } from "@prisma/client";

/**
 * Legacy single-tenant `Role` → Phase 1 system role template.
 *
 * DATA_OWNER and SUSTAINABILITY_LEAD/FINANCE/ADMIN map to the template that
 * matches their current day-to-day access most closely: DATA_OWNER did
 * carbon/LCA data entry with no approval authority, which is EMS_CONTRIBUTOR
 * (see role-templates.ts); the other three legacy roles line up 1:1 with a
 * template of the same purpose. Recorded as an owner decision in the T12
 * task report, same as the T11 template judgment calls.
 */
export const LEGACY_ROLE_TO_TEMPLATE: Record<Role, RoleTemplateKey> = {
  [Role.DATA_OWNER]: "EMS_CONTRIBUTOR",
  [Role.SUSTAINABILITY_LEAD]: "SUSTAINABILITY_LEAD",
  [Role.FINANCE]: "FINANCE_READ_ONLY",
  [Role.ADMIN]: "ORGANISATION_ADMINISTRATOR",
};

export interface BackfillEntityInput {
  id: string;
  organisationId: string | null;
}

export interface BackfillSiteInput {
  id: string;
  entityId: string;
  organisationId: string | null;
}

export interface BackfillUserInput {
  id: string;
  role: Role;
}

export interface BackfillExistingMembershipInput {
  userId: string;
  status: string;
}

export interface BackfillExistingRoleAssignmentInput {
  userId: string;
  templateKey: RoleTemplateKey;
}

export interface BackfillPlanInput {
  /** Target organisation, if one already exists for the given slug. */
  existingOrganisation: { id: string } | null;
  entities: BackfillEntityInput[];
  sites: BackfillSiteInput[];
  users: BackfillUserInput[];
  /** Existing memberships in the target organisation, if it already exists. */
  existingMemberships: BackfillExistingMembershipInput[];
  /** Existing membership→template role assignments in the target organisation. */
  existingRoleAssignments: BackfillExistingRoleAssignmentInput[];
}

export interface BackfillRoleAssignmentAction {
  userId: string;
  templateKey: RoleTemplateKey;
}

export interface BackfillPlan {
  aborted: boolean;
  conflictReasons: string[];
  organisationAction: "create" | "reuse";
  entityIdsToLink: string[];
  siteIdsToLink: string[];
  userIdsNeedingMembership: string[];
  roleAssignmentsToCreate: BackfillRoleAssignmentAction[];
  counts: {
    entitiesLinked: number;
    sitesLinked: number;
    membershipsCreated: number;
    roleAssignmentsCreated: number;
    entityConflicts: number;
    siteConflicts: number;
  };
}

/**
 * Builds the backfill plan without performing any writes. Aborts (rather
 * than partially planning) when an Entity or Site already belongs to a
 * *different* organisation than the target — that is the "ambiguous or
 * conflicting state" the acceptance criteria require the command to refuse.
 */
export function planBackfill(input: BackfillPlanInput): BackfillPlan {
  const targetOrganisationId = input.existingOrganisation?.id ?? null;
  const conflictReasons: string[] = [];

  const entityConflicts = input.entities.filter(
    (e) => e.organisationId !== null && e.organisationId !== targetOrganisationId,
  );
  if (entityConflicts.length > 0) {
    conflictReasons.push(
      `${entityConflicts.length} entit${entityConflicts.length === 1 ? "y is" : "ies are"} already linked to a different organisation`,
    );
  }

  const siteConflicts = input.sites.filter(
    (s) => s.organisationId !== null && s.organisationId !== targetOrganisationId,
  );
  if (siteConflicts.length > 0) {
    conflictReasons.push(
      `${siteConflicts.length} site${siteConflicts.length === 1 ? " is" : "s are"} already linked to a different organisation`,
    );
  }

  const aborted = conflictReasons.length > 0;

  if (aborted) {
    return {
      aborted: true,
      conflictReasons,
      organisationAction: targetOrganisationId ? "reuse" : "create",
      entityIdsToLink: [],
      siteIdsToLink: [],
      userIdsNeedingMembership: [],
      roleAssignmentsToCreate: [],
      counts: {
        entitiesLinked: 0,
        sitesLinked: 0,
        membershipsCreated: 0,
        roleAssignmentsCreated: 0,
        entityConflicts: entityConflicts.length,
        siteConflicts: siteConflicts.length,
      },
    };
  }

  const entityIdsToLink = input.entities
    .filter((e) => e.organisationId === null)
    .map((e) => e.id);

  const siteIdsToLink = input.sites
    .filter((s) => s.organisationId === null)
    .map((s) => s.id);

  const existingMemberUserIds = new Set(
    input.existingMemberships.map((m) => m.userId),
  );
  const userIdsNeedingMembership = input.users
    .filter((u) => !existingMemberUserIds.has(u.id))
    .map((u) => u.id);

  const existingAssignmentKeys = new Set(
    input.existingRoleAssignments.map((a) => `${a.userId}:${a.templateKey}`),
  );
  const roleAssignmentsToCreate: BackfillRoleAssignmentAction[] = [];
  for (const user of input.users) {
    const templateKey = LEGACY_ROLE_TO_TEMPLATE[user.role];
    const key = `${user.id}:${templateKey}`;
    if (!existingAssignmentKeys.has(key)) {
      roleAssignmentsToCreate.push({ userId: user.id, templateKey });
    }
  }

  return {
    aborted: false,
    conflictReasons: [],
    organisationAction: targetOrganisationId ? "reuse" : "create",
    entityIdsToLink,
    siteIdsToLink,
    userIdsNeedingMembership,
    roleAssignmentsToCreate,
    counts: {
      entitiesLinked: entityIdsToLink.length,
      sitesLinked: siteIdsToLink.length,
      membershipsCreated: userIdsNeedingMembership.length,
      roleAssignmentsCreated: roleAssignmentsToCreate.length,
      entityConflicts: 0,
      siteConflicts: 0,
    },
  };
}
