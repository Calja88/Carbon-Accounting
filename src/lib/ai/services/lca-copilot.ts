/**
 * The LCA copilot.
 *
 * It knows the study it is sitting inside: goal and scope as recorded, the
 * stage and process structure, the inventory with its mapped factors, the
 * deterministic results and hotspot ranking, the data-quality assessment and
 * the gaps. That context is assembled here — deliberately, bounded, and after
 * an authorization check — rather than by handing a model the database.
 *
 * It helps the user build and interpret the study. It does not produce LCA
 * numbers: every figure in its answers came from the deterministic engine,
 * and it is told so explicitly. Where it proposes a methodological choice, it
 * proposes; the user confirms, and the confirmation is what gets stored.
 */

import { AiTaskType } from "@prisma/client";
import { AiActor, assertLcaProjectInScope } from "../authorization";
import { formatHotspotsForPrompt } from "@/lib/lca/aggregation";
import { assessGoalScopeCompleteness, getLcaProject, runLcaCalculation, LcaProjectWithGraph, LcaRunOutput } from "@/lib/lca/service";
import { ScenarioComparison } from "@/lib/lca/scenarios";
import { ALLOCATION_METHOD_LABELS, BOUNDARY_TYPE_LABELS, REVIEW_STATUS_LABELS } from "@/lib/lca/stages";
import { formatMethodologyNotes, notesByTopic, retrieveMethodologyNotes } from "../methodology";
import { lcaReviewResultSchema, LcaReviewResult } from "../schemas";
import { runStructuredTask, runTextTask } from "../run";
import { buildSystemPrompt, JSON_ONLY_CONTRACT } from "../system-prompts";
import { fenceUntrusted, newFenceNonce, truncateForPrompt, untrustedContentRules } from "../untrusted";
import { AiMessage, AiRunMetadata } from "../types";

const LCA_ROLE = [
  "You are helping a practitioner build and interpret a life cycle assessment inside this platform.",
  "You understand LCA practice — goal and scope, functional unit, reference flow, system boundary, cut-off criteria, allocation, inventory, impact assessment, interpretation, sensitivity, uncertainty and critical review — and you can explain any of it in plain terms.",
  "You never decide a methodological choice on the user's behalf. Where a choice is needed, set out the options and what each implies, and ask them to confirm.",
  "Every number you mention must appear in the study data below. The platform's deterministic engine calculated those figures; you did not, and you cannot. Never produce, adjust or re-derive an LCA figure.",
  "Never call a study ISO compliant, verified, certified or externally reviewed. State the recorded critical-review status as it is.",
].join(" ");

/**
 * The study, rendered for a prompt. Bounded on purpose: structure and results
 * in full, inventory truncated to the flows that matter, and no evidence
 * document contents.
 */
export function buildLcaContext(project: LcaProjectWithGraph, run: LcaRunOutput): string {
  const goal = project.goalScope;
  const completeness = assessGoalScopeCompleteness(project);
  const lines: string[] = [];

  lines.push(`STUDY: "${project.name}" — product: ${project.productName}. Status: ${project.status}.`);
  if (project.description) lines.push(`Description: ${project.description}`);

  lines.push("", "GOAL AND SCOPE AS RECORDED:");
  lines.push(`- Purpose: ${goal?.purpose ?? "NOT YET DEFINED"}`);
  lines.push(`- Intended application: ${goal?.intendedApplication ?? "NOT YET DEFINED"}`);
  lines.push(`- Intended audience: ${goal?.intendedAudience ?? "NOT YET DEFINED"}`);
  lines.push(`- Supports a comparative assertion disclosed to the public: ${goal?.comparativeAssertion ? "YES" : "no"}`);
  lines.push(
    `- Functional unit: ${goal?.functionalUnitDescription ?? "NOT YET DEFINED"}${goal?.functionalUnitQuantity && goal?.functionalUnitUnit ? ` (${Number(goal.functionalUnitQuantity)} ${goal.functionalUnitUnit})` : ""}`,
  );
  lines.push(
    `- Reference flow: ${goal?.referenceFlowDescription ?? "NOT YET DEFINED"}${goal?.referenceFlowQuantity && goal?.referenceFlowUnit ? ` (${Number(goal.referenceFlowQuantity)} ${goal.referenceFlowUnit})` : ""}`,
  );
  lines.push(
    `- System boundary: ${goal?.systemBoundaryType ? BOUNDARY_TYPE_LABELS[goal.systemBoundaryType] : "NOT YET DEFINED"}${goal?.systemBoundaryNotes ? ` — ${goal.systemBoundaryNotes}` : ""}`,
  );
  lines.push(`- Geography: ${goal?.geography ?? "NOT YET DEFINED"}`);
  lines.push(
    `- Time period: ${goal?.timePeriodStart ? goal.timePeriodStart.toISOString().slice(0, 10) : "not set"} to ${goal?.timePeriodEnd ? goal.timePeriodEnd.toISOString().slice(0, 10) : "not set"}`,
  );
  lines.push(`- Technology represented: ${goal?.technologyDescription ?? "NOT YET DEFINED"}`);
  lines.push(`- Cut-off criteria: ${goal?.cutOffCriteria ?? "NOT YET DEFINED"}`);
  lines.push(`- Exclusions: ${goal?.exclusions ?? "none recorded"}`);
  lines.push(
    `- Allocation: ${goal?.allocationMethod ? ALLOCATION_METHOD_LABELS[goal.allocationMethod] ?? goal.allocationMethod : "NOT YET DEFINED"}${goal?.allocationRationale ? ` — ${goal.allocationRationale}` : ""}`,
  );
  lines.push(`- Impact categories: ${goal?.impactCategories?.join("; ") || "NOT YET DEFINED"}`);
  lines.push(`- Data quality requirements: ${goal?.dataQualityRequirements ?? "NOT YET DEFINED"}`);
  lines.push(`- Limitations recorded: ${goal?.limitations ?? "none recorded"}`);
  lines.push(
    `- Critical review status: ${goal?.criticalReviewStatus ? REVIEW_STATUS_LABELS[goal.criticalReviewStatus] ?? goal.criticalReviewStatus : "NOT_REVIEWED"}`,
  );
  lines.push(
    `- Goal and scope confirmed by a person: ${completeness.confirmed ? "yes" : "NO — still unconfirmed"}. Fields still blank: ${completeness.missing.map((m) => m.label).join(", ") || "none"}.`,
  );

  lines.push("", "SYSTEM BOUNDARY — STAGES:");
  for (const stage of project.stages) {
    lines.push(
      `- ${stage.name} [${stage.included ? "INCLUDED" : "EXCLUDED"}]${stage.included ? "" : `: ${stage.exclusionReason ?? "no reason recorded"}`} — ${stage.processes.length} process(es)`,
    );
  }

  lines.push("", "LIFE CYCLE INVENTORY (flow — quantity — mapped factor — data quality):");
  let flowCount = 0;
  for (const stage of project.stages) {
    for (const process of stage.processes) {
      for (const flow of process.flows) {
        if (flowCount >= 120) break;
        flowCount++;
        const factor = flow.emissionFactor
          ? `mapped to factor ${flow.emissionFactor.id} (${flow.emissionFactor.category}${flow.emissionFactor.subtypeKey ? `/${flow.emissionFactor.subtypeKey}` : ""}, per ${flow.emissionFactor.unit})`
          : "NO FACTOR MAPPED";
        const dq = [flow.dqReliability, flow.dqCompleteness, flow.dqTemporal, flow.dqGeographical, flow.dqTechnological]
          .map((v) => (v === null ? "-" : String(v)))
          .join("/");
        lines.push(
          `- [${stage.name} → ${process.name}] ${flow.direction} ${flow.flowType} "${flow.name}" [flowId=${flow.id}]: ${Number(flow.quantity)} ${flow.unit}${flow.perFunctionalUnit ? " per functional unit" : " per reference flow"}${Number(flow.allocationPercent) !== 100 ? `, ${Number(flow.allocationPercent)}% allocated` : ""}; ${factor}; source: ${flow.dataSource ?? "not recorded"}; ${flow.dataType ?? "data type not recorded"}; geography ${flow.geography ?? "not recorded"}; year ${flow.referenceYear ?? "not recorded"}; DQ(rel/comp/temp/geo/tech) ${dq}`,
        );
      }
    }
  }
  if (flowCount === 0) lines.push("- (no inventory flows recorded yet)");

  lines.push("", "ASSUMPTIONS RECORDED:");
  if (project.assumptions.length === 0) lines.push("- none recorded");
  for (const a of project.assumptions) {
    lines.push(`- ${a.topic}: ${a.statement}${a.rationale ? ` (rationale: ${a.rationale})` : ""}`);
  }

  lines.push("", "RESULTS (calculated by this platform's deterministic LCA engine):");
  lines.push(formatHotspotsForPrompt(run.result, run.hotspots));

  lines.push("", "DATA QUALITY ASSESSMENT (deterministic):");
  lines.push(`- ${run.dataQuality.explanation}`);
  lines.push(
    `- Bands across calculated flows: HIGH ${run.dataQuality.countsByBand.HIGH}, MEDIUM ${run.dataQuality.countsByBand.MEDIUM}, LOW ${run.dataQuality.countsByBand.LOW}, UNKNOWN ${run.dataQuality.countsByBand.UNKNOWN}.`,
  );
  if (run.dataQuality.primaryDataSharePercent !== null) {
    lines.push(`- Share of calculated emissions from primary data: ${run.dataQuality.primaryDataSharePercent.toFixed(1)}%.`);
  }

  if (project.scenarios.length > 0) {
    lines.push("", "SCENARIOS DEFINED:");
    for (const s of project.scenarios) {
      lines.push(`- ${s.name}${s.isBaseline ? " (baseline)" : ""}: ${s.description ?? "no description"} — ${s.overrides.length} override(s)`);
    }
  }

  if (project.evidence.length > 0) {
    lines.push("", "EVIDENCE ATTACHED:");
    for (const e of project.evidence) {
      lines.push(`- ${e.document.filename}${e.note ? ` — ${e.note}` : ""}`);
    }
  }

  return lines.join("\n");
}

async function loadStudy(actor: AiActor, projectId: string) {
  await assertLcaProjectInScope(actor, projectId);
  const project = await getLcaProject(projectId);
  if (!project) throw new Error("LCA project not found.");
  const run = await runLcaCalculation(project);
  return { project, run };
}

export interface LcaCopilotAnswer {
  answer: string;
  meta: AiRunMetadata;
}

export async function assistLca(
  actor: AiActor,
  projectId: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<LcaCopilotAnswer> {
  const { project, run } = await loadStudy(actor, projectId);
  const nonce = newFenceNonce();

  const notes = formatMethodologyNotes([
    ...retrieveMethodologyNotes(question, 3),
    ...notesByTopic("lca"),
  ]);

  const systemPrompt = buildSystemPrompt({
    role: LCA_ROLE,
    context: `THIS STUDY:\n${buildLcaContext(project, run)}\n\nTHIS PLATFORM'S METHODOLOGY:\n${notes}`,
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
      entityId: project.entityId,
      siteId: project.siteId,
      relatedType: "LCA_PROJECT",
      relatedId: project.id,
    },
  });

  return { answer: result.data, meta: result.meta };
}

export interface LcaReviewOutcome {
  review: LcaReviewResult;
  meta: AiRunMetadata;
}

/**
 * "What am I missing?" — a structured review of the study against LCA
 * practice. Every recommendation is advisory and is stored, if the user keeps
 * it, as an AI-sourced review finding so it is never mistaken for a critical
 * review.
 */
export async function reviewLcaProject(actor: AiActor, projectId: string): Promise<LcaReviewOutcome> {
  const { project, run } = await loadStudy(actor, projectId);

  const systemPrompt = buildSystemPrompt({
    role: [
      LCA_ROLE,
      "Your task now is a structured completeness and consistency review of the study below.",
      "Look for: methodological choices not yet recorded; a functional unit that isn't measurable or comparable; a system boundary that doesn't match the stated goal; inventory flows that are likely missing given what is present (for example a material with no transport from its supplier, or manufacturing with no electricity); flows with no factor mapped; weak or unassessed data quality on flows that dominate the result; and results that would be misleading to present as they stand.",
      "Frame a likely-missing flow as a question about intent — 'was supplier-to-factory transport excluded deliberately?' — never as an instruction to add a number.",
      "Do not recommend a value for anything. Recommend what to find out, record, or confirm.",
      "This review is not a critical review under ISO 14044 and you must say so if the user's framing implies otherwise.",
    ].join(" "),
    context: `THIS STUDY:\n${buildLcaContext(project, run)}`,
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
    messages: [{ role: "user", content: "Review this study and tell me what is missing, weak or inconsistent." }],
    audit: {
      userId: actor.userId,
      entityId: project.entityId,
      relatedType: "LCA_PROJECT",
      relatedId: project.id,
    },
  });

  return { review: result.data, meta: result.meta };
}

/**
 * Interprets a scenario comparison. The percentages come from
 * `compareScenario` — deterministic — and the model is told to quote them
 * rather than work anything out.
 */
export async function interpretScenario(
  actor: AiActor,
  projectId: string,
  comparison: ScenarioComparison,
): Promise<LcaCopilotAnswer> {
  const { project, run } = await loadStudy(actor, projectId);

  const comparisonText = [
    `Scenario: ${comparison.scenarioName}`,
    `Baseline total: ${comparison.baselineKgCo2e.toFixed(4)} kgCO2e per functional unit`,
    `Scenario total: ${comparison.scenarioKgCo2e.toFixed(4)} kgCO2e per functional unit`,
    `Change: ${comparison.deltaKgCo2e.toFixed(4)} kgCO2e${comparison.deltaPercent === null ? " (no percentage — the baseline is zero)" : ` (${comparison.deltaPercent.toFixed(2)}%)`}`,
    comparison.coverageChanged
      ? "NOTE: the two runs do not cover the same set of flows, so the difference is partly a coverage difference and must be caveated."
      : "Both runs cover the same set of flows.",
    "",
    "By stage:",
    ...comparison.byStage.map(
      (s) => `- ${s.name}: baseline ${s.baselineKgCo2e.toFixed(4)} → scenario ${s.scenarioKgCo2e.toFixed(4)} (${s.deltaKgCo2e >= 0 ? "+" : ""}${s.deltaKgCo2e.toFixed(4)} kgCO2e)`,
    ),
  ].join("\n");

  const systemPrompt = buildSystemPrompt({
    role: [
      LCA_ROLE,
      "Your task now is to interpret a scenario comparison the engine has already calculated.",
      "Quote the figures below exactly. Do not compute any percentage or total yourself, including ones that look trivial.",
      "Say plainly what changed, which stage drove it, whether the largest hotspot moved, and what would need to be true in reality for the scenario to hold.",
      "Three short paragraphs at most.",
    ].join(" "),
    context: `SCENARIO COMPARISON (deterministic):\n${comparisonText}\n\nBASELINE STUDY CONTEXT:\n${buildLcaContext(project, run)}`,
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
      entityId: project.entityId,
      relatedType: "LCA_PROJECT",
      relatedId: project.id,
    },
  });

  return { answer: result.data, meta: result.meta };
}
