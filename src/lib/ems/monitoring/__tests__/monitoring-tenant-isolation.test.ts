/**
 * Two-tenant adversarial tests for T34 environmental monitoring and
 * calibration (T80, Docs/PHASE8_HARDENING_READINESS_SPEC.md §3). T34 ships
 * without separate `findTenant*` repository wrappers — every read/mutation
 * in `monitoring-service.ts`/`calibration-service.ts` scopes inline via
 * `tenantWhere` (see `findVisiblePlan`/`findVisibleResult`/
 * `findVisibleEquipment`/`findVisibleCalibration`). This file proves that
 * inline scoping actually blocks a foreign-tenant id at every public entry
 * point for MonitoringPlan, MonitoringResult, MonitoringEquipment and
 * EquipmentCalibration — the four T34 resource roots the resource/endpoint
 * registry (`src/lib/security/resource-endpoint-registry.ts`) names as
 * "service"-shaped. Synthetic Aster/Birch fixtures only, no live database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = vi.hoisted(() => ({
  aspects: [] as Row[], controls: [] as Row[], memberships: [] as Row[], plans: [] as Row[],
  results: [] as Row[], equipment: [] as Row[], calibrations: [] as Row[], reviews: [] as Row[],
  notifications: [] as Row[], nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (["OR", "aspect", "control", "plan", "equipment", "plans"].includes(key)) return true;
    if (value && typeof value === "object" && "lt" in value) return row[key] < value.lt;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const environmentalAspect = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.aspects.find((row) => matches(row, where)) ?? null) };
  const operationalControl = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.controls.find((row) => matches(row, where)) ?? null) };
  const organisationMembership = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => matches(row, where)) ?? null) };
  const monitoringPlan = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.plans.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.plans.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `plan-${tables.nextId++}`, status: "ACTIVE", ...data }; tables.plans.push(row); return row; }),
  };
  const monitoringResult = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.results.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `result-${tables.nextId++}`, ...data }; tables.results.push(row); return row; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = tables.results.find((item) => matches(item, where.organisationId_id ?? where)); if (!row) throw new Error("not found"); Object.assign(row, data); return row; }),
  };
  const monitoringEquipment = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.equipment.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.equipment.filter((row) => matches(row, where)).map((row) => ({ ...row, calibrations: tables.calibrations.filter((item) => item.equipmentId === row.id).map((item) => ({ ...item, exceptionReview: tables.reviews.find((review) => review.calibrationId === item.id) ?? null })) }))),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `equipment-${tables.nextId++}`, status: "ACTIVE", ...data }; tables.equipment.push(row); return row; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = tables.equipment.find((item) => matches(item, where.organisationId_id ?? where)); if (!row) throw new Error("not found"); Object.assign(row, data); return row; }),
  };
  const equipmentCalibration = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => { const row = tables.calibrations.find((item) => matches(item, where)); return row ? { ...row, exceptionReview: tables.reviews.find((review) => review.calibrationId === row.id) ?? null } : null; }),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `calibration-${tables.nextId++}`, ...data }; tables.calibrations.push(row); return row; }),
  };
  const monitoringExceptionReview = { create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `review-${tables.nextId++}`, reviewedAt: new Date("2026-08-13T12:00:00.000Z"), ...data }; tables.reviews.push(row); return row; }) };
  const notification = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.notifications.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: `notification-${tables.nextId++}`, ...data }; tables.notifications.push(row); return row; }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const client: Row = { environmentalAspect, operationalControl, organisationMembership, monitoringPlan, monitoringResult, monitoringEquipment, equipmentCalibration, monitoringExceptionReview, notification };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({ linkEvidence: vi.fn(), uploadEvidenceObject: vi.fn(async () => ({ id: "synthetic-evidence" })) }));

const monitoring = await import("@/lib/ems/monitoring/monitoring-service");
const calibration = await import("@/lib/ems/monitoring/calibration-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const PERMS = new Set(["ems.view", "ems.monitoring.record", "ems.monitoring.review"]) as never;
const contextA = makeOrganisationContext(ORG_A, { userId: "user-a", membershipId: "membership-a", permissions: PERMS });
const contextB = makeOrganisationContext(ORG_B, { userId: "user-b", membershipId: "membership-b", permissions: PERMS });

let planA: Row;
let resultA: Row;
let equipmentA: Row;
let calibrationA: Row;

beforeEach(async () => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push(
    { id: "membership-a", organisationId: ORG_A, status: "ACTIVE" },
    { id: "membership-b", organisationId: ORG_B, status: "ACTIVE" },
  );
  tables.aspects.push(
    { id: "aspect-a", organisationId: ORG_A, process: { siteId: null, entityId: null } },
    { id: "aspect-b", organisationId: ORG_B, process: { siteId: null, entityId: null } },
  );
  tables.controls.push(
    { id: "control-a", organisationId: ORG_A, status: "ACTIVE", aspectLinks: [{ aspectId: "aspect-a", aspect: tables.aspects[0] }] },
    { id: "control-b", organisationId: ORG_B, status: "ACTIVE", aspectLinks: [{ aspectId: "aspect-b", aspect: tables.aspects[1] }] },
  );

  planA = await monitoring.createMonitoringPlan(contextA, {
    planKey: "plan-a", parameter: "Synthetic parameter", method: "Synthetic method", location: "Aster bench",
    frequency: "Monthly", unit: "synthetic-unit", acceptanceCriteria: "Synthetic threshold", aspectId: "aspect-a",
    controlId: "control-a", responsibleMembershipId: "membership-a", instrumentRequired: false, actorUserId: "user-a",
  });
  resultA = await monitoring.recordMonitoringResult(contextA, {
    planId: planA.id, measuredAt: new Date("2026-08-01"), value: "1.0", unit: "synthetic-unit",
    dataQualityFlag: "VALIDATED", actorUserId: "user-a",
  });
  equipmentA = await calibration.createMonitoringEquipment(contextA, {
    reference: "meter-a", description: "Aster meter", location: "Aster bench", calibrationFrequency: "Annual",
    calibrationDueDate: new Date("2026-08-01"), ownerMembershipId: "membership-a", actorUserId: "user-a",
  });
  calibrationA = await calibration.recordEquipmentCalibration(contextA, {
    equipmentId: equipmentA.id, dueDate: new Date("2026-08-01"), performedAt: new Date("2026-08-02"),
    provider: "Aster calibration provider", method: "Synthetic verification", result: "OUT_OF_TOLERANCE",
    nextDueDate: new Date("2027-08-02"), responseReference: "AST-ACTION-01", actorUserId: "user-a",
  });
});

describe("MonitoringPlan cross-tenant isolation", () => {
  it("does not include Organisation A's plan when Organisation B lists plans", async () => {
    const listed = await monitoring.listMonitoringPlans(contextB);
    expect(listed.map((plan) => plan.id)).not.toContain(planA.id);
  });

  it("denies Organisation B recording a result against Organisation A's plan id", async () => {
    await expect(
      monitoring.recordMonitoringResult(contextB, {
        planId: planA.id, measuredAt: new Date("2026-08-03"), value: "9.9", unit: "synthetic-unit",
        dataQualityFlag: "VALIDATED", actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("MonitoringResult cross-tenant isolation", () => {
  it("denies Organisation B reviewing Organisation A's result by guessing its id", async () => {
    await expect(
      monitoring.reviewMonitoringResult(contextB, { resultId: resultA.id, reviewNote: "Reviewed", actorUserId: "user-b" }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies Organisation B documenting an exception review against Organisation A's result", async () => {
    await expect(
      monitoring.documentResultExceptionReview(contextB, {
        resultId: resultA.id, reason: "Attempted foreign review", validityDecision: "INVALID",
        consequence: "n/a", actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies Organisation B attaching evidence to Organisation A's result", async () => {
    await expect(
      monitoring.uploadEvidenceToMonitoringResult(contextB, {
        resultId: resultA.id, fileName: "synthetic.pdf", mimeType: "application/pdf",
        bytes: Buffer.from("synthetic"), actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("MonitoringEquipment cross-tenant isolation", () => {
  it("does not include Organisation A's equipment when Organisation B lists equipment", async () => {
    const listed = await calibration.listMonitoringEquipment(contextB);
    expect(listed.map((item) => item.id)).not.toContain(equipmentA.id);
  });

  it("denies Organisation B recording a calibration against Organisation A's equipment id", async () => {
    await expect(
      calibration.recordEquipmentCalibration(contextB, {
        equipmentId: equipmentA.id, dueDate: new Date("2026-08-01"), performedAt: new Date("2026-08-03"),
        provider: "Foreign provider", method: "Synthetic verification", result: "PASS",
        nextDueDate: new Date("2027-08-03"), actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});

describe("EquipmentCalibration cross-tenant isolation", () => {
  it("denies Organisation B documenting an exception review against Organisation A's calibration", async () => {
    await expect(
      calibration.documentCalibrationExceptionReview(contextB, {
        calibrationId: calibrationA.id, reason: "Attempted foreign review", validityDecision: "INVALID",
        consequence: "n/a", actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });

  it("denies Organisation B uploading a calibration certificate against Organisation A's calibration", async () => {
    await expect(
      calibration.uploadCalibrationCertificate(contextB, {
        calibrationId: calibrationA.id, fileName: "cert.pdf", mimeType: "application/pdf",
        bytes: Buffer.from("synthetic"), actorUserId: "user-b",
      }),
    ).rejects.toThrow(TenantOwnershipError);
  });
});
