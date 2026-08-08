/**
 * The LCA actions, on the same terms as the carbon ones: the model interprets,
 * the application validates and writes, the LCA engine calculates.
 *
 * Two module-specific rules are enforced here rather than left to the caller,
 * because they are the ones that protect a study's integrity:
 *
 *  - the assessment must be in the actor's scope *and* still open for editing
 *    (`checkCanEditAssessment`), so a figure a verifier has already seen can
 *    never move underneath them; and
 *  - a flow is written with no emission factor attached. Assigning a factor is
 *    a separate, deliberate act with its own audit event (`assignFactor`), and
 *    it is not something a chat message should do — so the assistant can add
 *    the inventory line and say what is still needed, and cannot quietly
 *    decide which dataset the line is modelled with.
 *
 * Every write goes through `upsertInventoryItem`, which records an LCA audit
 * event, so a reviewer sees the same trail whether the line came from the
 * inventory screen, the importer or the assistant.
 */

import { z } from "zod";
import { LcaDataType, LcaEmissionClassification, LcaItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadAssessment, previewCalculation } from "@/lib/lca/calculation-service";
import { upsertInventoryItem } from "@/lib/lca/model-service";
import { checkCanEditAssessment } from "@/lib/lca/permissions";
import { STAGE_LABELS } from "@/lib/lca/labels";
import { buildLcaContext } from "../services/lca-copilot";
import { assertLcaAssessmentInScope } from "../authorization";
import { AiToolContext, AiToolDefinition, toolOk, toolRefused } from "./types";

/** Sensible, honest starting points for a line added conversationally. */
const DEFAULT_DATA_TYPE = LcaDataType.SECONDARY;
const DEFAULT_CLASSIFICATION = LcaEmissionClassification.FOSSIL;

/**
 * Resolves the assessment this action applies to, and checks it can be edited.
 *
 * The assessment id comes from the conversation's own context (the project the
 * user has open), not from the model — an argument naming a different study
 * would be a way to write into one the user isn't looking at.
 */
async function requireEditableAssessment(context: AiToolContext) {
  if (!context.projectId) {
    return { error: "That only works inside an LCA project. Open the assessment and ask again." };
  }

  await assertLcaAssessmentInScope(context.actor, context.projectId);

  const assessment = await prisma.lcaAssessment.findUnique({
    where: { id: context.projectId },
    select: { id: true, status: true, reference: true, title: true },
  });
  if (!assessment) return { error: "That assessment doesn't exist." };

  const permission = checkCanEditAssessment(
    { id: context.actor.userId, name: context.actor.name ?? "", role: context.actor.role },
    assessment.status,
  );
  if (!permission.ok) return { error: permission.reason };

  return { assessment };
}

const getLcaProject: AiToolDefinition<Record<string, never>> = {
  name: "getLcaProject",
  summary: "The open LCA assessment: goal and scope, methodology, processes, inventory and its latest calculated results.",
  argsHint: "{}",
  schema: z.object({}).strict(),
  mutates: false,
  lcaOnly: true,
  async run(_args, context) {
    if (!context.projectId) return toolRefused("There is no LCA project open in this conversation.");
    await assertLcaAssessmentInScope(context.actor, context.projectId);

    const assessment = await loadAssessment(context.projectId);
    if (!assessment) return toolRefused("That assessment doesn't exist.");

    const output = await previewCalculation(context.projectId);
    return toolOk(`THIS ASSESSMENT (figures calculated by this platform's LCA engine):\n${buildLcaContext(assessment, output)}`);
  },
};

const addLcaFlow: AiToolDefinition<{
  processName: string | null;
  name: string;
  itemType: LcaItemType;
  quantity: number;
  unit: string;
  materialName: string | null;
  notes: string | null;
}> = {
  name: "addLcaFlow",
  summary:
    "Add an inventory line to the open assessment (a material, energy, transport or packaging flow). It is written with no emission factor — assigning one stays a deliberate act on the inventory screen.",
  argsHint:
    '{ "processName": string or null, "name": string, "itemType": "MATERIAL"|"ENERGY"|"FUEL"|"TRANSPORT"|"MANUFACTURING_PROCESS"|"PACKAGING"|"WASTE"|"WATER"|"USE_PHASE"|"END_OF_LIFE"|"OTHER", "quantity": number, "unit": string, "materialName": string or null, "notes": string or null }',
  schema: z.object({
    processName: z.string().max(200).nullable().default(null),
    name: z.string().min(1).max(200),
    itemType: z.enum(LcaItemType),
    quantity: z.number().positive("A quantity has to be greater than zero."),
    unit: z.string().min(1).max(40),
    materialName: z.string().max(200).nullable().default(null),
    notes: z.string().max(1000).nullable().default(null),
  }),
  mutates: true,
  lcaOnly: true,
  async run(args, context) {
    const resolved = await requireEditableAssessment(context);
    if ("error" in resolved) return toolRefused(resolved.error ?? "That assessment can't be edited.");
    const { assessment } = resolved;

    const processes = await prisma.lcaProcess.findMany({
      where: { assessmentId: assessment.id },
      select: { id: true, name: true, stage: true },
      orderBy: { sortOrder: "asc" },
    });

    if (processes.length === 0) {
      return toolRefused(
        "This assessment has no processes yet, so there is nowhere to put an inventory line. Add a process on the model screen first.",
      );
    }

    let process = processes[0];
    if (args.processName) {
      const needle = args.processName.trim().toLowerCase();
      const matches = processes.filter((p) => p.name.toLowerCase().includes(needle));
      if (matches.length === 1) {
        process = matches[0];
      } else if (matches.length > 1) {
        return toolRefused(
          `"${args.processName}" matches more than one process.`,
          `Which process do you mean — ${matches.map((m) => m.name).join(" or ")}?`,
        );
      } else {
        return toolRefused(
          `No process called "${args.processName}" in this assessment.`,
          `Which process should this go in — ${processes.map((p) => p.name).join(", ")}?`,
        );
      }
    } else if (processes.length > 1) {
      return toolRefused(
        "The assessment has more than one process and none was named.",
        `Which process should this go in — ${processes.map((p) => p.name).join(", ")}?`,
      );
    }

    const item = await upsertInventoryItem({
      assessmentId: assessment.id,
      processId: process.id,
      itemType: args.itemType,
      name: args.name,
      materialName: args.materialName,
      quantity: String(args.quantity),
      unit: args.unit,
      dataType: DEFAULT_DATA_TYPE,
      dataSource: `Added through the assistant from: "${context.userMessage.slice(0, 200)}"`,
      classification: DEFAULT_CLASSIFICATION,
      notes: args.notes,
      actorUserId: context.actor.userId,
    });

    return toolOk(
      `ADDED inventory line ${item.id} to "${process.name}" (${STAGE_LABELS[process.stage]}) in ${assessment.reference}: ${args.quantity} ${args.unit} of ${args.name}. It has no emission factor yet, is recorded as ${DEFAULT_DATA_TYPE.toLowerCase()} data and contributes nothing to the result until a factor is assigned on the inventory screen.`,
      [
        {
          kind: "LCA_FLOW",
          assessmentId: assessment.id,
          itemId: item.id,
          action: "created",
          name: args.name,
          quantity: String(args.quantity),
          unit: args.unit,
          stageLabel: STAGE_LABELS[process.stage],
          processName: process.name,
          note: "No emission factor is attached yet, so this line doesn't affect the result until one is assigned on the inventory screen.",
        },
      ],
    );
  },
};

const updateLcaFlow: AiToolDefinition<{
  itemId: string;
  quantity: number | null;
  unit: string | null;
  name: string | null;
  isExcluded: boolean | null;
  exclusionReason: string | null;
}> = {
  name: "updateLcaFlow",
  summary: "Change an existing inventory line's quantity, unit or name, or exclude it from the model.",
  argsHint:
    '{ "itemId": string, "quantity": number or null, "unit": string or null, "name": string or null, "isExcluded": boolean or null, "exclusionReason": string or null }',
  schema: z.object({
    itemId: z.string().min(1).max(64),
    quantity: z.number().positive().nullable().default(null),
    unit: z.string().max(40).nullable().default(null),
    name: z.string().max(200).nullable().default(null),
    isExcluded: z.boolean().nullable().default(null),
    exclusionReason: z.string().max(500).nullable().default(null),
  }),
  mutates: true,
  lcaOnly: true,
  async run(args, context) {
    const resolved = await requireEditableAssessment(context);
    if ("error" in resolved) return toolRefused(resolved.error ?? "That assessment can't be edited.");
    const { assessment } = resolved;

    const existing = await prisma.lcaInventoryItem.findUnique({
      where: { id: args.itemId },
      include: { process: { select: { id: true, name: true, stage: true, assessmentId: true } } },
    });

    // The line has to belong to the assessment the user has open. An id from
    // anywhere else is refused rather than looked up on its own authority.
    if (!existing || existing.process.assessmentId !== assessment.id) {
      return toolRefused("That inventory line isn't part of the assessment you have open, so nothing was changed.");
    }

    if (args.isExcluded === true && !args.exclusionReason) {
      return toolRefused(
        "Excluding a flow needs a reason recorded against it — a cut-off decision has to be justifiable.",
        "Why should that flow be excluded?",
      );
    }

    const updated = await upsertInventoryItem({
      id: existing.id,
      assessmentId: assessment.id,
      processId: existing.processId,
      itemType: existing.itemType,
      name: args.name ?? existing.name,
      description: existing.description,
      componentName: existing.componentName,
      partNumber: existing.partNumber,
      materialName: existing.materialName,
      supplierId: existing.supplierId,
      quantity: args.quantity !== null ? String(args.quantity) : existing.quantity.toString(),
      unit: args.unit ?? existing.unit,
      adjustmentFactor: existing.adjustmentFactor.toString(),
      adjustmentRationale: existing.adjustmentRationale,
      recycledContentPercent: existing.recycledContentPercent?.toString() ?? null,
      wastePercent: existing.wastePercent?.toString() ?? null,
      dataType: existing.dataType,
      dataSource: existing.dataSource,
      geography: existing.geography,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      classification: existing.classification,
      biogenicUptakePerUnit: existing.biogenicUptakePerUnit?.toString() ?? null,
      storedCarbonPerUnit: existing.storedCarbonPerUnit?.toString() ?? null,
      uncertaintyStatus: existing.uncertaintyStatus,
      isExcluded: args.isExcluded ?? existing.isExcluded,
      exclusionReason: args.exclusionReason ?? existing.exclusionReason,
      notes: existing.notes,
      actorUserId: context.actor.userId,
    });

    return toolOk(
      `UPDATED inventory line ${updated.id} in "${existing.process.name}": now ${updated.quantity.toString()} ${updated.unit} of ${updated.name}${updated.isExcluded ? ", excluded from the model" : ""}. The result changes only when the assessment is recalculated.`,
      [
        {
          kind: "LCA_FLOW",
          assessmentId: assessment.id,
          itemId: updated.id,
          action: "updated",
          name: updated.name,
          quantity: updated.quantity.toString(),
          unit: updated.unit,
          stageLabel: STAGE_LABELS[existing.process.stage],
          processName: existing.process.name,
          note: "Run the calculation again to see the effect on the result.",
        },
      ],
    );
  },
};

export const LCA_TOOLS: AiToolDefinition<never>[] = [getLcaProject, addLcaFlow, updateLcaFlow] as unknown as AiToolDefinition<never>[];
