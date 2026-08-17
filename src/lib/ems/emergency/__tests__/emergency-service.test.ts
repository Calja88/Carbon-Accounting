import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

// Test-only in-memory Prisma rows intentionally accept heterogeneous model fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const tables = vi.hoisted(() => ({
  aspects: [] as Row[],
  processes: [] as Row[],
  sites: [] as Row[],
  memberships: [] as Row[],
  revisions: [] as Row[],
  commsPlans: [] as Row[],
  scenarios: [] as Row[],
  plans: [] as Row[],
  exercises: [] as Row[],
  actions: [] as Row[],
  notifications: [] as Row[],
  nextId: 1,
}));

function scalarMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (["plans", "exercises", "actions"].includes(key)) return true;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

vi.mock("@/lib/prisma", () => {
  const environmentalAspect = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.aspects.find((row) => scalarMatches(row, where)) ?? null) };
  const activityProcess = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.processes.find((row) => scalarMatches(row, where)) ?? null) };
  const site = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.sites.find((row) => scalarMatches(row, where)) ?? null) };
  const organisationMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.memberships.find((row) => scalarMatches(row, where)) ?? null),
    findMany: vi.fn(async ({ where }: { where: Row }) => tables.memberships.filter((row) => scalarMatches(row, where))),
  };
  const controlledDocumentRevision = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.revisions.find((row) => scalarMatches(row, where)) ?? null) };
  const communicationPlan = { findFirst: vi.fn(async ({ where }: { where: Row }) => tables.commsPlans.find((row) => scalarMatches(row, where)) ?? null) };
  const emergencyScenario = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.scenarios.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `scenario-${tables.nextId++}`, status: "ACTIVE", ...data };
      tables.scenarios.push(row);
      return row;
    }),
  };
  const emergencyPlan = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.plans.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `plan-${tables.nextId++}`, status: "ACTIVE", ...data };
      tables.plans.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const key = where.organisationId_id ?? where;
      const row = tables.plans.find((item) => scalarMatches(item, key));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const emergencyExercise = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => tables.exercises.find((row) => scalarMatches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `exercise-${tables.nextId++}`, ...data };
      tables.exercises.push(row);
      return row;
    }),
  };
  const emergencyExerciseAction = {
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `action-${tables.nextId++}`, status: "OPEN", ...data };
      tables.actions.push(row);
      return row;
    }),
  };
  const notification = {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = { id: `notification-${tables.nextId++}`, ...data };
      tables.notifications.push(row);
      return row;
    }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const client: Row = {
    environmentalAspect, activityProcess, site, organisationMembership, controlledDocumentRevision,
    communicationPlan, emergencyScenario, emergencyPlan, emergencyExercise, emergencyExerciseAction, notification,
  };
  client.$transaction = vi.fn(async (callback: (tx: Row) => Promise<unknown>) => callback(client));
  return { prisma: client };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "synthetic-audit" })) }));
vi.mock("@/lib/documents/evidence-service", () => ({
  linkEvidence: vi.fn(),
  uploadEvidenceObject: vi.fn(),
}));

const {
  EmergencyPreparednessError,
  addExerciseAction,
  createEmergencyPlan,
  createEmergencyScenario,
  recordEmergencyExercise,
  reviseEmergencyPlan,
} = await import("@/lib/ems/emergency/emergency-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  membershipId: "membership-a",
  permissions: new Set(["ems.view", "ems.emergency_plan.manage", "ems.emergency_exercise.record"]) as never,
});

const scenarioInput = {
  name: "Synthetic chemical spill",
  triggerDescription: "Synthetic tank overfill",
  receptors: "Synthetic nearby watercourse",
  credibleConsequence: "Synthetic surface-water contamination",
  priority: "HIGH" as const,
  reviewDueDate: new Date("2026-12-01T00:00:00.000Z"),
  actorUserId: "synthetic-user-a",
};

function planInput(scenarioId: string, revisionId = "revision-a") {
  return {
    scenarioId,
    controlledDocumentRevisionId: revisionId,
    roles: "Synthetic incident controller role",
    resources: "Synthetic spill kit",
    effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
    reviewDueDate: new Date("2027-08-01T00:00:00.000Z"),
    actorUserId: "synthetic-user-a",
  };
}

beforeEach(() => {
  Object.values(tables).forEach((value) => { if (Array.isArray(value)) value.length = 0; });
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.memberships.push({ id: "membership-a", organisationId: ORG_A, status: "ACTIVE" });
  tables.memberships.push({ id: "membership-b", organisationId: ORG_A, status: "ACTIVE" });
  tables.revisions.push({ id: "revision-a", organisationId: ORG_A, status: "APPROVED" });
});

describe("T35 emergency preparedness workflow", () => {
  it("creates a scenario and a controlled-document-backed plan", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    const plan = await createEmergencyPlan(context, planInput(scenario.id));
    expect(plan).toMatchObject({ version: 1, status: "ACTIVE", controlledDocumentRevisionId: "revision-a" });
  });

  it("denies a plan whose controlled-document revision is not approved/effective", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    tables.revisions[0].status = "DRAFT";
    await expect(createEmergencyPlan(context, planInput(scenario.id))).rejects.toThrow(EmergencyPreparednessError);
  });

  it("keeps the prior plan version traceable when a revision creates a successor", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    const first = await createEmergencyPlan(context, planInput(scenario.id));
    const second = await reviseEmergencyPlan(context, first.id, { ...planInput(scenario.id), roles: "Synthetic revised role" });
    expect(first).toMatchObject({ version: 1, status: "SUPERSEDED" });
    expect(second).toMatchObject({ version: 2, status: "ACTIVE", supersedesPlanId: first.id });
  });

  it("pins the exact plan version an exercise was run against, even after a later revision", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    const planV1 = await createEmergencyPlan(context, planInput(scenario.id));
    const exercise = await recordEmergencyExercise(context, {
      scenarioId: scenario.id,
      planId: planV1.id,
      type: "TABLETOP",
      exerciseDate: new Date("2026-08-05T00:00:00.000Z"),
      participantMembershipIds: ["membership-a", "membership-b"],
      objectives: "Synthetic tabletop objectives",
      outcome: "SUCCESSFUL",
      actorUserId: "synthetic-user-a",
    });
    await reviseEmergencyPlan(context, planV1.id, { ...planInput(scenario.id), roles: "Synthetic revised role" });
    expect(exercise.planId).toBe(planV1.id);
    expect(tables.exercises[0].planId).toBe(planV1.id);
  });

  it("denies a foreign-organisation participant before recording an exercise", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    const plan = await createEmergencyPlan(context, planInput(scenario.id));
    await expect(recordEmergencyExercise(context, {
      scenarioId: scenario.id,
      planId: plan.id,
      type: "DRILL",
      exerciseDate: new Date("2026-08-05T00:00:00.000Z"),
      participantMembershipIds: ["foreign-membership"],
      objectives: "Synthetic objectives",
      outcome: "SUCCESSFUL",
      actorUserId: "synthetic-user-a",
    })).rejects.toThrow(TenantOwnershipError);
    expect(tables.exercises).toHaveLength(0);
  });

  it("never creates an incident/nonconformity automatically from a failed exercise, only an explicit action reference", async () => {
    const scenario = await createEmergencyScenario(context, scenarioInput);
    const plan = await createEmergencyPlan(context, planInput(scenario.id));
    const exercise = await recordEmergencyExercise(context, {
      scenarioId: scenario.id,
      planId: plan.id,
      type: "FULL_SCALE",
      exerciseDate: new Date("2026-08-05T00:00:00.000Z"),
      participantMembershipIds: ["membership-a"],
      objectives: "Synthetic objectives",
      outcome: "FAILED",
      actorUserId: "synthetic-user-a",
    });
    expect(tables.actions).toHaveLength(0);

    const action = await addExerciseAction(context, {
      exerciseId: exercise.id,
      description: "Synthetic follow-up after failed exercise",
      incidentReference: "synthetic-incident-ref-only",
      actorUserId: "synthetic-user-a",
    });
    expect(tables.actions).toHaveLength(1);
    expect(action.incidentReference).toBe("synthetic-incident-ref-only");
  });
});
