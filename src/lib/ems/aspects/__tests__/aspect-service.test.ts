/** T31 aspect/impact register tests. All records and file bytes are synthetic. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

const tables = vi.hoisted(() => ({
  processes: [] as Record<string, unknown>[],
  aspects: [] as Record<string, unknown>[],
  impacts: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  nextId: 1,
}));
const evidenceMocks = vi.hoisted(() => ({
  linkEvidence: vi.fn(async () => ({ id: "evidence-link-1" })),
  uploadEvidenceObject: vi.fn(async () => ({ id: "evidence-1" })),
}));

function id(prefix: string) {
  return `${prefix}-${tables.nextId++}`;
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

vi.mock("@/lib/prisma", () => {
  const activityProcess = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.processes.find((row) => matches(row, where)) ?? null),
  };
  const environmentalAspect = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.aspects.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.aspects.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: id("aspect"), ...data };
      tables.aspects.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { organisationId_id: { organisationId: string; id: string } }; data: Record<string, unknown> }) => {
      const row = tables.aspects.find((item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: { organisationId_id: { organisationId: string; id: string } } }) => {
      const index = tables.aspects.findIndex((item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId);
      if (index < 0) throw new Error("not found");
      return tables.aspects.splice(index, 1)[0];
    }),
  };
  const environmentalImpact = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.impacts.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.impacts.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: id("impact"), ...data };
      tables.impacts.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: { organisationId_id: { organisationId: string; id: string } } }) => {
      const index = tables.impacts.findIndex((item) => item.id === where.organisationId_id.id && item.organisationId === where.organisationId_id.organisationId);
      if (index < 0) throw new Error("not found");
      return tables.impacts.splice(index, 1)[0];
    }),
  };
  const aspectImpactLink = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => tables.links.find((row) => matches(row, where)) ?? null),
    upsert: vi.fn(async ({ where, update, create }: { where: { organisationId_aspectId_impactId: Record<string, string> }; update: Record<string, unknown>; create: Record<string, unknown> }) => {
      const key = where.organisationId_aspectId_impactId;
      const existing = tables.links.find((row) => matches(row, key));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: id("link"), ...create };
      tables.links.push(row);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = tables.links.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("not found");
      return tables.links.splice(index, 1)[0];
    }),
  };
  const evidenceLink = { deleteMany: vi.fn(async () => ({ count: 0 })) };
  const legalHold = { findFirst: vi.fn(async () => null) };
  const prismaClient = {
    activityProcess,
    environmentalAspect,
    environmentalImpact,
    aspectImpactLink,
    evidenceLink,
    legalHold,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-1" })) }));
vi.mock("@/lib/documents/evidence-service", () => evidenceMocks);

const {
  AspectRegisterError,
  attachEvidenceToAspect,
  createEnvironmentalAspect,
  createEnvironmentalImpact,
  deleteEnvironmentalAspect,
  linkAspectToImpact,
  updateEnvironmentalAspect,
} = await import("@/lib/ems/aspects/aspect-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { prisma } = await import("@/lib/prisma");

const contextA = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  permissions: new Set(["ems.view", "ems.aspect.edit"]) as never,
});

beforeEach(() => {
  tables.processes.length = 0;
  tables.aspects.length = 0;
  tables.impacts.length = 0;
  tables.links.length = 0;
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.processes.push({
    id: "process-a",
    organisationId: ORG_A,
    name: "Synthetic finishing activity",
    status: "ACTIVE",
    lifecycleStage: "PRODUCTION",
    operatingCondition: "NORMAL",
  });
});

describe("environmental aspects", () => {
  it("captures control, lifecycle and emergency condition without any carbon/LCA total", async () => {
    const aspect = await createEnvironmentalAspect(contextA, {
      processId: "process-a",
      name: "Synthetic solvent use",
      sourceInputOutput: "Input",
      scopeDescription: "Synthetic line boundary",
      existingControls: "Synthetic closed-container procedure",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "EMERGENCY",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });

    expect(aspect).toMatchObject({
      organisationId: ORG_A,
      lifecycleStage: "PRODUCTION",
      operatingCondition: "EMERGENCY",
      controlRelationship: "DIRECT_CONTROL",
    });
    expect(aspect).not.toHaveProperty("carbonTotal");
    expect(aspect).not.toHaveProperty("lcaTotal");
  });

  it("rejects a foreign-organisation process id", async () => {
    tables.processes.push({ id: "process-b", organisationId: ORG_B, status: "ACTIVE", lifecycleStage: null });
    await expect(createEnvironmentalAspect(contextA, {
      processId: "process-b",
      name: "Synthetic foreign aspect",
      controlRelationship: "INFLUENCE",
      operatingCondition: "NORMAL",
      effect: "BENEFICIAL",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(TenantOwnershipError);
    expect(tables.aspects).toHaveLength(0);
  });

  it("updates only an aspect owned by the current organisation", async () => {
    const aspect = await createEnvironmentalAspect(contextA, {
      processId: "process-a",
      name: "Synthetic aspect v1",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "NORMAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    const updated = await updateEnvironmentalAspect(contextA, aspect.id, {
      processId: "process-a",
      name: "Synthetic aspect v2",
      controlRelationship: "INFLUENCE",
      operatingCondition: "ABNORMAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    expect(updated).toMatchObject({ name: "Synthetic aspect v2", controlRelationship: "INFLUENCE", operatingCondition: "ABNORMAL" });
  });

  it("keeps an explicit delete action and removes the tenant-owned aspect", async () => {
    const aspect = await createEnvironmentalAspect(contextA, {
      processId: "process-a",
      name: "Synthetic disposable aspect",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "NORMAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    await deleteEnvironmentalAspect(contextA, aspect.id, "synthetic-user-a");
    expect(tables.aspects).toHaveLength(0);
  });

  it("refuses to delete an aspect under an active legal hold", async () => {
    const aspect = await createEnvironmentalAspect(contextA, {
      processId: "process-a",
      name: "Synthetic held aspect",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "NORMAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    vi.mocked(prisma.legalHold.findFirst).mockResolvedValueOnce({ id: "hold-1" } as never);
    await expect(deleteEnvironmentalAspect(contextA, aspect.id, "synthetic-user-a")).rejects.toThrow(AspectRegisterError);
    expect(tables.aspects).toHaveLength(1);
  });
});

describe("many-to-many impacts and evidence", () => {
  it("links one aspect to multiple organisation-owned impacts", async () => {
    const aspect = await createEnvironmentalAspect(contextA, {
      processId: "process-a",
      name: "Synthetic material input",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "NORMAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    const impactOne = await createEnvironmentalImpact(contextA, {
      name: "Synthetic resource impact",
      category: "Resource use",
      extent: "GLOBAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    const impactTwo = await createEnvironmentalImpact(contextA, {
      name: "Synthetic local receptor impact",
      category: "Local environment",
      extent: "LOCAL",
      effect: "ADVERSE",
      actorUserId: "synthetic-user-a",
    });
    await linkAspectToImpact(contextA, { aspectId: aspect.id, impactId: impactOne.id, actorUserId: "synthetic-user-a" });
    await linkAspectToImpact(contextA, { aspectId: aspect.id, impactId: impactTwo.id, actorUserId: "synthetic-user-a" });
    expect(tables.links).toHaveLength(2);
    expect(tables.links.every((link) => link.organisationId === ORG_A)).toBe(true);
  });

  it("rejects a mixed-organisation aspect/impact link before writing", async () => {
    tables.aspects.push({ id: "aspect-a", organisationId: ORG_A, processId: "process-a", name: "Synthetic aspect" });
    tables.impacts.push({ id: "impact-b", organisationId: ORG_B, name: "Synthetic foreign impact", category: "Synthetic" });
    await expect(linkAspectToImpact(contextA, {
      aspectId: "aspect-a",
      impactId: "impact-b",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(TenantOwnershipError);
    expect(tables.links).toHaveLength(0);
  });

  it("validates aspect ownership before linking evidence", async () => {
    tables.aspects.push({ id: "aspect-b", organisationId: ORG_B, processId: "process-b", name: "Synthetic foreign aspect" });
    await expect(attachEvidenceToAspect(contextA, {
      aspectId: "aspect-b",
      evidenceId: "evidence-a",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(TenantOwnershipError);
    expect(evidenceMocks.linkEvidence).not.toHaveBeenCalled();
  });
});
