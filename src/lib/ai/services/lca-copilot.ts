/**
 * The LCA copilot.
 *
 * It reads the platform's existing product-assessment system (LcaAssessment
 * and its inventory, processes, methodology profile and calculation runs) —
 * there is no parallel AI-owned LCA model. Context is assembled here,
 * deliberately and bounded, after an authorization check.
 *
 * Every figure it is given comes from the deterministic LCA engine
 * (`previewCalculation` / a stored run) and the analysis helpers. The copilot
 * helps the user build and interpret a study; it does not produce LCA numbers,
 * and it is told so explicitly.
 */

import { AiTaskType } from "@prisma/client";
import { AiActor, assertLcaAssessmentInScope } from "../authorization";
import {
  contributionsByProcess,
  contributionsByStage,
  contributionsByMaterial,
  hotspots,
  summariseDataQuality,
  type AnalysisRow,
  type ScenarioComparison,
} from "@/lib/lca/analysis";
import { engineRowsToAnalysisRows, loadAssessment, previewCalculation } from "@/lib/lca/calculation-service";
import type { LoadedAssessment } from "@/lib/lca/calculation-service";
import type { EngineOutput } from "@/lib/lca/engine/types";
import { formatMethodologyNotes, notesByTopic, retrieveMethodologyNotes } from "../methodology";
import { lcaReviewResultSchema, LcaReviewResult } from "../schemas";
import { runStructuredTask, runTextTask } from "../run";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { fenceUntrusted, newFenceNonce, truncateForPrompt, untrustedContentRules } from "../untrusted";
import { AiMessage, AiRunMetadata } from "../types";

const LCA_ROLE = [
  "You are helping a practitioner build and interpret a product life cycle assessment inside this platform.",
  "You understand LCA practice — goal and scope, functional unit, declared unit, system boundary, cut-off criteria, allocation, inventory, impact assessment, interpretation, sensitivity, uncertainty and critical review — and you can explain any of it in plain terms.",
  "You never decide a methodological choice on the user's behalf. Where a choice is needed, set out the options and what each implies, and ask them to confirm.",
  "Every number you mention must appear in the assessment data below. The platform's deterministic engine calculated those figures; you did not, and you cannot. Never produce, adjust or re-derive an LCA figure.",
  "Never call an assessment ISO compliant, verified, certified or externally reviewed. State the recorded verification status as it is.",
].join(" ");

function n(value: { toString(): string }): string {
  return value.toString();
}

/**
 * The assessment, rendered for a prompt. Bounded on purpose: methodology and
 * results in full, inventory truncated, and no evidence document contents.
 */
export function buildLcaContext(assessment: LoadedAssessment, output: EngineOutput): string {
  const rows: AnalysisRow[] = engineRowsToAnalysisRows(output);
  const lines: string[] = [];

  lines.push(
    `ASSESSMENT: ${assessment.reference} — "${assessment.title}". Status: ${assessment.status}. Version ${assessment.version}${assessment.versionLabel ? ` (${assessment.versionLabel})` : ""}.`,
  );
  lines.push(
    `Product: ${assessment.productVersion.product.name} (SKU ${assessment.productVersion.product.sku}), version ${assessment.productVersion.versionLabel}. Entity: ${assessment.entity.name}.`,
  );

  lines.push("", "GOAL AND SCOPE AS RECORDED:");
  lines.push(`- Boundary: ${assessment.boundary}${assessment.boundaryNotes ? ` — ${assessment.boundaryNotes}` : ""}`);
  lines.push(
    `- ${assessment.isDeclaredUnit ? "Declared" : "Functional"} unit: ${(assessment.isDeclaredUnit ? assessment.declaredUnitDescription : assessment.functionalUnitDescription) ?? "NOT YET DEFINED"} (${n(assessment.functionalUnitQuantity)} ${assessment.functionalUnitUnit ?? ""})`,
  );
  lines.push(`- Reference flow: ${assessment.referenceFlowDescription ?? "NOT YET DEFINED"}`);
  lines.push(`- Goal: ${assessment.goal ?? "NOT YET DEFINED"}`);
  lines.push(`- Intended application: ${assessment.intendedApplication ?? "NOT YET DEFINED"}`);
  lines.push(`- Intended audience: ${assessment.intendedAudience ?? "NOT YET DEFINED"}`);
  lines.push(`- Comparative assertion disclosed: ${assessment.comparativeAssertionDisclosed ? "YES" : "no"}`);
  lines.push(`- Scope: ${assessment.scopeDescription ?? "NOT YET DEFINED"}`);
  lines.push(`- Stages included: ${assessment.includedStages.join(", ") || "none recorded"}`);
  lines.push(`- Limitations recorded: ${assessment.limitations ?? "none recorded"}`);

  const profile = assessment.methodologyProfile;
  if (profile) {
    lines.push("", "METHODOLOGY PROFILE (authoritative for this assessment):");
    lines.push(`- ${profile.name} v${profile.version}. GWP basis: ${profile.gwpBasis}.`);
    lines.push(`- Allocation: ${profile.defaultAllocationMethod}${profile.allocationRules ? ` — ${profile.allocationRules}` : ""}`);
    lines.push(`- Recycling: ${profile.recyclingMethod}${profile.recyclingRules ? ` — ${profile.recyclingRules}` : ""}`);
    lines.push(`- Electricity: ${profile.electricityApproach}`);
    lines.push(`- Biogenic: ${profile.biogenicTreatment}. Offsets: ${profile.offsetTreatment}.`);
    lines.push(`- Cut-off: ${profile.cutOffRules ?? "not recorded"}`);
  } else {
    lines.push("", "METHODOLOGY PROFILE: none selected yet — the assessment cannot be calculated defensibly without one.");
  }

  lines.push("", "PROCESSES:");
  if (assessment.processes.length === 0) lines.push("- none recorded");
  for (const process of assessment.processes) {
    lines.push(
      `- [${process.stage}] ${process.name}${process.geography ? ` (${process.geography})` : ""}${process.isIncluded ? "" : " [EXCLUDED]"}${Number(process.allocationPercent) !== 100 ? `, ${n(process.allocationPercent)}% allocated (${process.allocationMethod})` : ""}`,
    );
  }

  lines.push("", "LIFE CYCLE INVENTORY (item — quantity — factor source — data type):");
  if (assessment.inventoryItems.length === 0) lines.push("- (no inventory items recorded yet)");
  const processStage = new Map(assessment.processes.map((p) => [p.id, p.stage]));
  for (const item of assessment.inventoryItems.slice(0, 120)) {
    const factor = item.emissionFactor
      ? `library factor ${item.emissionFactor.id} (${item.emissionFactor.category}, per ${item.emissionFactor.unit})`
      : item.supplierPcf
        ? `supplier PCF from ${item.supplierPcf.supplier.name}`
        : item.factorSelectionMode === "MANUAL"
          ? "manual factor"
          : "NO FACTOR SELECTED";
    const pedigree = [
      item.reliabilityScore,
      item.completenessScore,
      item.temporalScore,
      item.geographicalScore,
      item.technologicalScore,
    ]
      .map((v) => (v === null ? "-" : String(v)))
      .join("/");
    lines.push(
      `- [${processStage.get(item.processId) ?? "?"}] ${item.name} [itemId=${item.id}] (${item.itemType}): ${n(item.quantity)} ${item.unit}; ${factor}; ${item.dataType}${item.supplier ? `; supplier ${item.supplier.name}` : ""}; pedigree (rel/comp/temp/geo/tech) ${pedigree}${item.isExcluded ? `; EXCLUDED: ${item.exclusionReason ?? "no reason recorded"}` : ""}${item.transportLegs.length ? `; ${item.transportLegs.length} transport leg(s)` : ""}${item.endOfLifeRoutes.length ? `; ${item.endOfLifeRoutes.length} end-of-life route(s)` : ""}`,
    );
  }

  lines.push("", "RESULTS (calculated by this platform's deterministic LCA engine):");
  lines.push(`- Engine: ${output.engineVersion}.`);
  lines.push(
    `- Headline per functional unit: ${n(output.totals.headlinePerFunctionalUnitKgCo2e)} kgCO2e${output.totals.functionalUnitResolved ? "" : " (FUNCTIONAL UNIT UNRESOLVED — totals are per model, see note)"}`,
  );
  lines.push(`- Whole model: ${n(output.totals.headlineModelKgCo2e)} kgCO2e over ${n(output.totals.functionalUnitsInModel)} functional units.`);
  lines.push(`- Including biogenic: ${n(output.totals.includingBiogenicPerFunctionalUnitKgCo2e)} kgCO2e per functional unit.`);
  if (output.totals.functionalUnitNote) lines.push(`- Note: ${output.totals.functionalUnitNote}`);

  lines.push("", "BY LIFE CYCLE STAGE:");
  for (const c of contributionsByStage(rows)) {
    lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percent.toFixed(1)}%)`);
  }

  const byProcess = contributionsByProcess(rows).slice(0, 10);
  if (byProcess.length > 0) {
    lines.push("", "BY PROCESS (largest first):");
    for (const c of byProcess) lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percent.toFixed(1)}%)`);
  }

  const byMaterial = contributionsByMaterial(rows).slice(0, 10);
  if (byMaterial.length > 0) {
    lines.push("", "BY MATERIAL:");
    for (const c of byMaterial) lines.push(`- ${c.label}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percent.toFixed(1)}%)`);
  }

  const top = hotspots(rows, 8);
  if (top.length > 0) {
    lines.push("", "HOTSPOTS (largest contributing lines):");
    for (const c of top) lines.push(`- ${c.label}${c.sublabel ? ` (${c.sublabel})` : ""}: ${c.kgCo2e.toFixed(4)} kgCO2e (${c.percent.toFixed(1)}%)`);
  }

  const dq = summariseDataQuality(rows);
  lines.push("", "DATA QUALITY (deterministic):");
  lines.push(
    `- Footprint-weighted pedigree score: ${dq.footprintWeightedScore === null ? "not assessable" : dq.footprintWeightedScore.toFixed(2)} (1 best, 5 worst); ${dq.scoredLineCount} of ${dq.totalLineCount} lines scored.`,
  );
  lines.push(`- Share of gross emissions on unscored lines: ${dq.unscoredEmissionsPercent.toFixed(1)}%.`);
  lines.push(`- Share of gross emissions still on a placeholder factor: ${dq.placeholderFactorPercent.toFixed(1)}%.`);
  for (const cov of dq.coverage) {
    lines.push(`- ${cov.label}: ${cov.percent.toFixed(1)}% of gross emissions across ${cov.lineCount} line(s).`);
  }

  if (output.diagnostics.length > 0) {
    lines.push("", "ENGINE DIAGNOSTICS (problems the platform itself found — you did not find these):");
    for (const d of output.diagnostics.slice(0, 30)) {
      lines.push(`- [${d.severity}] ${d.message}`);
    }
  }

  return lines.join("\n");
}

async function loadStudy(actor: AiActor, assessmentId: string) {
  await assertLcaAssessmentInScope(actor, assessmentId);
  const assessment = await loadAssessment(assessmentId);
  if (!assessment) throw new Error("LCA assessment not found.");
  const output = await previewCalculation(assessmentId);
  return { assessment, output };
}

export interface LcaCopilotAnswer {
  answer: string;
  meta: AiRunMetadata;
}

export async function assistLca(
  actor: AiActor,
  assessmentId: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<LcaCopilotAnswer> {
  const { assessment, output } = await loadStudy(actor, assessmentId);
  const nonce = newFenceNonce();

  const notes = formatMethodologyNotes([...retrieveMethodologyNotes(question, 3), ...notesByTopic("lca")]);

  const systemPrompt = buildSystemPrompt({
    role: LCA_ROLE,
    context: `THIS ASSESSMENT:\n${buildLcaContext(assessment, output)}\n\nTHIS PLATFORM'S METHODOLOGY:\n${notes}`,
    untrustedRules: untrustedContentRules(nonce),
  });

  const messages: AiMessage[] = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: truncateForPrompt(m.content, 2000) })),
    { role: "user" as const, content: fenceUntrusted("QUESTION", truncateForPrompt(question, 4000), nonce) },
  ];

  const result = await runTextTask({
    task: AiTaskType.LCA_ASSISTANT,
    feature: "lca-copilot",
    systemPrompt,
    messages,
    temperature: 0.2,
    maxOutputTokens: 1400,
    audit: {
      userId: actor.userId,
      entityId: assessment.entityId,
      relatedType: "LCA_ASSESSMENT",
      relatedId: assessment.id,
    },
  });

  return { answer: result.data, meta: result.meta };
}

export interface LcaReviewOutcome {
  review: LcaReviewResult;
  meta: AiRunMetadata;
}

/**
 * "What am I missing?" — a structured review of the assessment against LCA
 * practice. Every recommendation is advisory; this is not a critical review.
 */
export async function reviewLcaProject(actor: AiActor, assessmentId: string): Promise<LcaReviewOutcome> {
  const { assessment, output } = await loadStudy(actor, assessmentId);

  const systemPrompt = buildSystemPrompt({
    role: [
      LCA_ROLE,
      "Your task now is a structured completeness and consistency review of the assessment below.",
      "Look for: methodological choices not yet recorded; a functional unit that isn't measurable or comparable; a boundary that doesn't match the stated goal; inventory lines that are likely missing given what is present (for example a material with no transport from its supplier, or manufacturing with no electricity); lines with no factor selected; weak or unassessed data quality on lines that dominate the result; and results that would be misleading to present as they stand.",
      "Frame a likely-missing line as a question about intent — 'was supplier-to-factory transport excluded deliberately?' — never as an instruction to add a number.",
      "Do not recommend a value for anything. Recommend what to find out, record, or confirm.",
      "This review is not a critical review under ISO 14044 and you must say so if the user's framing implies otherwise.",
    ].join(" "),
    context: `THIS ASSESSMENT:\n${buildLcaContext(assessment, output)}`,
    outputContract: JSON_ONLY_CONTRACT,
  });

  const result = await runStructuredTask<LcaReviewResult>({
    task: AiTaskType.LCA_ASSISTANT,
    feature: "lca-review",
    systemPrompt,
    schema: lcaReviewResultSchema,
    schemaName: "lca_review_result",
    temperature: 0.1,
    maxOutputTokens: 2500,
    requirements: { prefersStructuredOutputs: true },
    messages: [{ role: "user", content: "Review this assessment and tell me what is missing, weak or inconsistent." }],
    audit: {
      userId: actor.userId,
      entityId: assessment.entityId,
      relatedType: "LCA_ASSESSMENT",
      relatedId: assessment.id,
    },
  });

  return { review: result.data, meta: result.meta };
}

/**
 * Interprets a scenario comparison. The figures come from `compareScenario`
 * in the LCA analysis layer — deterministic — and the model is told to quote
 * them rather than work anything out.
 */
export async function interpretScenario(
  actor: AiActor,
  assessmentId: string,
  comparison: ScenarioComparison,
): Promise<LcaCopilotAnswer> {
  const { assessment, output } = await loadStudy(actor, assessmentId);

  const comparisonText = JSON.stringify(comparison, null, 2);

  const systemPrompt = buildSystemPrompt({
    role: [
      LCA_ROLE,
      "Your task now is to interpret a scenario comparison the engine has already calculated.",
      "Quote the figures below exactly. Do not compute any percentage or total yourself, including ones that look trivial.",
      "Say plainly what changed, which stage drove it, whether the largest hotspot moved, and what would need to be true in reality for the scenario to hold.",
      "Three short paragraphs at most.",
    ].join(" "),
    context: `SCENARIO COMPARISON (deterministic, calculated by this platform):\n${comparisonText}\n\nBASELINE ASSESSMENT CONTEXT:\n${buildLcaContext(assessment, output)}`,
  });

  const result = await runTextTask({
    task: AiTaskType.LCA_ASSISTANT,
    feature: "lca-scenario-interpretation",
    systemPrompt,
    temperature: 0.2,
    maxOutputTokens: 900,
    messages: [{ role: "user", content: "Interpret this scenario result." }],
    audit: {
      userId: actor.userId,
      entityId: assessment.entityId,
      relatedType: "LCA_ASSESSMENT",
      relatedId: assessment.id,
    },
  });

  return { answer: result.data, meta: result.meta };
}
