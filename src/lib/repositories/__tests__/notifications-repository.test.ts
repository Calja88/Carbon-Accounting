/**
 * Two-tenant adversarial tests for the T24 notifications repository, per
 * Docs/PHASE1_ADVERSARIAL_TEST_MATRIX.md's mandatory-access-matrix pattern
 * (T80, Docs/PHASE8_HARDENING_READINESS_SPEC.md §3). Synthetic Aster/Birch
 * fixtures only, no live database — same convention as the sibling
 * repository test files (carbon/lca/documents/audit/ems).
 */

import { describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

const NOTIFICATION_A = "notification-aster-1";
const NOTIFICATION_B = "notification-birch-1";
const RULE_A = "reminder-rule-aster-1";
const RULE_B = "reminder-rule-birch-1";
const MEMBERSHIP_A = "membership-aster-1";
const MEMBERSHIP_B = "membership-birch-1";

const notificationA = { id: NOTIFICATION_A, organisationId: ORG_A, type: "review.due" };
const notificationB = { id: NOTIFICATION_B, organisationId: ORG_B, type: "review.due" };

const ruleA = { id: RULE_A, organisationId: ORG_A, resourceType: "action" };
const ruleB = { id: RULE_B, organisationId: ORG_B, resourceType: "action" };

const membershipA = { id: MEMBERSHIP_A, organisationId: ORG_A, status: "ACTIVE" };
const membershipBSuspended = { id: "membership-aster-suspended", organisationId: ORG_A, status: "SUSPENDED" };
const membershipB = { id: MEMBERSHIP_B, organisationId: ORG_B, status: "ACTIVE" };

function fakeFindFirst<T extends Record<string, unknown>>(rows: T[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: { findFirst: fakeFindFirst([notificationA, notificationB]) },
    reminderRule: { findFirst: fakeFindFirst([ruleA, ruleB]) },
    organisationMembership: { findFirst: fakeFindFirst([membershipA, membershipBSuspended, membershipB]) },
  },
}));

const { findTenantNotification, findTenantReminderRule, findActiveTenantMembership, TenantOwnershipError } = await import(
  "@/lib/repositories/notifications-repository"
);

const ctxA = makeTenantContext(ORG_A);
const ctxB = makeTenantContext(ORG_B);

describe("findTenantNotification", () => {
  it("allows an Organisation A caller reading Notification A", async () => {
    await expect(findTenantNotification(ctxA, NOTIFICATION_A)).resolves.toEqual(notificationA);
  });

  it("denies an Organisation A caller reading Notification B (foreign tenant)", async () => {
    await expect(findTenantNotification(ctxA, NOTIFICATION_B)).rejects.toThrow(TenantOwnershipError);
  });

  it("denies a missing notification id identically to a foreign one", async () => {
    await expect(findTenantNotification(ctxA, "does-not-exist")).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findTenantReminderRule", () => {
  it("allows an Organisation A caller reading Rule A", async () => {
    await expect(findTenantReminderRule(ctxA, RULE_A)).resolves.toEqual(ruleA);
  });

  it("denies an Organisation B caller reading Rule A (reverse direction)", async () => {
    await expect(findTenantReminderRule(ctxB, RULE_A)).rejects.toThrow(TenantOwnershipError);
  });
});

describe("findActiveTenantMembership", () => {
  it("resolves an active Organisation A membership", async () => {
    await expect(findActiveTenantMembership(ctxA, MEMBERSHIP_A)).resolves.toEqual(membershipA);
  });

  it("returns null for a foreign-organisation membership id (never resolves Organisation B's recipient)", async () => {
    await expect(findActiveTenantMembership(ctxA, MEMBERSHIP_B)).resolves.toBeNull();
  });

  it("returns null for a suspended membership even inside the correct organisation", async () => {
    await expect(findActiveTenantMembership(ctxA, membershipBSuspended.id)).resolves.toBeNull();
  });
});
