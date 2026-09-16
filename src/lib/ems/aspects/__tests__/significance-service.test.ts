import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_A, ORG_B, makeOrganisationContext } from "@/lib/__tests__/tenant-fixtures";

type Row = Record<string, unknown>;
type FindArgs = { where: Row; orderBy?: Row };
type UpdateArgs = { where: Row & { organisationId_id?: Row }; data: Row };

const tables = vi.hoisted(() => ({
  programmes: [] as Row[],
  aspects: [] as Row[],
  methods: [] as Row[],
  assessments: [] as Row[],
  nextId: 1,
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function find(rows: Row[], where: Row) {
  return rows.find((row) => matches(row, where)) ?? null;
}

vi.mock("@/lib/prisma", () => {
  const emsProgramme = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.programmes, where)) };
  const environmentalAspect = { findFirst: vi.fn(async ({ where }: FindArgs) => find(tables.aspects, where)) };
  const significanceMethod = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const rows = tables.methods.filter((row) => matches(row, where));
      if (orderBy?.version === "desc") rows.sort((a, b) => Number(b.version) - Number(a.version));
      return rows[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.methods.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Row & { criteria: { create: Row[] } } }) => {
      const { criteria: criteriaEnvelope, ...methodData } = data;
      const criteria = criteriaEnvelope.create.map((criterion, index) => ({
        id: `criterion-${tables.nextId}-${index}`,
        methodId: `method-${tables.nextId}`,
        ...criterion,
      }));
      const row: Row = { id: `method-${tables.nextId++}`, status: "DRAFT", approvedAt: null, approvedByMembershipId: null, ...methodData, criteria };
      tables.methods.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.methods, key);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
    delete: vi.fn(async ({ where }: { where: Row & { organisationId_id?: Row } }) => {
      const key = where.organisationId_id ?? where;
      const index = tables.methods.findIndex((row) => matches(row, key));
      if (index < 0) throw new Error("not found");
      return tables.methods.splice(index, 1)[0];
    }),
  };
  const aspectAssessment = {
    findFirst: vi.fn(async ({ where, orderBy }: FindArgs) => {
      const rows = tables.assessments.filter((row) => matches(row, where));
      if (orderBy?.assessmentVersion === "desc") rows.sort((a, b) => Number(b.assessmentVersion) - Number(a.assessmentVersion));
      return rows[0] ?? null;
    }),
    findMany: vi.fn(async ({ where }: FindArgs) => tables.assessments.filter((row) => matches(row, where))),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row: Row = { id: `assessment-${tables.nextId++}`, status: "DRAFT", approvedAt: null, approvedByMembershipId: null, ...data };
      tables.assessments.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: UpdateArgs) => {
      const key = where.organisationId_id ?? where;
      const row = find(tables.assessments, key);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    }),
  };
  const prismaClient = {
    emsProgramme,
    environmentalAspect,
    significanceMethod,
    aspectAssessment,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaClient)),
  };
  return { prisma: prismaClient };
});

vi.mock("@/lib/repositories/audit-repository", () => ({ recordAuditEvent: vi.fn(async () => ({ id: "audit-synthetic" })) }));

const {
  SignificanceWorkflowError,
  approveAspectAssessment,
  approveSignificanceMethod,
  createAspectAssessment,
  createSignificanceMethod,
  createSuccessorSignificanceMethod,
  discardSignificanceMethod,
} = await import("@/lib/ems/aspects/significance-service");
const { TenantOwnershipError } = await import("@/lib/repositories/tenant-scope");

const context = makeOrganisationContext(ORG_A, {
  userId: "synthetic-user-a",
  membershipId: "synthetic-membership-a",
  permissions: new Set(["ems.view", "ems.aspect.edit", "ems.aspect.approve"]) as never,
});

const definition = {
  programmeId: "programme-a",
  methodKey: "synthetic-method",
  name: "Synthetic significance method",
  formulaConfig: { formula: "WEIGHTED_SUM" as const },
  threshold: "8",
  criteria: [{
    key: "severity",
    label: "Severity",
    scaleConfig: { kind: "NUMERIC" as const, min: "1", max: "5" },
    weight: "2",
    required: true,
    sortOrder: 0,
  }],
};

beforeEach(() => {
  tables.programmes.length = 0;
  tables.aspects.length = 0;
  tables.methods.length = 0;
  tables.assessments.length = 0;
  tables.nextId = 1;
  vi.clearAllMocks();
  tables.programmes.push({ id: "programme-a", organisationId: ORG_A, name: "Synthetic EMS" });
  tables.aspects.push({ id: "aspect-a", organisationId: ORG_A, name: "Synthetic aspect", process: { programmeId: "programme-a" } });
});

describe("versioned significance workflow", () => {
  it("pins historic method/input/result snapshots across a method revision and successor reassessment", async () => {
    const firstMethod = await createSignificanceMethod(context, definition);
    await approveSignificanceMethod(context, firstMethod.id);
    const firstAssessment = await createAspectAssessment(context, {
      aspectId: "aspect-a",
      methodId: firstMethod.id,
      inputs: { severity: "4" },
    });
    await approveAspectAssessment(context, firstAssessment.id);

    const secondMethod = await createSuccessorSignificanceMethod(context, firstMethod.id, {
      name: "Synthetic revised method",
      formulaConfig: { formula: "MAX_CRITERION" },
      threshold: "5",
      criteria: definition.criteria,
    });
    await approveSignificanceMethod(context, secondMethod.id);
    const secondAssessment = await createAspectAssessment(context, {
      aspectId: "aspect-a",
      methodId: secondMethod.id,
      inputs: { severity: "4" },
    });

    expect(firstAssessment).toMatchObject({
      methodVersionSnapshot: 1,
      formulaSnapshot: "WEIGHTED_SUM",
      thresholdSnapshot: "8",
      calculatedScore: "8",
      calculatedSignificant: true,
      criterionInputs: { severity: "4" },
    });
    expect(secondAssessment).toMatchObject({
      assessmentVersion: 2,
      methodVersionSnapshot: 2,
      formulaSnapshot: "MAX_CRITERION",
      calculatedScore: "4",
      calculatedSignificant: false,
      supersedesAssessmentId: firstAssessment.id,
    });
    expect(firstAssessment.calculatedScore).toBe("8");
  });

  it("keeps calculated and final outcomes separate for a justified permitted override", async () => {
    const method = await createSignificanceMethod(context, definition);
    await approveSignificanceMethod(context, method.id);
    const assessment = await createAspectAssessment(context, {
      aspectId: "aspect-a",
      methodId: method.id,
      inputs: { severity: "4" },
      overrideSignificant: false,
      overrideRationale: "Synthetic documented review rationale.",
    });
    expect(assessment).toMatchObject({ calculatedSignificant: true, overrideSignificant: false, finalSignificant: false });
  });

  it("requires approve permission and a rationale for overrides", async () => {
    const method = await createSignificanceMethod(context, definition);
    await approveSignificanceMethod(context, method.id);
    const editor = makeOrganisationContext(ORG_A, {
      membershipId: "synthetic-editor",
      permissions: new Set(["ems.aspect.edit"]) as never,
    });
    await expect(createAspectAssessment(editor, {
      aspectId: "aspect-a", methodId: method.id, inputs: { severity: "4" }, overrideSignificant: false,
      overrideRationale: "Synthetic rationale",
    })).rejects.toThrow(/permission/i);
    await expect(createAspectAssessment(context, {
      aspectId: "aspect-a", methodId: method.id, inputs: { severity: "4" }, overrideSignificant: false,
    })).rejects.toThrow(/rationale/i);
  });

  it("denies a foreign aspect or method before an assessment write", async () => {
    tables.aspects.push({ id: "aspect-b", organisationId: ORG_B, process: { programmeId: "programme-b" } });
    tables.methods.push({ id: "method-b", organisationId: ORG_B, status: "APPROVED", criteria: [] });
    await expect(createAspectAssessment(context, {
      aspectId: "aspect-b", methodId: "method-b", inputs: {},
    })).rejects.toThrow(TenantOwnershipError);
    expect(tables.assessments).toHaveLength(0);
  });
});

describe("discarding a draft significance method", () => {
  it("removes a draft method outright", async () => {
    const method = await createSignificanceMethod(context, definition);
    await discardSignificanceMethod(context, method.id, "synthetic-user-a");
    expect(tables.methods).toHaveLength(0);
  });

  it("refuses to discard an approved or superseded method", async () => {
    const method = await createSignificanceMethod(context, definition);
    await approveSignificanceMethod(context, method.id);
    await expect(discardSignificanceMethod(context, method.id, "synthetic-user-a")).rejects.toThrow(SignificanceWorkflowError);
    expect(tables.methods).toHaveLength(1);
  });

  it("denies discarding a method from a foreign organisation", async () => {
    tables.methods.push({ id: "method-b", organisationId: ORG_B, status: "DRAFT", criteria: [] });
    await expect(discardSignificanceMethod(context, "method-b", "synthetic-user-a")).rejects.toThrow(TenantOwnershipError);
    expect(tables.methods).toHaveLength(1);
  });
});
