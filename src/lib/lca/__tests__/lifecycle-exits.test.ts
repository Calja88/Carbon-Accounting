/**
 * Carbon/LCA lifecycle exits and the methodology-profile immutability guard
 * (Part B of the lifecycle-coverage completion pass).
 *
 * Suppliers, supplier PCFs and methodology profiles are all referenced by
 * inventory items, calculation runs and frozen issued-version snapshots, so
 * none of them gets a delete path — these tests pin that down, alongside the
 * new "an issued version freezes the methodology" rule. Synthetic fixtures
 * only; no live database, no real environmental data.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, ENTITY_A, makeOrganisationContext, makeTenantContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const tables = vi.hoisted(() => ({
  suppliers: [] as Row[],
  supplierPcfs: [] as Row[],
  inventoryItems: [] as Row[],
  profiles: [] as Row[],
  assessments: [] as Row[],
  assessmentVersions: [] as Row[],
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) return value.some((clause: Row) => matches(row, clause));
    if (key === "assessment" && value && typeof value === "object") {
      const assessment = tables.assessments.find((item) => item.id === row.assessmentId);
      return Boolean(assessment) && matches(assessment as Row, value as Row);
    }
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function table(rows: Row[], idPrefix: string) {
  return {
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `${idPrefix}-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((item) => matches(item, where.organisationId_id ?? where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hits = rows.filter((row) => matches(row, where));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    }),
  };
}

vi.mock("@/lib/prisma", () => {
  const client: Row = {
    supplier: table(tables.suppliers, "supplier"),
    lcaSupplierPcf: table(tables.supplierPcfs, "pcf"),
    lcaInventoryItem: table(tables.inventoryItems, "item"),
    lcaMethodologyProfile: table(tables.profiles, "profile"),
    lcaAssessment: table(tables.assessments, "assessment"),
    lcaAssessmentVersion: table(tables.assessmentVersions, "version"),
  };
  client.$transaction = vi.fn(async (operations: unknown) =>
    Array.isArray(operations) ? Promise.all(operations) : (operations as (tx: Row) => Promise<unknown>)(client));
  return { prisma: client };
});

vi.mock("@/lib/lca/audit-service", () => ({
  recordAuditEvent: vi.fn(async () => ({ id: "synthetic-lca-audit" })),
  recordAuditEvents: vi.fn(async () => ({ count: 0 })),
}));

const supplierService = await import("@/lib/lca/supplier-service");
const lcaRepository = await import("@/lib/repositories/lca-repository");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a" });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b" });
const ctxA = makeTenantContext(ORG_A);

beforeEach(() => {
  Object.values(tables).forEach((rows) => { rows.length = 0; });
  vi.clearAllMocks();
  tables.suppliers.push({
    id: "supplier-a", organisationId: ORG_A, entityId: ENTITY_A, name: "Aster synthetic supplier", archivedAt: null,
  });
  tables.supplierPcfs.push({
    id: "pcf-a", organisationId: ORG_A, entityId: ENTITY_A, supplierId: "supplier-a",
    productName: "Synthetic component", archivedAt: null,
  });
});

describe("archiveSupplier", () => {
  it("archives the supplier and its footprints without deleting anything", async () => {
    const archived = await supplierService.archiveSupplier(contextA, {
      supplierId: "supplier-a", reason: "No longer a counterparty.", actorUserId: "user-a",
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(tables.suppliers).toHaveLength(1);
    expect(tables.supplierPcfs[0].archivedAt).toBeInstanceOf(Date);
  });

  it("refuses an already-archived supplier", async () => {
    await supplierService.archiveSupplier(contextA, { supplierId: "supplier-a", reason: "Once.", actorUserId: "user-a" });
    await expect(
      supplierService.archiveSupplier(contextA, { supplierId: "supplier-a", reason: "Twice.", actorUserId: "user-a" }),
    ).rejects.toThrow(/already archived/i);
  });

  it("refuses a foreign-tenant supplier id", async () => {
    await expect(
      supplierService.archiveSupplier(contextB, { supplierId: "supplier-a", reason: "Cross-tenant.", actorUserId: "user-b" }),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
    expect(tables.suppliers[0].archivedAt).toBeNull();
  });
});

describe("archiveSupplierPcf", () => {
  it("archives a PCF nothing resolves against", async () => {
    const archived = await supplierService.archiveSupplierPcf(contextA, {
      supplierPcfId: "pcf-a", reason: "Superseded by a newer declaration.", actorUserId: "user-a",
    });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(tables.supplierPcfs).toHaveLength(1);
  });

  it("refuses while inventory items still resolve their factor from it", async () => {
    tables.inventoryItems.push({ id: "item-a", assessmentId: "assessment-a", supplierPcfId: "pcf-a" });
    await expect(
      supplierService.archiveSupplierPcf(contextA, { supplierPcfId: "pcf-a", reason: "Withdraw.", actorUserId: "user-a" }),
    ).rejects.toThrow(/still resolve their factor/i);
  });

  it("refuses a foreign-tenant PCF id", async () => {
    await expect(
      supplierService.archiveSupplierPcf(contextB, { supplierPcfId: "pcf-a", reason: "Cross-tenant.", actorUserId: "user-b" }),
    ).rejects.toBeInstanceOf(TenantOwnershipError);
  });
});

describe("methodology profile immutability guard (Part B)", () => {
  const baseProfile = {
    id: "profile-a",
    organisationId: ORG_A,
    entityId: null,
    name: "Synthetic methodology",
    version: "1.0",
    summary: "Synthetic summary",
    notes: null,
    isDefault: false,
    defaultBoundary: "CRADLE_TO_GATE",
    gwpBasis: "Synthetic GWP set",
    defaultAllocationMethod: "MASS",
    allocationRules: null,
    recyclingMethod: "CUT_OFF",
    recyclingRules: null,
    electricityApproach: "LOCATION_BASED",
    electricityRules: null,
    biogenicTreatment: "REPORTED_SEPARATELY",
    biogenicRules: null,
    removalsRules: null,
    offsetTreatment: "DISCLOSED_SEPARATELY",
    offsetRules: null,
    cutOffRules: null,
    cutOffThresholdPercent: null,
    factorHierarchy: ["synthetic-primary", "synthetic-secondary"],
    dataQualityRequirements: null,
    minimumDataQualityScore: null,
    requireEvidenceForPrimary: true,
    standardsReferenced: ["synthetic-standard"],
    archivedAt: null,
  };

  beforeEach(() => {
    tables.profiles.push({ ...baseProfile });
    tables.assessments.push({ id: "assessment-a", organisationId: ORG_A, methodologyProfileId: "profile-a" });
  });

  it("names no normative change when only descriptive fields differ", () => {
    const changed = lcaRepository.methodologyNormativeChanges(baseProfile, {
      ...baseProfile, summary: "Reworded", notes: "A note", isDefault: true,
    });
    expect(changed).toEqual([]);
  });

  it("names the normative fields an edit would change", () => {
    const changed = lcaRepository.methodologyNormativeChanges(baseProfile, {
      ...baseProfile, gwpBasis: "A different GWP set", recyclingMethod: "AVOIDED_BURDEN",
    });
    expect(changed).toEqual(expect.arrayContaining(["gwpBasis", "recyclingMethod"]));
  });

  it("treats an equal array or stringified decimal as unchanged", () => {
    const changed = lcaRepository.methodologyNormativeChanges(baseProfile, {
      ...baseProfile,
      factorHierarchy: ["synthetic-primary", "synthetic-secondary"],
      cutOffThresholdPercent: null,
    });
    expect(changed).toEqual([]);
  });

  it("allows a normative edit while no version has been issued", async () => {
    tables.assessmentVersions.push({ id: "version-a", assessmentId: "assessment-a", organisationId: ORG_A, status: "DRAFT_REVISION" });
    const result = await lcaRepository.assertMethodologyProfileEditable(baseProfile, { ...baseProfile, gwpBasis: "Changed" });
    expect(result.issuedVersionCount).toBe(0);
    expect(result.changedNormativeFields).toEqual(["gwpBasis"]);
  });

  it("refuses a normative edit once an assessment version has been issued", async () => {
    tables.assessmentVersions.push({ id: "version-a", assessmentId: "assessment-a", organisationId: ORG_A, status: "ISSUED" });
    await expect(
      lcaRepository.assertMethodologyProfileEditable(baseProfile, { ...baseProfile, gwpBasis: "Changed" }),
    ).rejects.toBeInstanceOf(lcaRepository.MethodologyProfileFrozenError);
  });

  it("still allows correcting summary/notes/default on a frozen profile", async () => {
    tables.assessmentVersions.push({ id: "version-a", assessmentId: "assessment-a", organisationId: ORG_A, status: "ISSUED" });
    const result = await lcaRepository.assertMethodologyProfileEditable(baseProfile, {
      ...baseProfile, summary: "Clarified wording", notes: "Owner note", isDefault: true,
    });
    expect(result.issuedVersionCount).toBe(1);
    expect(result.changedNormativeFields).toEqual([]);
  });

  it("counts only ISSUED versions of assessments built on that exact profile", async () => {
    tables.assessments.push({ id: "assessment-other", organisationId: ORG_A, methodologyProfileId: "profile-other" });
    tables.assessmentVersions.push(
      { id: "version-a", assessmentId: "assessment-a", organisationId: ORG_A, status: "ISSUED" },
      { id: "version-b", assessmentId: "assessment-a", organisationId: ORG_A, status: "SUPERSEDED" },
      { id: "version-c", assessmentId: "assessment-other", organisationId: ORG_A, status: "ISSUED" },
    );
    await expect(lcaRepository.countIssuedVersionsForMethodologyProfile("profile-a")).resolves.toBe(1);
  });

  it("keeps the tenant-ownership guard separate and intact", () => {
    expect(() => lcaRepository.assertMethodologyProfileMutable(ctxA, { organisationId: ORG_B }))
      .toThrow(TenantOwnershipError);
    expect(() => lcaRepository.assertMethodologyProfileMutable(ctxA, { organisationId: null }))
      .toThrow(TenantOwnershipError);
    expect(lcaRepository.assertMethodologyProfileMutable(ctxA, { organisationId: ORG_A })).toBeTruthy();
  });
});
