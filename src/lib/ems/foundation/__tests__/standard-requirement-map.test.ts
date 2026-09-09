/**
 * T84 licensed standard and competent review checklist tests
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §8). No live database — Prisma
 * is replaced with an in-memory fake, following the T81
 * retention-service.test.ts pattern. Covers: gap/owner-decision recording,
 * evidence linking to a requirement mapping, competent-review permission
 * and recording, and cross-tenant isolation. All records are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const tables = vi.hoisted(() => ({
  programmes: [] as Record<string, unknown>[],
  maps: [] as Record<string, unknown>[],
  evidence: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  nextId: 1,
}));

function id(prefix: string) {
  return `${prefix}-${tables.nextId++}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const standardRequirementMap = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.maps.find((row) => matches(row, where)) ?? null),
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { programmeId_standardProfile_requirementKey: { programmeId: string; standardProfile: string; requirementKey: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = where.programmeId_standardProfile_requirementKey;
        const existing = tables.maps.find(
          (row) => row.programmeId === key.programmeId && row.standardProfile === key.standardProfile && row.requirementKey === key.requirementKey,
        );
        if (existing) {
          for (const [k, v] of Object.entries(update)) {
            if (v !== undefined) existing[k] = v;
          }
          return existing;
        }
        const row = { id: id("map"), createdAt: new Date(), updatedAt: new Date(), ...create };
        tables.maps.push(row);
        return row;
      },
    ),
    update: vi.fn(async ({ where, data }: { where: { organisationId_id: { organisationId: string; id: string } }; data: Record<string, unknown> }) => {
      const row = tables.maps.find((item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...tables.maps.filter((row) => matches(row, where))].sort((a, b) =>
        String(a.standardProfile).localeCompare(String(b.standardProfile)) || String(a.requirementKey).localeCompare(String(b.requirementKey)),
      ),
    ),
  };
  const emsProgramme = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.programmes.find((row) => matches(row, where)) ?? null),
  };
  const evidenceObject = {
    findMany: vi.fn(async () => tables.evidence.map(row => ({ ...row, classification: "INTERNAL", links: [], controlledDocumentRevision: null }))),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.evidence.find((row) => matches(row, where)) ?? null),
  };
  const evidenceLink = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: id("link"), linkedAt: new Date(), ...data };
      tables.links.push(row);
      return row;
    }),
  };
  const prismaMock = {
    controlledDocumentRevision: { findMany: vi.fn(async () => []) },
    standardRequirementMap,
    emsProgramme,
    evidenceObject,
    evidenceLink,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaMock)),
  };
  return { prisma: prismaMock };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/jobs/outbox-service", () => ({
  enqueueTenantJob: vi.fn(async () => undefined),
}));

import { prisma } from "@/lib/prisma";
import { upsertStandardRequirementMap, recordCompetentReview, listStandardRequirementMaps } from "@/lib/ems/foundation/programme-service";
import { linkEvidence } from "@/lib/documents/evidence-service";
import { PermissionDeniedError } from "@/lib/rbac/authorize";

const orgAReadinessContext = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.programme.manage", "ems.readiness.review"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgAContributorContext = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view", "ems.programme.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgBReadinessContext = makeOrganisationContext(ORG_B, {
  permissions: new Set(["ems.programme.manage", "ems.readiness.review"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.programmes.length = 0;
  tables.maps.length = 0;
  tables.evidence.length = 0;
  tables.links.length = 0;
  tables.nextId = 1;
  vi.clearAllMocks();
});

function seedProgramme(organisationId: string) {
  const programme = { id: id("programme"), organisationId, name: "Synthetic EMS" };
  tables.programmes.push(programme);
  return programme;
}

describe("upsertStandardRequirementMap — gap and owner decision", () => {
  it("records a gap status, description and owner decision on the mapping row", async () => {
    const programme = seedProgramme(ORG_A);

    const row = await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      gapStatus: "GAP_IDENTIFIED",
      gapDescription: "Synthetic test gap description, no standard text.",
      ownerDecision: "Synthetic owner decision: remediate by Q3.",
      ownerDecisionAt: new Date("2026-01-01"),
      actorUserId: "user-owner",
    });

    expect(row.gapStatus).toBe("GAP_IDENTIFIED");
    expect(row.gapDescription).toContain("Synthetic test gap");
    expect(row.ownerDecision).toContain("Synthetic owner decision");
  });

  it("defaults gapStatus to NOT_ASSESSED and never infers it from other fields", async () => {
    const programme = seedProgramme(ORG_A);

    const row = await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "8.1",
      implementationStatus: "IMPLEMENTED",
      actorUserId: "user-owner",
    });

    expect(row.gapStatus).toBe("NOT_ASSESSED");
  });

  it("lists requirement mappings for a programme, ordered by standard/requirement key", async () => {
    const programme = seedProgramme(ORG_A);
    await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "8.1",
      actorUserId: "user-owner",
    });
    await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      actorUserId: "user-owner",
    });

    const maps = await listStandardRequirementMaps(orgAContributorContext, programme.id);
    expect(maps.map((m) => m.requirementKey)).toEqual(["6.1.2", "8.1"]);
  });

  it("denies cross-tenant programme access identically to a missing programme", async () => {
    const programmeB = seedProgramme(ORG_B);

    await expect(
      upsertStandardRequirementMap(orgAContributorContext, {
        programmeId: programmeB.id,
        standardProfile: "ISO-14001-2026",
        requirementKey: "6.1.2",
        actorUserId: "user-attacker",
      }),
    ).rejects.toThrow();
  });
});

describe("recordCompetentReview", () => {
  it("requires ems.readiness.review and rejects a caller with only ems.programme.manage", async () => {
    const programme = seedProgramme(ORG_A);
    const row = await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      actorUserId: "user-owner",
    });

    await expect(
      recordCompetentReview(orgAContributorContext, {
        requirementMapId: row.id as string,
        outcome: "REVIEWED_NO_ISSUES",
        actorUserId: "user-owner",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("records the reviewer, timestamp and outcome for a caller with ems.readiness.review", async () => {
    const programme = seedProgramme(ORG_A);
    const row = await upsertStandardRequirementMap(orgAReadinessContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      actorUserId: "user-owner",
    });

    const reviewed = await recordCompetentReview(orgAReadinessContext, {
      requirementMapId: row.id as string,
      outcome: "REVIEWED_ISSUES_FOUND",
      notes: "Synthetic reviewer note, no standard text.",
      actorUserId: "user-reviewer",
    });

    expect(reviewed.competentReviewOutcome).toBe("REVIEWED_ISSUES_FOUND");
    expect(reviewed.competentReviewerUserId).toBe("user-reviewer");
    expect(reviewed.competentReviewedAt).toBeInstanceOf(Date);
    expect(reviewed.competentReviewNotes).toContain("Synthetic reviewer note");
  });

  it("denies recording a competent review on another organisation's mapping row", async () => {
    const programmeA = seedProgramme(ORG_A);
    const row = await upsertStandardRequirementMap(orgAReadinessContext, {
      programmeId: programmeA.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      actorUserId: "user-owner",
    });

    await expect(
      recordCompetentReview(orgBReadinessContext, {
        requirementMapId: row.id as string,
        outcome: "REVIEWED_NO_ISSUES",
        actorUserId: "user-attacker",
      }),
    ).rejects.toThrow();
  });
});

describe("evidence linking to a requirement mapping", () => {
  it("accepts standard_requirement_map as a known evidence-link resource type", async () => {
    const programme = seedProgramme(ORG_A);
    const row = await upsertStandardRequirementMap(orgAContributorContext, {
      programmeId: programme.id,
      standardProfile: "ISO-14001-2026",
      requirementKey: "6.1.2",
      actorUserId: "user-owner",
    });
    tables.evidence.push({ id: "evidence-1", organisationId: ORG_A });

    const link = await linkEvidence(orgAContributorContext, {
      evidenceId: "evidence-1",
      resourceType: "standard_requirement_map",
      resourceId: row.id as string,
      purpose: "Synthetic implemented-control evidence.",
      linkedByUserId: "user-owner",
    });

    expect(link.resourceType).toBe("standard_requirement_map");
    expect(link.resourceId).toBe(row.id);
  });
});

describe("language guardrails", () => {
  it("the T84 owner template and pilot gate register avoid unsupported certification claims", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const files = [
      path.resolve(process.cwd(), "docs/readiness/iso-14001-2026-mapping-template.md"),
      path.resolve(process.cwd(), "docs/readiness/pilot-gate-register.md"),
    ];
    for (const file of files) {
      const contents = await fs.readFile(file, "utf8");
      // No bare "X is ISO certified/compliant" style claim attributed to the
      // platform. The negated forms ("does not certify", "avoid ... claims")
      // are expected and allowed.
      expect(contents).not.toMatch(/this platform (is|has been) (iso )?(certified|compliant)/i);
      expect(contents).not.toMatch(/(certifies|guarantees) compliance/i);
    }
  });
});

void prisma;
