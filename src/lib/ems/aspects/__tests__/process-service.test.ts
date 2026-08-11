/**
 * Process/activity profile service tests (task T30). No live database —
 * Prisma is replaced with an in-memory fake, following the T22/T23 pattern
 * (`change-service.test.ts`).
 *
 * Covers: hand-authored create/revise (never mutating the superseded row),
 * template application (confirmation-gated, idempotent, creates only
 * ActivityProcess rows), and tenant/site scoping denial.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, SITE_A, siteA, entityA, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const { programmes, sites, entities, templates, templateItems, processes, resetTables, nextIdRef } = vi.hoisted(() => {
  const programmes: { id: string; organisationId: string }[] = [];
  const sites: { id: string; organisationId: string; entityId: string }[] = [];
  const entities: { id: string; organisationId: string }[] = [];
  const templates: Record<string, unknown>[] = [];
  const templateItems: Record<string, unknown>[] = [];
  const processes: Record<string, unknown>[] = [];
  const nextIdRef = { n: 1 };
  function resetTables() {
    programmes.length = 0;
    sites.length = 0;
    entities.length = 0;
    templates.length = 0;
    templateItems.length = 0;
    processes.length = 0;
    nextIdRef.n = 1;
  }
  return { programmes, sites, entities, templates, templateItems, processes, resetTables, nextIdRef };
});

function nextId(prefix: string): string {
  return `${prefix}-${nextIdRef.n++}`;
}

function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "not" in (value as Record<string, unknown>)) {
      return record[key] !== (value as Record<string, unknown>).not;
    }
    return record[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const emsProgramme = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => programmes.find((p) => matches(p, where)) ?? null) };
  const site = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => sites.find((s) => matches(s, where)) ?? null) };
  const entity = { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => entities.find((e) => matches(e, where)) ?? null) };
  const processProfileTemplate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const t = templates.find((t) => (t as { id: string }).id === where.id);
      if (!t) return null;
      return { ...t, items: templateItems.filter((i) => (i as { templateId: string }).templateId === (t as { id: string }).id) };
    }),
  };

  const activityProcess = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId("process"), status: "ACTIVE", ...data };
      processes.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = processes.find((p) => p.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => processes.find((p) => matches(p, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => processes.filter((p) => matches(p, where))),
  };

  const prismaClient = {
    emsProgramme,
    site,
    entity,
    processProfileTemplate,
    activityProcess,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })),
}));

const {
  createActivityProcess,
  reviseActivityProcess,
  applyProcessProfileTemplate,
  activateActivityProcess,
  ActivityProcessError,
} = await import("@/lib/ems/aspects/process-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const orgContextA = makeOrganisationContext(ORG_A, {
  userId: "user-lead",
  permissions: new Set(["ems.aspect.edit", "ems.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});
const orgContextB = makeOrganisationContext(ORG_B, {
  userId: "user-b",
  permissions: new Set(["ems.aspect.edit", "ems.view"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  resetTables();
  vi.clearAllMocks();
  programmes.push({ id: "programme-1", organisationId: ORG_A });
  entities.push(entityA);
  sites.push(siteA);
});

describe("hand-authored processes", () => {
  it("creates a process scoped to the organisation and site", async () => {
    const process = await createActivityProcess(orgContextA, {
      programmeId: "programme-1",
      siteId: SITE_A,
      name: "Card production line",
      actorUserId: "user-lead",
    });
    expect(process.organisationId).toBe(ORG_A);
    expect(process.siteId).toBe(SITE_A);
    expect(process.entityId).toBe(ENTITY_A);
    expect(process.status).toBe("ACTIVE");
  });

  it("rejects a foreign-tenant site id", async () => {
    await expect(
      createActivityProcess(orgContextA, {
        programmeId: "programme-1",
        siteId: "site-birch-south",
        name: "Card production line",
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow();
  });

  it("rejects a foreign-tenant programme id", async () => {
    await expect(
      createActivityProcess(orgContextB, {
        programmeId: "programme-1",
        name: "Card production line",
        actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("revises a process by superseding the old row rather than mutating it", async () => {
    const original = await createActivityProcess(orgContextA, {
      programmeId: "programme-1",
      siteId: SITE_A,
      name: "Card production line",
      actorUserId: "user-lead",
    });

    const revised = await reviseActivityProcess(orgContextA, original.id, {
      name: "Card production line (updated)",
      actorUserId: "user-lead",
    });

    expect(revised.id).not.toBe(original.id);
    expect(revised.supersedesProcessId).toBe(original.id);
    expect(revised.name).toBe("Card production line (updated)");

    // The original row is marked SUPERSEDED, not deleted or rewritten —
    // its name/content are unchanged.
    const originalReloaded = processes.find((p) => p.id === original.id) as Record<string, unknown>;
    expect(originalReloaded.status).toBe("SUPERSEDED");
    expect(originalReloaded.name).toBe("Card production line");
  });

  it("refuses to revise an already-superseded process", async () => {
    const original = await createActivityProcess(orgContextA, {
      programmeId: "programme-1",
      siteId: SITE_A,
      name: "Card production line",
      actorUserId: "user-lead",
    });
    await reviseActivityProcess(orgContextA, original.id, { name: "v2", actorUserId: "user-lead" });

    await expect(reviseActivityProcess(orgContextA, original.id, { name: "v3", actorUserId: "user-lead" })).rejects.toThrow(ActivityProcessError);
  });
});

describe("structural starter templates", () => {
  beforeEach(() => {
    templates.push({ id: "template-1", key: "hull_manufacturing", name: "Hull — Manufacturing", isActive: true });
    templateItems.push(
      { id: "item-1", templateId: "template-1", parentId: null, name: "Goods-in", activityType: "ACTIVITY", suggestedLifecycleStage: null, suggestedOperatingCondition: "NORMAL", sortOrder: 0 },
      { id: "item-2", templateId: "template-1", parentId: null, name: "Production line", activityType: "ACTIVITY", suggestedLifecycleStage: "PRODUCTION", suggestedOperatingCondition: "NORMAL", sortOrder: 1 },
    );
  });

  it("refuses to apply without explicit confirmation", async () => {
    await expect(
      applyProcessProfileTemplate(orgContextA, {
        programmeId: "programme-1",
        templateId: "template-1",
        siteId: SITE_A,
        confirm: false,
        actorUserId: "user-lead",
      }),
    ).rejects.toThrow(/confirmation/i);
    expect(processes).toHaveLength(0);
  });

  it("creates one DRAFT ActivityProcess per template item and nothing else", async () => {
    const result = await applyProcessProfileTemplate(orgContextA, {
      programmeId: "programme-1",
      templateId: "template-1",
      siteId: SITE_A,
      confirm: true,
      actorUserId: "user-lead",
    });

    expect(result.createdProcessIds).toHaveLength(2);
    expect(result.reusedProcessIds).toHaveLength(0);
    expect(processes.every((p) => p.status === "DRAFT")).toBe(true);
    expect(processes.every((p) => p.organisationId === ORG_A && p.siteId === SITE_A)).toBe(true);
  });

  it("is idempotent — re-applying the same template to the same site reuses the existing drafts", async () => {
    await applyProcessProfileTemplate(orgContextA, {
      programmeId: "programme-1",
      templateId: "template-1",
      siteId: SITE_A,
      confirm: true,
      actorUserId: "user-lead",
    });
    expect(processes).toHaveLength(2);

    const second = await applyProcessProfileTemplate(orgContextA, {
      programmeId: "programme-1",
      templateId: "template-1",
      siteId: SITE_A,
      confirm: true,
      actorUserId: "user-lead",
    });

    expect(processes).toHaveLength(2);
    expect(second.createdProcessIds).toHaveLength(0);
    expect(second.reusedProcessIds).toHaveLength(2);
  });

  it("re-applies after the previous drafts were activated, without duplicating them", async () => {
    const first = await applyProcessProfileTemplate(orgContextA, {
      programmeId: "programme-1",
      templateId: "template-1",
      siteId: SITE_A,
      confirm: true,
      actorUserId: "user-lead",
    });
    for (const id of first.createdProcessIds) {
      await activateActivityProcess(orgContextA, id, "user-lead");
    }

    const second = await applyProcessProfileTemplate(orgContextA, {
      programmeId: "programme-1",
      templateId: "template-1",
      siteId: SITE_A,
      confirm: true,
      actorUserId: "user-lead",
    });

    expect(processes).toHaveLength(2);
    expect(second.reusedProcessIds).toHaveLength(2);
  });
});
