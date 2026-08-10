/**
 * The AI audit trail.
 *
 * Every AI call attempt writes one AiInteraction row — success, refusal,
 * validation failure or provider outage alike — so an auditor can see what
 * the AI was asked to do, which model answered, how confident it was, what it
 * cost, and whether a human accepted the result.
 *
 * What is deliberately *not* recorded:
 *
 *  - API keys. Never, at any logging level, in any field.
 *  - Full prompts and raw document text. An invoice can carry commercially
 *    sensitive and personal data; copying it into a second, longer-lived
 *    table multiplies the exposure for no audit benefit. The extraction
 *    result and the source document are both already stored and linked, which
 *    is what an audit actually needs.
 *
 * Retention is bounded — see `pruneAiInteractions`.
 */

import { AiCallStatus, AiLoggingLevel, AiTaskType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scrubSecrets } from "./providers/openrouter";

export interface AiAuditContext {
  task: AiTaskType;
  feature: string;
  userId: string | null;
  /** Phase 1 tenancy (T18): the Organisation this call was made within — always the caller's AiActor.organisationId. */
  organisationId: string;
  entityId?: string | null;
  siteId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  sourceDocumentId?: string | null;
}

export interface AiAuditRecord extends AiAuditContext {
  provider: string;
  modelRequested: string;
  modelUsed: string | null;
  status: AiCallStatus;
  usedFallback: boolean;
  attempts: number;
  latencyMs: number | null;
  confidence?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Validated structured output only — never a raw model string, never a prompt. */
  outputSummary?: Prisma.InputJsonValue | null;
}

function clampConfidence(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Writes one audit row. Never throws: a failure to log must not fail the
 * user's request, and must not mask the original error.
 */
export async function recordAiInteraction(
  record: AiAuditRecord,
  loggingLevel: AiLoggingLevel,
): Promise<string | null> {
  try {
    const keepPayload = loggingLevel !== AiLoggingLevel.MINIMAL;

    const row = await prisma.aiInteraction.create({
      data: {
        task: record.task,
        feature: record.feature,
        provider: record.provider,
        modelRequested: record.modelRequested,
        modelUsed: record.modelUsed,
        status: record.status,
        usedFallback: record.usedFallback,
        attempts: record.attempts,
        userId: record.userId,
        organisationId: record.organisationId,
        entityId: record.entityId ?? null,
        siteId: record.siteId ?? null,
        relatedType: record.relatedType ?? null,
        relatedId: record.relatedId ?? null,
        sourceDocumentId: record.sourceDocumentId ?? null,
        confidence: clampConfidence(record.confidence),
        promptTokens: record.promptTokens ?? null,
        completionTokens: record.completionTokens ?? null,
        totalTokens: record.totalTokens ?? null,
        costUsd: record.costUsd ?? null,
        latencyMs: record.latencyMs,
        errorCode: record.errorCode ?? null,
        errorMessage: record.errorMessage ? scrubSecrets(record.errorMessage).slice(0, 2000) : null,
        outputSummary: keepPayload && record.outputSummary ? record.outputSummary : Prisma.DbNull,
      },
      select: { id: true },
    });
    return row.id;
  } catch {
    return null;
  }
}

/**
 * Retention boundary. AI interaction rows are operational telemetry plus an
 * audit trail of *decisions*; the decisions themselves live on AiSuggestion,
 * DocumentExtraction and ActivityEntry, which are never pruned. Defaults to
 * 400 days so a full reporting year plus a comparison year stays available.
 */
export async function pruneAiInteractions(retentionDays = 400): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.aiInteraction.deleteMany({
    where: { createdAt: { lt: cutoff }, suggestions: { none: {} } },
  });
  return result.count;
}

export interface AiUsageSummary {
  requestsToday: number;
  failuresToday: number;
  fallbacksToday: number;
  byFeature: { feature: string; count: number }[];
  byModel: { model: string; count: number }[];
  byStatus: { status: AiCallStatus; count: number }[];
  /** Sum of provider-reported costs only. Null when the provider reported none. */
  reportedCostTodayUsd: number | null;
}

/**
 * Powers the admin usage panel, scoped to one Organisation (Phase 1 tenancy,
 * T18) — an organisation administrator sees only their own tenant's AI usage,
 * never the platform's aggregate. Counts only — no prompt or output content.
 */
export async function getAiUsageSummary(organisationId: string, sinceHours = 24): Promise<AiUsageSummary> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const where = { organisationId, createdAt: { gte: since } };

  const [total, failures, fallbacks, byFeature, byModel, byStatus, costAgg] = await Promise.all([
    prisma.aiInteraction.count({ where }),
    prisma.aiInteraction.count({ where: { ...where, status: { not: AiCallStatus.SUCCESS } } }),
    prisma.aiInteraction.count({ where: { ...where, usedFallback: true } }),
    prisma.aiInteraction.groupBy({ by: ["feature"], where, _count: { _all: true } }),
    prisma.aiInteraction.groupBy({ by: ["modelUsed"], where, _count: { _all: true } }),
    prisma.aiInteraction.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.aiInteraction.aggregate({ where, _sum: { costUsd: true } }),
  ]);

  return {
    requestsToday: total,
    failuresToday: failures,
    fallbacksToday: fallbacks,
    byFeature: byFeature
      .map((f) => ({ feature: f.feature, count: f._count._all }))
      .sort((a, b) => b.count - a.count),
    byModel: byModel
      .map((m) => ({ model: m.modelUsed ?? "(none)", count: m._count._all }))
      .sort((a, b) => b.count - a.count),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })).sort((a, b) => b.count - a.count),
    reportedCostTodayUsd: costAgg._sum.costUsd === null ? null : Number(costAgg._sum.costUsd),
  };
}
