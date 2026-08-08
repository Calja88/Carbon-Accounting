/**
 * The carbon-accounting actions the assistant may request.
 *
 * Every one of them is an ordinary application operation with an argument
 * schema in front of it. Reads run fixed queries with the actor's scope
 * applied in code; writes go through the same services the data-entry screens
 * use, so plausibility checks, factor resolution, Scope 2 dual reporting and
 * the calculation audit trail behave identically whether a person typed the
 * figure or the assistant did.
 *
 * Note what the write tools do *not* accept: an emission factor, a factor
 * value, a factor year, a source name, or a kgCO2e figure. There is no
 * argument through which a model could supply one, so there is no path by
 * which an invented factor could reach a calculation.
 */

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { explainCalculation, formatExplanationForPrompt } from "@/lib/explain-calculation";
import { classifyEmission } from "../services/classify";
import { findFactorCandidates } from "../services/factor-suggest";
import { buildCarbonContext } from "../carbon-context";
import { readDocumentForAssistant } from "../document-intake";
import { logEntryCandidate, type EntryCandidate } from "../entry-writer";
import { correctAssistantEntry, EntryCorrectionError, retractAssistantEntry, userConfirmedRetraction } from "../entry-corrections";
import { userOverrodeDuplicate } from "../duplicate-check";
import { assertSiteInScope, isSiteInScope } from "../scope";
import { resolveMonthRange } from "@/lib/report-period";
import { AiToolContext, AiToolDefinition, toolOk, toolRefused } from "./types";

const monthPattern = /^\d{4}-\d{2}(-\d{2})?$/;

/**
 * Resolves a site from an id or a name.
 *
 * A name is matched against the sites the actor can see and must identify
 * exactly one of them. Two matches is a question, not a coin toss: putting an
 * invoice against the wrong site moves real emissions between entities.
 */
async function resolveSite(
  context: AiToolContext,
  siteId: string | null | undefined,
  siteName: string | null | undefined,
): Promise<{ id: string; name: string } | { error: string; question: string | null }> {
  if (siteId) {
    if (!isSiteInScope(context.actor, siteId)) {
      return { error: "That site isn't one you have access to.", question: null };
    }
    const site = await prisma.site.findUnique({ where: { id: siteId }, select: { id: true, name: true } });
    return site ?? { error: "That site doesn't exist.", question: null };
  }

  const sites = await prisma.site.findMany({
    where: { id: { in: context.actor.siteIds }, isActive: true },
    select: { id: true, name: true },
  });

  if (siteName) {
    const needle = siteName.trim().toLowerCase();
    const matches = sites.filter((s) => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      return {
        error: `"${siteName}" matches more than one site.`,
        question: `Which site do you mean — ${matches.map((m) => m.name).join(" or ")}?`,
      };
    }
    return {
      error: `No site called "${siteName}".`,
      question: `I don't have a site called "${siteName}". Is it ${sites.map((s) => s.name).join(", ")}?`,
    };
  }

  if (sites.length === 1) return sites[0];

  return {
    error: "No site was given.",
    question: `Which site should I record this against — ${sites.map((s) => s.name).join(", ")}?`,
  };
}

function isSite(value: { id: string; name: string } | { error: string; question: string | null }): value is { id: string; name: string } {
  return "id" in value;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const getCarbonSummary: AiToolDefinition<{ from: string | null; to: string | null; siteId: string | null }> = {
  name: "getCarbonSummary",
  summary: "The organisation's calculated emissions for a period, by scope, category and site.",
  argsHint: '{ "from": "YYYY-MM" or null, "to": "YYYY-MM" or null, "siteId": string or null }',
  schema: z.object({
    from: z.string().regex(monthPattern).nullable().default(null),
    to: z.string().regex(monthPattern).nullable().default(null),
    siteId: z.string().max(64).nullable().default(null),
  }),
  mutates: false,
  async run(args, context) {
    if (args.siteId) assertSiteInScope(context.actor, args.siteId);
    const range = args.from || args.to ? resolveMonthRange(args.from ?? undefined, args.to ?? undefined) : null;

    const summary = await buildCarbonContext(context.actor, {
      periodStart: range?.periodStart ?? context.periodStart,
      periodEnd: range?.periodEnd ?? context.periodEnd,
      siteId: args.siteId,
    });

    return toolOk(`CARBON SUMMARY (calculated by this platform):\n${summary.text}`);
  },
};

const findEmissionFactors: AiToolDefinition<{
  description: string;
  factorCategory: string | null;
  unit: string | null;
  periodMonth: string | null;
}> = {
  name: "findEmissionFactors",
  summary: "Candidate emission factors from this platform's own library for an activity. Never returns factor values.",
  argsHint: '{ "description": string, "factorCategory": string or null, "unit": string or null, "periodMonth": "YYYY-MM" or null }',
  schema: z.object({
    description: z.string().min(1).max(500),
    factorCategory: z.string().max(80).nullable().default(null),
    unit: z.string().max(40).nullable().default(null),
    periodMonth: z.string().regex(monthPattern).nullable().default(null),
  }),
  mutates: false,
  async run(args, context) {
    const asOfDate = args.periodMonth ? new Date(`${args.periodMonth.slice(0, 7)}-01T00:00:00.000Z`) : context.periodStart;

    const candidates = await findFactorCandidates({
      description: args.description,
      factorCategory: args.factorCategory,
      unit: args.unit,
      asOfDate,
    });

    if (candidates.length === 0) {
      return toolOk(
        `NO FACTOR FOUND for "${args.description}" in any factor set effective for ${asOfDate.toISOString().slice(0, 10)}. An administrator would have to import one before this can be calculated.`,
      );
    }

    // Identity only. The values are withheld from the model deliberately: it
    // has no legitimate use for them, and not having them makes it impossible
    // for one to be quoted back as though the model had produced it.
    const lines = candidates
      .slice(0, 15)
      .map(
        (c) =>
          `- category=${c.category} | subtype=${c.subtypeKey ?? "(none)"} | unit=${c.unit} | basis=${c.basis} | source=${c.publisher} ${c.vintageYear}${c.isPlaceholder ? " (PLACEHOLDER)" : ""}`,
      );

    return toolOk(
      `${candidates.length} candidate factor(s) exist in this platform's library for that activity and period. Their values are not shown to you and must not be stated:\n${lines.join("\n")}`,
    );
  },
};

const classifyActivity: AiToolDefinition<{
  description: string;
  quantity: number | null;
  unit: string | null;
  supplierName: string | null;
}> = {
  name: "classifyActivity",
  summary: "Which scope and which of this platform's data points an activity belongs to. Platform rules first, model only when genuinely ambiguous.",
  argsHint: '{ "description": string, "quantity": number or null, "unit": string or null, "supplierName": string or null }',
  schema: z.object({
    description: z.string().min(1).max(1000),
    quantity: z.number().nullable().default(null),
    unit: z.string().max(40).nullable().default(null),
    supplierName: z.string().max(200).nullable().default(null),
  }),
  mutates: false,
  async run(args, context) {
    const outcome = await classifyEmission(context.actor, {
      description: args.description,
      quantity: args.quantity,
      unit: args.unit,
      supplierName: args.supplierName,
    });

    const lines = [
      `Classification source: ${outcome.source === "platform-rule" ? "this platform's own rule" : "AI suggestion, needs checking"}.`,
      `Scope: ${outcome.scope}. Category: ${outcome.categoryLabel}.`,
      `Data point: ${outcome.dataPointCode ?? "none that fits"}${outcome.dataPointName ? ` — ${outcome.dataPointName}` : ""}.`,
      outcome.subtypeKey ? `Sub-type: ${outcome.subtypeKey} (${outcome.subtypeLabel ?? ""}).` : "Sub-type: not determined.",
      outcome.suggestedUnit ? `Unit: ${outcome.suggestedUnit}.` : null,
      outcome.reasoningSummary,
      outcome.missingInformation.length > 0 ? `Still missing: ${outcome.missingInformation.join("; ")}` : null,
    ].filter(Boolean);

    return toolOk(lines.join(" "));
  },
};

const findExistingEntries: AiToolDefinition<{
  dataPointCode: string | null;
  siteId: string | null;
  fromMonth: string | null;
  toMonth: string | null;
}> = {
  name: "findExistingEntries",
  summary: "Activity entries already recorded, so you can check whether something is on file before suggesting it again.",
  argsHint: '{ "dataPointCode": string or null, "siteId": string or null, "fromMonth": "YYYY-MM" or null, "toMonth": "YYYY-MM" or null }',
  schema: z.object({
    dataPointCode: z.string().max(40).nullable().default(null),
    siteId: z.string().max(64).nullable().default(null),
    fromMonth: z.string().regex(monthPattern).nullable().default(null),
    toMonth: z.string().regex(monthPattern).nullable().default(null),
  }),
  mutates: false,
  async run(args, context) {
    if (args.siteId) assertSiteInScope(context.actor, args.siteId);

    const entries = await prisma.activityEntry.findMany({
      where: {
        // Scope is applied here, in code, never by asking the model to respect it.
        siteId: args.siteId ? args.siteId : { in: context.actor.siteIds },
        ...(args.dataPointCode ? { activityDataPoint: { code: args.dataPointCode } } : {}),
        ...(args.fromMonth || args.toMonth
          ? {
              periodStart: {
                ...(args.fromMonth ? { gte: new Date(`${args.fromMonth.slice(0, 7)}-01T00:00:00.000Z`) } : {}),
                ...(args.toMonth ? { lte: new Date(`${args.toMonth.slice(0, 7)}-28T23:59:59.000Z`) } : {}),
              },
            }
          : {}),
      },
      orderBy: { periodStart: "desc" },
      take: 25,
      include: {
        activityDataPoint: { select: { code: true, dataPointName: true } },
        site: { select: { name: true } },
        sourceDocument: { select: { filename: true } },
      },
    });

    if (entries.length === 0) return toolOk("No matching entries are recorded.");

    const lines = entries.map(
      (e) =>
        `- ${e.activityDataPoint.code} ${e.activityDataPoint.dataPointName}: ${Number(e.rawValue)} ${e.rawUnit}, period starting ${e.periodStart.toISOString().slice(0, 10)}, ${e.site.name}, status ${e.status}, origin ${e.dataOrigin}${e.sourceDocument ? `, evidence ${e.sourceDocument.filename}` : ""} [entryId=${e.id}]`,
    );
    return toolOk(`${entries.length} entr${entries.length === 1 ? "y" : "ies"} on file:\n${lines.join("\n")}`);
  },
};

const explainCalculationTool: AiToolDefinition<{ calculationId: string }> = {
  name: "explainCalculation",
  summary: "The full deterministic record behind one calculated figure: input, factor, source, vintage and formula.",
  argsHint: '{ "calculationId": string }',
  schema: z.object({ calculationId: z.string().min(1).max(64) }),
  mutates: false,
  async run(args, context) {
    // Authorize against the row, not against the rendered explanation: the
    // site id is what the scope check needs, and it has to be read from the
    // database rather than from anything the model supplied.
    const calculation = await prisma.calculation.findUnique({
      where: { id: args.calculationId },
      select: { activityEntry: { select: { siteId: true } } },
    });
    if (!calculation) return toolRefused("That calculation doesn't exist.");
    assertSiteInScope(context.actor, calculation.activityEntry.siteId);

    const explanation = await explainCalculation(args.calculationId);
    if (!explanation) return toolRefused("That calculation doesn't exist.");

    return toolOk(
      `CALCULATION RECORD (produced by this platform's engine — quote from it, never recompute it):\n${formatExplanationForPrompt(explanation)}`,
    );
  },
};

const extractDocumentTool: AiToolDefinition<{ documentId: string; rerun: boolean }> = {
  name: "extractDocument",
  summary: "Read an uploaded document and report what it says. Use for a document the user attached or referred to.",
  argsHint: '{ "documentId": string, "rerun": boolean }',
  schema: z.object({ documentId: z.string().min(1).max(64), rerun: z.boolean().default(false) }),
  mutates: false,
  async run(args, context) {
    const intake = await readDocumentForAssistant(context.actor, args.documentId, {
      forceExtract: args.rerun,
      extractIfMissing: true,
    });
    return toolOk(intake.digest, [intake.card]);
  },
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const createActivityEntry: AiToolDefinition<{
  dataPointCode: string;
  siteId: string | null;
  siteName: string | null;
  periodInput: string;
  quantity: number;
  unit: string;
  subtypeKey: string | null;
  supplierName: string | null;
  sourceDocumentId: string | null;
}> = {
  name: "createActivityEntry",
  summary:
    "Record activity data. The platform validates every field, resolves the emission factor itself and calculates the emissions — do not supply a factor or a CO2e figure.",
  argsHint:
    '{ "dataPointCode": "S2-01", "siteId": string or null, "siteName": string or null, "periodInput": "YYYY-MM", "quantity": number, "unit": string, "subtypeKey": string or null, "supplierName": string or null, "sourceDocumentId": string or null }',
  schema: z.object({
    dataPointCode: z.string().min(1).max(40),
    siteId: z.string().max(64).nullable().default(null),
    siteName: z.string().max(200).nullable().default(null),
    periodInput: z.string().regex(monthPattern, "Give the period as YYYY-MM or YYYY-MM-DD."),
    quantity: z.number().positive("A quantity has to be greater than zero."),
    unit: z.string().min(1).max(40),
    subtypeKey: z.string().max(80).nullable().default(null),
    supplierName: z.string().max(200).nullable().default(null),
    sourceDocumentId: z.string().max(64).nullable().default(null),
  }),
  mutates: true,
  async run(args, context) {
    const site = await resolveSite(context, args.siteId, args.siteName);
    if (!isSite(site)) return toolRefused(site.error, site.question);

    // A document can only be cited as evidence if the caller can actually see
    // it. An id the model produced is not a capability.
    let sourceDocumentId: string | null = null;
    let extractionId: string | null = null;
    let documentSha256: string | null = null;

    if (args.sourceDocumentId) {
      const document = await prisma.sourceDocument.findUnique({
        where: { id: args.sourceDocumentId },
        select: { id: true, siteId: true, sha256: true },
      });
      if (!document) return toolRefused("That document doesn't exist, so nothing was recorded against it.");
      if (document.siteId) assertSiteInScope(context.actor, document.siteId);
      sourceDocumentId = document.id;
      documentSha256 = document.sha256;

      const extraction = await prisma.documentExtraction.findFirst({
        where: { documentId: document.id, status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      extractionId = extraction?.id ?? null;
    }

    const candidate: EntryCandidate = {
      key: `chat:${args.dataPointCode}:${args.periodInput}`,
      label: args.dataPointCode,
      dataPointCode: args.dataPointCode,
      siteId: site.id,
      quantity: args.quantity,
      unit: args.unit,
      periodInput: args.periodInput,
      subtypeKey: args.subtypeKey,
      supplierName: args.supplierName,
      sourceDocumentId,
      extractionId,
      basis: sourceDocumentId
        ? "Recorded through the assistant from an attached document, after this platform's validation checks."
        : `Recorded through the assistant from what the user stated: "${context.userMessage.slice(0, 300)}".`,
      warnings: [],
      conflicts: [],
      invoiceNumber: null,
      meterNumber: null,
      documentSha256,
    };

    const outcome = await logEntryCandidate(context.actor, candidate, {
      mode: context.config.dataEntryMode,
      // The user asked for this in so many words, so it proceeds in either
      // data-entry mode — and still only if every check passes.
      trigger: "USER_INSTRUCTION",
      turnRequestId: context.turnRequestId,
      interactionId: context.interactionId,
      allowDuplicate: userOverrodeDuplicate(context.userMessage),
    });

    return {
      ok: outcome.status === "CREATED",
      digest: outcome.digest,
      cards: [outcome.card],
      question: outcome.question,
    };
  },
};

const updateActivityEntry: AiToolDefinition<{
  entryId: string;
  quantity: number | null;
  unit: string | null;
  periodInput: string | null;
  subtypeKey: string | null;
}> = {
  name: "updateActivityEntry",
  summary:
    "Correct an entry this conversation created. The original is withdrawn and kept on file; a corrected entry is recorded beside it.",
  argsHint:
    '{ "entryId": string, "quantity": number or null, "unit": string or null, "periodInput": "YYYY-MM" or null, "subtypeKey": string or null }',
  schema: z.object({
    entryId: z.string().min(1).max(64),
    quantity: z.number().positive().nullable().default(null),
    unit: z.string().max(40).nullable().default(null),
    periodInput: z.string().regex(monthPattern).nullable().default(null),
    subtypeKey: z.string().max(80).nullable().default(null),
  }),
  mutates: true,
  async run(args, context) {
    if (args.quantity === null && args.unit === null && args.periodInput === null && args.subtypeKey === null) {
      return toolRefused("Nothing to change was given, so the entry is untouched.", "What should I change it to?");
    }

    try {
      const result = await correctAssistantEntry(
        context.actor,
        args.entryId,
        context.conversationEntryIds,
        {
          quantity: args.quantity,
          unit: args.unit,
          periodInput: args.periodInput,
          subtypeKey: args.subtypeKey,
        },
        { interactionId: context.interactionId, turnRequestId: context.turnRequestId },
      );
      return toolOk(result.digest, result.cards);
    } catch (err) {
      if (err instanceof EntryCorrectionError) return toolRefused(err.message);
      throw err;
    }
  },
};

const retractActivityEntry: AiToolDefinition<{ entryId: string; reason: string | null }> = {
  name: "retractActivityEntry",
  summary:
    "Withdraw an entry this conversation created. Only when the user has clearly asked for it — the record is kept but excluded from every total.",
  argsHint: '{ "entryId": string, "reason": string or null }',
  schema: z.object({
    entryId: z.string().min(1).max(64),
    reason: z.string().max(500).nullable().default(null),
  }),
  mutates: true,
  async run(args, context) {
    // Withdrawing accounting data is destructive, so it needs the person to
    // have asked — not the model to have decided they meant it.
    if (!userConfirmedRetraction(context.userMessage)) {
      return toolRefused(
        "Nothing was withdrawn: the user's message didn't clearly ask for an entry to be removed.",
        "Do you want me to withdraw that entry? It stays on file for the audit trail but stops counting towards any total.",
      );
    }

    try {
      const result = await retractAssistantEntry(context.actor, args.entryId, context.conversationEntryIds, args.reason ?? "");
      return toolOk(result.digest, result.cards);
    } catch (err) {
      if (err instanceof EntryCorrectionError) return toolRefused(err.message);
      throw err;
    }
  },
};

export const CARBON_TOOLS: AiToolDefinition<never>[] = [
  getCarbonSummary,
  findEmissionFactors,
  classifyActivity,
  findExistingEntries,
  explainCalculationTool,
  extractDocumentTool,
  createActivityEntry,
  updateActivityEntry,
  retractActivityEntry,
] as unknown as AiToolDefinition<never>[];
