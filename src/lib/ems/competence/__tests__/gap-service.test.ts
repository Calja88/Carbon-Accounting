/**
 * Competence gap report tests (task T70). No live database — Prisma is
 * replaced with an in-memory fake. Covers: tenant scoping, RESTRICTED-
 * membership site scoping (deny by default for an org-wide person), GAP
 * status inclusion, and REQUIRED/IN_PROGRESS-past-due surfaced as
 * OVERDUE without mutating the assignment. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, SITE_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; include?: Row };

const tables = vi.hoisted(() => ({
  assignments: [] as Row[],
}));

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    const operators = expected as { in?: unknown[] };
    if (operators.in) return operators.in.includes(actual);
    return false;
  }
  return actual === expected;
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) {
      return (value as Row[]).some((clause) => matches(row, clause));
    }
    if (key === "person" && value && typeof value === "object") {
      return matches(row.person as Row, value as Row);
    }
    return matchValue(row[key], value);
  });
}

vi.mock("@/lib/prisma", () => {
  const competenceAssignment = {
    findMany: vi.fn(async ({ where }: FindArgs) => tables.assignments.filter((r) => matches(r, (where ?? {}) as Row))),
  };
  return { prisma: { competenceAssignment } };
});

const { listCompetenceGaps } = await import("@/lib/ems/competence/gap-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.competence.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

const personOrgWide = { id: "person-org-wide", displayName: "Org-wide Person", siteId: null, entityId: null, membership: null };
const personSiteA = { id: "person-site-a", displayName: "Site A Person", siteId: SITE_A, entityId: null, membership: null };

beforeEach(() => {
  tables.assignments.length = 0;
});

describe("listCompetenceGaps", () => {
  it("includes an assignment already marked GAP", async () => {
    tables.assignments.push({
      id: "assignment-1",
      organisationId: ORG_A,
      status: "GAP",
      dueDate: null,
      gapSince: new Date(),
      gapNote: "Certificate expired.",
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("GAP");
  });

  it("includes an EXPIRED assignment (task T71: expired competence appears as gap)", async () => {
    tables.assignments.push({
      id: "assignment-expired",
      organisationId: ORG_A,
      status: "EXPIRED",
      dueDate: null,
      gapSince: new Date("2026-08-01"),
      gapNote: "Competence has expired.",
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("EXPIRED");
    expect(gaps[0].status).toBe("EXPIRED");
  });

  it("does not report a COMPETENT assignment as a gap", async () => {
    tables.assignments.push({
      id: "assignment-competent",
      organisationId: ORG_A,
      status: "COMPETENT",
      dueDate: null,
      gapSince: null,
      gapNote: null,
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(0);
  });

  it("surfaces a REQUIRED assignment past its due date as OVERDUE without a persisted GAP status", async () => {
    tables.assignments.push({
      id: "assignment-2",
      organisationId: ORG_A,
      status: "REQUIRED",
      dueDate: new Date("2000-01-01"),
      gapSince: null,
      gapNote: null,
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("OVERDUE");
    expect(gaps[0].status).toBe("REQUIRED");
  });

  it("excludes a REQUIRED assignment that is not yet due", async () => {
    tables.assignments.push({
      id: "assignment-3",
      organisationId: ORG_A,
      status: "REQUIRED",
      dueDate: new Date("2999-01-01"),
      gapSince: null,
      gapNote: null,
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(0);
  });

  it("is tenant scoped", async () => {
    tables.assignments.push({
      id: "assignment-org-b",
      organisationId: ORG_B,
      status: "GAP",
      dueDate: null,
      gapSince: new Date(),
      gapNote: null,
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const gaps = await listCompetenceGaps(orgContextA);
    expect(gaps).toHaveLength(0);
  });

  it("denies a RESTRICTED member from seeing a gap for an org-wide person (deny by default)", async () => {
    tables.assignments.push({
      id: "assignment-4",
      organisationId: ORG_A,
      status: "GAP",
      dueDate: null,
      gapSince: new Date(),
      gapNote: null,
      person: personOrgWide,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const restricted = makeOrganisationContext(ORG_A, {
      permissions: orgContextA.permissions,
      access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
    });
    const gaps = await listCompetenceGaps(restricted);
    expect(gaps).toHaveLength(0);
  });

  it("lets a RESTRICTED member see a gap for a person scoped to their granted Site", async () => {
    tables.assignments.push({
      id: "assignment-5",
      organisationId: ORG_A,
      status: "GAP",
      dueDate: null,
      gapSince: new Date(),
      gapNote: null,
      person: personSiteA,
      requirementVersion: { id: "version-1", title: "Confined space entry" },
    });
    const restricted = makeOrganisationContext(ORG_A, {
      permissions: orgContextA.permissions,
      access: { mode: "RESTRICTED", entityIds: new Set(), siteIds: new Set([SITE_A]) },
    });
    const gaps = await listCompetenceGaps(restricted);
    expect(gaps).toHaveLength(1);
  });
});
