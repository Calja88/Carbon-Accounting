/**
 * Management review agenda template versioning tests (task T72). No live
 * database — Prisma is replaced with an in-memory fake and the audit-event
 * side effect is stubbed. Covers: DRAFT -> APPROVED -> ACTIVE -> SUPERSEDED,
 * the active-pointer move, item validation, successor versions, and tenant
 * isolation. All fixtures are fictional.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where?: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  templates: [] as Row[],
  versions: [] as Row[],
  items: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function find(rows: Row[], where: Row, orderBy?: Row) {
  let candidates = rows.filter((row) => matches(row, where));
  if (orderBy) {
    const [key, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
    candidates = [...candidates].sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return direction === "desc" ? bv - av : av - bv;
    });
  }
  return candidates[0] ?? null;
}

function simpleModel(rows: Row[], prefix: string, defaults: Row = {}) {
  return {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const key = (where as Row & { organisationId_id?: Row })?.organisationId_id ?? where ?? {};
      return find(rows, key as Row, orderBy);
    }),
    findUnique: vi.fn(async ({ where }: FindArgs) => find(rows, (where ?? {}) as Row)),
    findMany: vi.fn(async ({ where }: FindArgs) => rows.filter((r) => matches(r, (where ?? {}) as Row))),
    create: vi.fn(async ({ data }: { data: Row & { items?: { create: Row[] } } }) => {
      const { items: itemCreate, ...rest } = data;
      const row: Row = { id: `${prefix}-${tables.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...defaults, ...rest };
      rows.push(row);
      if (itemCreate?.create) {
        for (const item of itemCreate.create) {
          tables.items.push({ id: `item-${tables.nextId++}`, templateVersionId: row.id, createdAt: new Date(), ...item });
        }
      }
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(rows, key as Row);
      if (!row) throw new Error(`${prefix} not found`);
      Object.assign(row, data);
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: FindArgs) => {
      const toRemove = tables.items.filter((r) => matches(r, (where ?? {}) as Row));
      for (const row of toRemove) tables.items.splice(tables.items.indexOf(row), 1);
      return { count: toRemove.length };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const managementReviewAgendaTemplate = simpleModel(tables.templates, "template");
  const managementReviewAgendaTemplateVersion = simpleModel(tables.versions, "version", { status: "DRAFT" });
  const managementReviewAgendaItemDefinition = simpleModel(tables.items, "item");

  const prismaClient = {
    managementReviewAgendaTemplate,
    managementReviewAgendaTemplateVersion,
    managementReviewAgendaItemDefinition,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-event-synthetic" })) }));

const {
  ManagementReviewAgendaError,
  TenantOwnershipError,
  createManagementReviewAgendaTemplate,
  approveManagementReviewAgendaTemplateVersion,
  activateManagementReviewAgendaTemplateVersion,
  createSuccessorManagementReviewAgendaTemplateVersion,
} = await import("@/lib/ems/review/agenda-service");

const orgContextA = makeOrganisationContext(ORG_A, {
  permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
});

beforeEach(() => {
  tables.templates.length = 0;
  tables.versions.length = 0;
  tables.items.length = 0;
  tables.nextId = 1;
});

async function draftTemplate(overrides: Partial<Parameters<typeof createManagementReviewAgendaTemplate>[1]> = {}) {
  return createManagementReviewAgendaTemplate(orgContextA, {
    templateKey: "annual-management-review",
    name: "Annual management review agenda",
    items: [
      { order: 1, title: "Status of actions from previous reviews" },
      { order: 2, title: "Compliance status" },
    ],
    actorUserId: "user-1",
    ...overrides,
  });
}

describe("createManagementReviewAgendaTemplate", () => {
  it("creates a DRAFT v1 with its ordered items", async () => {
    const { template, version } = await draftTemplate();
    expect(version.status).toBe("DRAFT");
    expect(version.version).toBe(1);
    expect(tables.items.filter((i) => i.templateVersionId === version.id)).toHaveLength(2);
    expect(template.activeVersionId ?? null).toBeNull();
  });

  it("rejects an empty item list", async () => {
    await expect(draftTemplate({ items: [] })).rejects.toThrow(ManagementReviewAgendaError);
  });

  it("rejects duplicate item order values", async () => {
    await expect(
      draftTemplate({ items: [{ order: 1, title: "A" }, { order: 1, title: "B" }] }),
    ).rejects.toThrow(ManagementReviewAgendaError);
  });
});

describe("approve / activate state machine", () => {
  it("moves DRAFT -> APPROVED -> ACTIVE and sets the template's active pointer", async () => {
    const { template, version } = await draftTemplate();
    const approved = await approveManagementReviewAgendaTemplateVersion(orgContextA, version.id, "user-1");
    expect(approved.status).toBe("APPROVED");
    const activated = await activateManagementReviewAgendaTemplateVersion(orgContextA, version.id, "user-1");
    expect(activated.status).toBe("ACTIVE");
    const updatedTemplate = find(tables.templates, { id: template.id });
    expect(updatedTemplate?.activeVersionId).toBe(version.id);
  });

  it("rejects activating a version that is still DRAFT", async () => {
    const { version } = await draftTemplate();
    await expect(activateManagementReviewAgendaTemplateVersion(orgContextA, version.id, "user-1")).rejects.toThrow(
      ManagementReviewAgendaError,
    );
  });

  it("supersedes the previously active version when a new one activates", async () => {
    const { template, version: v1 } = await draftTemplate();
    await approveManagementReviewAgendaTemplateVersion(orgContextA, v1.id, "user-1");
    await activateManagementReviewAgendaTemplateVersion(orgContextA, v1.id, "user-1");

    const v2 = await createSuccessorManagementReviewAgendaTemplateVersion(orgContextA, template.id, {
      name: "Annual management review agenda (revised)",
      items: [{ order: 1, title: "Status of actions from previous reviews" }],
      revisionRationale: "Annual review.",
      actorUserId: "user-1",
    });
    await approveManagementReviewAgendaTemplateVersion(orgContextA, v2.id, "user-1");
    await activateManagementReviewAgendaTemplateVersion(orgContextA, v2.id, "user-1");

    const supersededV1 = find(tables.versions, { id: v1.id });
    expect(supersededV1?.status).toBe("SUPERSEDED");
    const updatedTemplate = find(tables.templates, { id: template.id });
    expect(updatedTemplate?.activeVersionId).toBe(v2.id);
  });
});

describe("tenant isolation", () => {
  it("denies approving a version belonging to another organisation", async () => {
    const { version } = await draftTemplate();
    const orgContextB = makeOrganisationContext(ORG_B, {
      permissions: new Set(["ems.view", "ems.management_review.manage"]) as unknown as ReturnType<typeof makeOrganisationContext>["permissions"],
    });
    await expect(approveManagementReviewAgendaTemplateVersion(orgContextB, version.id, "user-b")).rejects.toThrow(TenantOwnershipError);
  });
});
