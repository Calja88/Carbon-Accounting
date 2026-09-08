import { Role, RoleTemplateKey } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  LEGACY_ROLE_TO_TEMPLATE,
  planBackfill,
  type BackfillPlanInput,
} from "@/lib/backfill/organisation-backfill";

function baseInput(overrides: Partial<BackfillPlanInput> = {}): BackfillPlanInput {
  return {
    existingOrganisation: null,
    entities: [],
    sites: [],
    users: [],
    existingMemberships: [],
    existingRoleAssignments: [],
    ...overrides,
  };
}

describe("LEGACY_ROLE_TO_TEMPLATE", () => {
  it("maps every legacy role to a known template", () => {
    const mapped = Object.values(LEGACY_ROLE_TO_TEMPLATE).sort();
    expect(mapped).toEqual(
      [
        RoleTemplateKey.EMS_CONTRIBUTOR,
        RoleTemplateKey.SUSTAINABILITY_LEAD,
        RoleTemplateKey.FINANCE_READ_ONLY,
        RoleTemplateKey.ORGANISATION_ADMINISTRATOR,
      ].sort(),
    );
  });
});

describe("planBackfill", () => {
  it("plans to link all unowned synthetic entities/sites and create memberships+roles", () => {
    const input = baseInput({
      entities: [
        { id: "ent-1", organisationId: null },
        { id: "ent-2", organisationId: null },
      ],
      sites: [
        { id: "site-1", entityId: "ent-1", organisationId: null },
        { id: "site-2", entityId: "ent-2", organisationId: null },
      ],
      users: [
        { id: "user-1", role: Role.SUSTAINABILITY_LEAD },
        { id: "user-2", role: Role.DATA_OWNER },
      ],
    });

    const plan = planBackfill(input);

    expect(plan.aborted).toBe(false);
    expect(plan.organisationAction).toBe("create");
    expect(plan.entityIdsToLink.sort()).toEqual(["ent-1", "ent-2"]);
    expect(plan.siteIdsToLink.sort()).toEqual(["site-1", "site-2"]);
    expect(plan.userIdsNeedingMembership.sort()).toEqual(["user-1", "user-2"]);
    expect(plan.roleAssignmentsToCreate).toEqual(
      expect.arrayContaining([
        { userId: "user-1", templateKey: RoleTemplateKey.SUSTAINABILITY_LEAD },
        { userId: "user-2", templateKey: RoleTemplateKey.EMS_CONTRIBUTOR },
      ]),
    );
    expect(plan.counts).toEqual({
      entitiesLinked: 2,
      sitesLinked: 2,
      membershipsCreated: 2,
      roleAssignmentsCreated: 2,
      entityConflicts: 0,
      siteConflicts: 0,
    });
  });

  it("writes nothing conceptually on a dry run — a fresh plan reports non-zero counts but performs no I/O itself", () => {
    const input = baseInput({
      entities: [{ id: "ent-1", organisationId: null }],
      sites: [],
      users: [{ id: "user-1", role: Role.ADMIN }],
    });

    const plan = planBackfill(input);
    expect(plan.counts.entitiesLinked).toBe(1);
    expect(plan.roleAssignmentsToCreate).toEqual([
      { userId: "user-1", templateKey: RoleTemplateKey.ORGANISATION_ADMINISTRATOR },
    ]);
  });

  it("is idempotent: re-running against already-linked state reports zero new work", () => {
    const orgId = "org-1";
    const input = baseInput({
      existingOrganisation: { id: orgId },
      entities: [{ id: "ent-1", organisationId: orgId }],
      sites: [{ id: "site-1", entityId: "ent-1", organisationId: orgId }],
      users: [{ id: "user-1", role: Role.FINANCE }],
      existingMemberships: [{ userId: "user-1", status: "ACTIVE" }],
      existingRoleAssignments: [
        { userId: "user-1", templateKey: RoleTemplateKey.FINANCE_READ_ONLY },
      ],
    });

    const plan = planBackfill(input);

    expect(plan.aborted).toBe(false);
    expect(plan.organisationAction).toBe("reuse");
    expect(plan.entityIdsToLink).toEqual([]);
    expect(plan.siteIdsToLink).toEqual([]);
    expect(plan.userIdsNeedingMembership).toEqual([]);
    expect(plan.roleAssignmentsToCreate).toEqual([]);
    expect(plan.counts).toEqual({
      entitiesLinked: 0,
      sitesLinked: 0,
      membershipsCreated: 0,
      roleAssignmentsCreated: 0,
      entityConflicts: 0,
      siteConflicts: 0,
    });
  });

  it("aborts without planning any writes when an entity already belongs to a different organisation", () => {
    const input = baseInput({
      existingOrganisation: { id: "org-target" },
      entities: [
        { id: "ent-1", organisationId: "org-other" },
        { id: "ent-2", organisationId: null },
      ],
      users: [{ id: "user-1", role: Role.DATA_OWNER }],
    });

    const plan = planBackfill(input);

    expect(plan.aborted).toBe(true);
    expect(plan.conflictReasons.length).toBeGreaterThan(0);
    expect(plan.entityIdsToLink).toEqual([]);
    expect(plan.siteIdsToLink).toEqual([]);
    expect(plan.userIdsNeedingMembership).toEqual([]);
    expect(plan.roleAssignmentsToCreate).toEqual([]);
    expect(plan.counts.entityConflicts).toBe(1);
  });

  it("aborts when a site already belongs to a different organisation", () => {
    const input = baseInput({
      existingOrganisation: { id: "org-target" },
      entities: [{ id: "ent-1", organisationId: "org-target" }],
      sites: [{ id: "site-1", entityId: "ent-1", organisationId: "org-other" }],
      users: [],
    });

    const plan = planBackfill(input);

    expect(plan.aborted).toBe(true);
    expect(plan.counts.siteConflicts).toBe(1);
  });

  it("only creates memberships for users that do not already have one in the target organisation", () => {
    const input = baseInput({
      existingOrganisation: { id: "org-1" },
      users: [
        { id: "user-1", role: Role.SUSTAINABILITY_LEAD },
        { id: "user-2", role: Role.ADMIN },
      ],
      existingMemberships: [{ userId: "user-1", status: "ACTIVE" }],
    });

    const plan = planBackfill(input);

    expect(plan.userIdsNeedingMembership).toEqual(["user-2"]);
  });
});
