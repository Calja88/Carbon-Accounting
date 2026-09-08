/**
 * Legal sync health snapshot (task T42, Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md
 * §9 "provider health and stale-cursor alerts"). Read-only, derived entirely
 * from `LegalSyncCursor`/`LegalSourceProvider` plus the `legal.sync` topic's
 * `OutboxMessage`/`JobRun` rows — same "no separate heartbeat table"
 * convention as the T21 worker health snapshot (`src/lib/jobs/health.ts`),
 * scoped to this one topic instead of every job in the platform.
 *
 * Never infers legal applicability or compliance — this reports whether the
 * platform's own copy of upstream source data is current, nothing about
 * what any of it means for an organisation.
 */

import { prisma } from "@/lib/prisma";
import { LEGAL_SYNC_JOB_TOPIC } from "./legal-sync-worker";

/** A cursor with no successful sync inside this window is reported STALE regardless of its persisted `status`, which only reflects the *last attempt's* outcome, not overall freshness. Twice the "daily by default" cadence (Docs/EMS_EXPANSION_PLAN.md §5.2). */
export const DEFAULT_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 60 * 1000;

export interface LegalSyncCursorHealth {
  id: string;
  stream: string;
  filterKey: string;
  status: string;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  overlapStartAt: Date | null;
  isStale: boolean;
  diagnostic: string | null;
}

export interface LegalSyncProviderHealth {
  providerKey: string;
  providerName: string;
  providerStatus: string;
  cursors: LegalSyncCursorHealth[];
}

export interface LegalSyncHealthSnapshot {
  generatedAt: Date;
  providers: LegalSyncProviderHealth[];
  pendingJobs: number;
  retryingJobs: number;
  deadLetteredJobs: number;
  recentJobRuns: number;
  recentJobFailures: number;
}

function diagnoseCursor(
  cursor: { status: string; lastSuccessAt: Date | null },
  isStale: boolean,
): string | null {
  if (cursor.status === "ERROR") {
    return "Last sync attempt failed — check the legal.sync job's retry/dead-letter state for the error detail.";
  }
  if (isStale && cursor.lastSuccessAt === null) {
    return "Never synced successfully.";
  }
  if (isStale) {
    return `No successful sync since ${cursor.lastSuccessAt?.toISOString() ?? "unknown"}.`;
  }
  return null;
}

export async function getLegalSyncHealth(now: Date = new Date()): Promise<LegalSyncHealthSnapshot> {
  const staleThreshold = new Date(now.getTime() - DEFAULT_STALE_AFTER_MS);
  const recentSince = new Date(now.getTime() - RECENT_WINDOW_MS);

  const [providers, pendingJobs, retryingJobs, deadLetteredJobs, recentJobRuns, recentJobFailures] = await Promise.all([
    prisma.legalSourceProvider.findMany({
      include: { cursors: { orderBy: [{ stream: "asc" }, { filterKey: "asc" }] } },
      orderBy: { key: "asc" },
    }),
    prisma.outboxMessage.count({ where: { topic: LEGAL_SYNC_JOB_TOPIC, status: "PENDING" } }),
    prisma.outboxMessage.count({ where: { topic: LEGAL_SYNC_JOB_TOPIC, status: "RETRY" } }),
    prisma.outboxMessage.count({ where: { topic: LEGAL_SYNC_JOB_TOPIC, status: "DEAD_LETTER" } }),
    prisma.jobRun.count({ where: { jobType: LEGAL_SYNC_JOB_TOPIC, startedAt: { gte: recentSince } } }),
    prisma.jobRun.count({ where: { jobType: LEGAL_SYNC_JOB_TOPIC, startedAt: { gte: recentSince }, status: "FAILED" } }),
  ]);

  return {
    generatedAt: now,
    providers: providers.map((provider) => ({
      providerKey: provider.key,
      providerName: provider.name,
      providerStatus: provider.status,
      cursors: provider.cursors.map((cursor) => {
        const isStale = cursor.lastSuccessAt === null || cursor.lastSuccessAt < staleThreshold;
        return {
          id: cursor.id,
          stream: cursor.stream,
          filterKey: cursor.filterKey,
          status: cursor.status,
          lastSuccessAt: cursor.lastSuccessAt,
          lastAttemptAt: cursor.lastAttemptAt,
          overlapStartAt: cursor.overlapStartAt,
          isStale,
          diagnostic: diagnoseCursor(cursor, isStale),
        };
      }),
    })),
    pendingJobs,
    retryingJobs,
    deadLetteredJobs,
    recentJobRuns,
    recentJobFailures,
  };
}
