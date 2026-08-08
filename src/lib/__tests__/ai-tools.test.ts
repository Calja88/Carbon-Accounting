import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiDataEntryMode, AiLoggingLevel, AiTaskType, Role } from "@prisma/client";
import type { AiActor } from "@/lib/ai/scope";
import type { AiRuntimeConfig } from "@/lib/ai/config";

/**
 * The action layer's boundary.
 *
 * These tests are about what happens between a model naming a tool and the
 * application doing anything: the name has to exist, the arguments have to
 * parse and validate, the conversation has to be allowed the tool, and an
 * authorization failure has to come back as a refusal rather than an
 * exception. That is the whole security surface of "the AI can take actions",
 * so it is tested at the seam rather than through a model.
 *
 * No model is called anywhere in this file.
 */

const mocks = vi.hoisted(() => ({
  siteFindUnique: vi.fn(),
  siteFindMany: vi.fn(),
  entryFindMany: vi.fn(),
  documentFindUnique: vi.fn(),
  extractionFindFirst: vi.fn(),
  calculationFindUnique: vi.fn(),
  logEntryCandidate: vi.fn(),
  readDocument: vi.fn(),
  classifyEmission: vi.fn(),
  findFactorCandidates: vi.fn(),
  buildCarbonContext: vi.fn(),
  explainCalculation: vi.fn(),
  retract: vi.fn(),
  correct: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    site: { findUnique: mocks.siteFindUnique, findMany: mocks.siteFindMany },
    activityEntry: { findMany: mocks.entryFindMany },
    sourceDocument: { findUnique: mocks.documentFindUnique },
    documentExtraction: { findFirst: mocks.extractionFindFirst },
    calculation: { findUnique: mocks.calculationFindUnique },
  },
}));

vi.mock("@/lib/ai/entry-writer", () => ({ logEntryCandidate: mocks.logEntryCandidate }));
vi.mock("@/lib/ai/document-intake", () => ({ readDocumentForAssistant: mocks.readDocument }));
vi.mock("@/lib/ai/services/classify", () => ({ classifyEmission: mocks.classifyEmission }));
vi.mock("@/lib/ai/services/factor-suggest", () => ({ findFactorCandidates: mocks.findFactorCandidates }));
vi.mock("@/lib/ai/carbon-context", () => ({ buildCarbonContext: mocks.buildCarbonContext }));
vi.mock("@/lib/explain-calculation", () => ({
  explainCalculation: mocks.explainCalculation,
  formatExplanationForPrompt: () => "CALCULATION DETAIL",
}));
vi.mock("@/lib/ai/entry-corrections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/entry-corrections")>("@/lib/ai/entry-corrections");
  return {
    ...actual,
    retractAssistantEntry: mocks.retract,
    correctAssistantEntry: mocks.correct,
  };
});
// The LCA tools reach the LCA engine, which this suite doesn't exercise; they
// are here only to check that they are hidden outside an LCA project.
vi.mock("@/lib/lca/calculation-service", () => ({ loadAssessment: vi.fn(), previewCalculation: vi.fn() }));
vi.mock("@/lib/lca/model-service", () => ({ upsertInventoryItem: vi.fn() }));

const { executeTool, findTool, renderToolCatalogue, toolsFor } = await import("@/lib/ai/tools/registry");

const actor: AiActor = {
  userId: "user-1",
  name: "Test User",
  role: Role.SUSTAINABILITY_LEAD,
  isAdmin: false,
  entityIds: ["entity-a"],
  siteIds: ["site-a1"],
};

const config = {
  aiEnabled: true,
  openRouterEnabled: true,
  freeOnly: true,
  allowFreeRouter: true,
  autoAcceptExtraction: false,
  dataEntryMode: AiDataEntryMode.AUTO_LOG_HIGH_CONFIDENCE,
  autoExtractAttachments: true,
  minConfidence: 0.7,
  loggingLevel: AiLoggingLevel.STANDARD,
  requestsPerMinute: 12,
  requestsPerDay: 300,
  timeoutMs: 30000,
  maxDocumentBytes: 1024,
  taskModels: Object.fromEntries(
    Object.values(AiTaskType).map((task) => [task, { modelId: "vendor/primary:free", fallbackModelId: null }]),
  ),
} as AiRuntimeConfig;

function context(overrides: Record<string, unknown> = {}) {
  return {
    actor,
    config,
    userMessage: "Log 1,500 litres of diesel for July.",
    turnRequestId: "turn-1",
    interactionId: "interaction-1",
    periodStart: new Date("2026-07-01T00:00:00.000Z"),
    periodEnd: new Date("2026-07-31T00:00:00.000Z"),
    attachmentDocumentIds: [],
    conversationEntryIds: [],
    projectId: null,
    ...overrides,
  } as Parameters<typeof executeTool>[1];
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.siteFindMany.mockResolvedValue([{ id: "site-a1", name: "Hull" }]);
  mocks.siteFindUnique.mockResolvedValue({ id: "site-a1", name: "Hull" });
  mocks.logEntryCandidate.mockResolvedValue({
    status: "CREATED",
    card: { kind: "ENTRY_CREATED", entryId: "entry-1" },
    question: null,
    entryId: "entry-1",
    digest: "CREATED entry entry-1.",
  });
});

describe("what a model can and can't reach", () => {
  it("refuses a tool that doesn't exist", async () => {
    const outcome = await executeTool({ tool: "dropAllTables", argumentsJson: "{}" }, context());
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/not an action this platform offers/i);
  });

  it("offers no tool that takes a query, a table or raw SQL", () => {
    for (const tool of toolsFor({ projectId: "assessment-1" })) {
      expect(`${tool.name} ${tool.argsHint}`.toLowerCase()).not.toMatch(/\bsql\b|\btable\b|\bquery\b|\bwhere\b|\braw\b/);
    }
  });

  it("hides the LCA tools outside an LCA project", async () => {
    expect(findTool("addLcaFlow", { projectId: null })).toBeNull();
    expect(findTool("addLcaFlow", { projectId: "assessment-1" })).not.toBeNull();

    const outcome = await executeTool(
      { tool: "addLcaFlow", argumentsJson: JSON.stringify({ name: "Aluminium", itemType: "MATERIAL", quantity: 2.5, unit: "kg" }) },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/outside an LCA project/i);
  });

  it("lists only the tools a conversation may use in the catalogue it shows the model", () => {
    expect(renderToolCatalogue({ projectId: null })).not.toContain("addLcaFlow");
    expect(renderToolCatalogue({ projectId: "assessment-1" })).toContain("addLcaFlow");
    expect(renderToolCatalogue({ projectId: null })).toContain("createActivityEntry");
  });
});

describe("argument validation", () => {
  it("refuses arguments that aren't valid JSON", async () => {
    const outcome = await executeTool({ tool: "createActivityEntry", argumentsJson: "{not json" }, context());
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/not valid JSON/i);
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("refuses an argument object that doesn't match the schema", async () => {
    const outcome = await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({ dataPointCode: "S1-03", periodInput: "July 2026", quantity: 1500, unit: "litres" }),
      },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/arguments this platform doesn't accept/i);
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("refuses a negative or zero quantity before anything is written", async () => {
    for (const quantity of [0, -1500]) {
      const outcome = await executeTool(
        {
          tool: "createActivityEntry",
          argumentsJson: JSON.stringify({ dataPointCode: "S1-03", periodInput: "2026-07", quantity, unit: "litres" }),
        },
        context(),
      );
      expect(outcome.ok, String(quantity)).toBe(false);
    }
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("refuses an absurdly long argument string rather than parsing it", async () => {
    const outcome = await executeTool(
      { tool: "createActivityEntry", argumentsJson: "x".repeat(5000) },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/too long/i);
  });
});

describe("authorization", () => {
  it("refuses a site outside the caller's organisation", async () => {
    const outcome = await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({
          dataPointCode: "S1-03",
          siteId: "site-somewhere-else",
          periodInput: "2026-07",
          quantity: 1500,
          unit: "litres",
        }),
      },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.digest).toMatch(/isn't one you have access to/i);
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("asks which site rather than picking one when several are in scope", async () => {
    mocks.siteFindMany.mockResolvedValue([
      { id: "site-a1", name: "Hull" },
      { id: "site-a2", name: "Slough" },
    ]);
    const outcome = await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({ dataPointCode: "S1-03", periodInput: "2026-07", quantity: 1500, unit: "litres" }),
      },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.question).toMatch(/Hull, Slough/);
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("refuses to cite a document as evidence when the caller can't see it", async () => {
    mocks.documentFindUnique.mockResolvedValue({ id: "doc-x", siteId: "site-elsewhere", sha256: "abc" });
    const outcome = await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({
          dataPointCode: "S1-03",
          siteId: "site-a1",
          periodInput: "2026-07",
          quantity: 1500,
          unit: "litres",
          sourceDocumentId: "doc-x",
        }),
      },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(mocks.logEntryCandidate).not.toHaveBeenCalled();
  });

  it("refuses to explain a calculation belonging to another organisation's site", async () => {
    mocks.calculationFindUnique.mockResolvedValue({ activityEntry: { siteId: "site-elsewhere" } });
    const outcome = await executeTool(
      { tool: "explainCalculation", argumentsJson: JSON.stringify({ calculationId: "calc-x" }) },
      context(),
    );
    expect(outcome.ok).toBe(false);
    expect(mocks.explainCalculation).not.toHaveBeenCalled();
  });

  it("applies the caller's scope to a read, rather than trusting a supplied filter", async () => {
    mocks.entryFindMany.mockResolvedValue([]);
    await executeTool({ tool: "findExistingEntries", argumentsJson: "{}" }, context());
    const where = mocks.entryFindMany.mock.calls[0][0].where;
    expect(where.siteId).toEqual({ in: ["site-a1"] });
  });
});

describe("destructive actions", () => {
  it("will not withdraw an entry unless the user's own message asked for it", async () => {
    const outcome = await executeTool(
      { tool: "retractActivityEntry", argumentsJson: JSON.stringify({ entryId: "entry-1" }) },
      context({ userMessage: "Thanks, that looks right.", conversationEntryIds: ["entry-1"] }),
    );
    expect(outcome.ok).toBe(false);
    expect(mocks.retract).not.toHaveBeenCalled();
    expect(outcome.question).toMatch(/withdraw/i);
  });

  it("withdraws it when they did ask", async () => {
    mocks.retract.mockResolvedValue({ digest: "WITHDRAWN entry entry-1.", cards: [] });
    const outcome = await executeTool(
      { tool: "retractActivityEntry", argumentsJson: JSON.stringify({ entryId: "entry-1" }) },
      context({ userMessage: "Delete the entry you just created.", conversationEntryIds: ["entry-1"] }),
    );
    expect(outcome.ok).toBe(true);
    expect(mocks.retract).toHaveBeenCalledWith(actor, "entry-1", ["entry-1"], "");
  });

  it("passes only this conversation's entries as referable, so a stray id can't be reached", async () => {
    mocks.correct.mockResolvedValue({ digest: "CORRECTED.", cards: [], entryId: "entry-2" });
    await executeTool(
      { tool: "updateActivityEntry", argumentsJson: JSON.stringify({ entryId: "entry-99", quantity: 1550 }) },
      context({ userMessage: "Change that to 1,550 litres.", conversationEntryIds: ["entry-1"] }),
    );
    // The tool hands the allow-list straight to the correction service, which
    // refuses an id that isn't in it (see ai-entry-corrections coverage).
    expect(mocks.correct.mock.calls[0][2]).toEqual(["entry-1"]);
  });

  it("changes nothing when a correction names no change", async () => {
    const outcome = await executeTool(
      { tool: "updateActivityEntry", argumentsJson: JSON.stringify({ entryId: "entry-1" }) },
      context({ conversationEntryIds: ["entry-1"] }),
    );
    expect(outcome.ok).toBe(false);
    expect(mocks.correct).not.toHaveBeenCalled();
  });
});

describe("recording from a chat instruction", () => {
  it("hands the user's own message to the duplicate-override check, not the model's version of it", async () => {
    await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({
          dataPointCode: "S1-03",
          siteId: "site-a1",
          periodInput: "2026-07",
          quantity: 1500,
          unit: "litres",
          subtypeKey: "diesel",
        }),
      },
      context({ userMessage: "Log 1,500 litres of diesel for July." }),
    );

    const [, candidate, options] = mocks.logEntryCandidate.mock.calls[0];
    expect(candidate.dataPointCode).toBe("S1-03");
    expect(candidate.subtypeKey).toBe("diesel");
    expect(candidate.sourceDocumentId).toBeNull();
    expect(options.trigger).toBe("USER_INSTRUCTION");
    expect(options.allowDuplicate).toBe(false);
    expect(options.turnRequestId).toBe("turn-1");
  });

  it("honours an override only when the user said so themselves", async () => {
    await executeTool(
      {
        tool: "createActivityEntry",
        argumentsJson: JSON.stringify({
          dataPointCode: "S1-03",
          siteId: "site-a1",
          periodInput: "2026-07",
          quantity: 1500,
          unit: "litres",
        }),
      },
      context({ userMessage: "It's a separate delivery — record it anyway." }),
    );
    expect(mocks.logEntryCandidate.mock.calls[0][2].allowDuplicate).toBe(true);
  });
});
