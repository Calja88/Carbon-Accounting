import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// Synthetic, task-local in-memory records only.
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
vi.mock("@/lib/documents/evidence-service", () => ({ linkEvidence: vi.fn(), uploadEvidenceObject: vi.fn() }));

const monitoring = await import("@/lib/ems/monitoring/monitoring-service");
const calibration = await import("@/lib/ems/monitoring/calibration-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");
const { PermissionDeniedError } = await import("@/lib/rbac/authorize");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a", membershipId: "membership-a",
  permissions: new Set(["ems.view", "ems.monitoring.record", "ems.monitoring.review"]) as never,
});
const planInput = {
  planKey: "synthetic-plan", parameter: "Synthetic parameter", method: "Synthetic method",
  location: "Synthetic test bench", frequency: "Monthly", unit: "synthetic-unit",
  acceptanceCriteria: "Synthetic threshold only", aspectId: "aspect-a", controlId: "control-a",
  responsibleMembershipId: "membership-a", instrumentRequired: false, actorUserId: "synthetic-user-a",
};

beforeEach(() => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push({ id: "membership-a", organisationId: ORG_A, status: "ACTIVE" });
  tables.aspects.push({ id: "aspect-a", organisationId: ORG_A, process: { siteId: null, entityId: null } });
  tables.controls.push({ id: "control-a", organisationId: ORG_A, status: "ACTIVE", aspectLinks: [{ aspectId: "aspect-a", aspect: tables.aspects[0] }] });
});

describe("T34 environmental monitoring and calibration", () => {
  it("requires both an explicit method and unit", async () => {
    await expect(monitoring.createMonitoringPlan(context, { ...planInput, method: "" })).rejects.toThrow("method is mandatory");
    await expect(monitoring.createMonitoringPlan(context, { ...planInput, unit: "" })).rejects.toThrow("unit is mandatory");
    expect(tables.plans).toHaveLength(0);
  });

  it("denies a foreign-organisation aspect before creating a plan", async () => {
    tables.aspects[0].organisationId = ORG_B;
    await expect(monitoring.createMonitoringPlan(context, planInput)).rejects.toThrow(TenantOwnershipError);
    expect(tables.plans).toHaveLength(0);
  });

  it("enforces the plan unit and appends Decimal results without overwriting history", async () => {
    const plan = await monitoring.createMonitoringPlan(context, planInput);
    await expect(monitoring.recordMonitoringResult(context, {
      planId: plan.id, measuredAt: new Date("2026-08-01"), value: "1.25", unit: "other-unit",
      dataQualityFlag: "VALIDATED", actorUserId: "synthetic-user-a",
    })).rejects.toThrow('must exactly match the plan unit "synthetic-unit"');
    await monitoring.recordMonitoringResult(context, { planId: plan.id, measuredAt: new Date("2026-08-01"), value: "1.250000000001", unit: "synthetic-unit", dataQualityFlag: "VALIDATED", actorUserId: "synthetic-user-a" });
    await monitoring.recordMonitoringResult(context, { planId: plan.id, measuredAt: new Date("2026-08-02"), value: "1.30", unit: "synthetic-unit", dataQualityFlag: "ESTIMATED", actorUserId: "synthetic-user-a" });
    expect(tables.results).toHaveLength(2);
    expect(tables.results.map((row) => row.value.toString())).toEqual(["1.250000000001", "1.3"]);
  });

  it("retains out-of-tolerance calibration history and requires a documented review", async () => {
    const equipment = await calibration.createMonitoringEquipment(context, {
      reference: "synthetic-meter", description: "Synthetic meter", location: "Synthetic bench",
      calibrationFrequency: "Annual", calibrationDueDate: new Date("2026-08-01"), ownerMembershipId: "membership-a", actorUserId: "synthetic-user-a",
    });
    const record = await calibration.recordEquipmentCalibration(context, {
      equipmentId: equipment.id, dueDate: new Date("2026-08-01"), performedAt: new Date("2026-08-02"),
      provider: "Synthetic calibration provider", method: "Synthetic verification", result: "OUT_OF_TOLERANCE",
      nextDueDate: new Date("2027-08-02"), responseReference: "SYN-ACTION-01", actorUserId: "synthetic-user-a",
    });
    expect(tables.calibrations).toHaveLength(1);
    expect(tables.equipment[0]).toMatchObject({ status: "OUT_OF_SERVICE" });
    const listed = await calibration.listMonitoringEquipment(context, new Date("2026-08-13"));
    expect(listed[0].calibrations[0]).toMatchObject({ id: record.id, outOfTolerance: true, exceptionReview: null });
    await calibration.documentCalibrationExceptionReview(context, {
      calibrationId: record.id, reason: "Synthetic drift review", validityDecision: "PARTIALLY_VALID",
      consequence: "Synthetic records retained and scoped for follow-up", actionReference: "SYN-ACTION-01", actorUserId: "synthetic-user-a",
    });
    expect(tables.calibrations).toHaveLength(1);
    expect(tables.reviews[0]).toMatchObject({ calibrationId: record.id, validityDecision: "PARTIALLY_VALID" });
  });

  it("marks active equipment with a past calibration date as overdue", async () => {
    await calibration.createMonitoringEquipment(context, {
      reference: "synthetic-overdue-meter", description: "Synthetic overdue meter", location: "Synthetic bench",
      calibrationFrequency: "Annual", calibrationDueDate: new Date("2026-07-01"), ownerMembershipId: "membership-a", actorUserId: "synthetic-user-a",
    });
    const listed = await calibration.listMonitoringEquipment(context, new Date("2026-08-13"));
    expect(listed[0]).toMatchObject({ reference: "synthetic-overdue-meter", calibrationOverdue: true });
  });

  it("protects environmental result capture with the T34 permission", async () => {
    const denied = makeOrganisationContext(ORG_A, { userId: "synthetic-user-a", membershipId: "membership-a", permissions: new Set(["ems.view"]) as never });
    await expect(monitoring.createMonitoringPlan(denied, planInput)).rejects.toThrow(PermissionDeniedError);
  });
});
