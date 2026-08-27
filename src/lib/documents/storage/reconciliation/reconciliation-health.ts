/**
 * SharePoint reconciliation health snapshot (task SP06, mirrors
 * `src/lib/ems/legal/legal-sync-health.ts`, T42). Read-only, derived from
 * `StorageReconciliationCursor`/`StorageSiteBinding` plus the
 * `sharepoint.reconcile` topic's `OutboxMessage`/`JobRun` rows — no
 * separate heartbeat table, same convention as every other T21-based
 * worker's health surface.
 *
 * Never includes a filename, SharePoint path, or any customer content —
 * only counts and cursor/job status (SP06 "add health/freshness status
 * without exposing customer file names or content in platform logs").
 * Tenant-scoped: every query here is bound to one `organisationId`, so an
 * organisation can only ever see its own bindings' health.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { SHAREPOINT_RECONCILE_JOB_TOPIC } from "./reconciliation-service";

/** A cursor with no successful run inside this window is reported stale regardless of its persisted `status` (which only reflects the *last attempt's* outcome). Matches the reconciliation worker's expected daily-or-more-often cadence. */
export const DEFAULT_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 60 * 1000;

export interface SiteBindingReconciliationHealth {
  siteBindingId: string;
  label: string | null;
  cursorStatus: string | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  isStale: boolean;
  /** Count of this binding's ExternalFileReference rows currently carrying a non-null `reconciliationIssue`, grouped by issue — never filenames/paths. */
  issueCounts: Record<string, number>;
  unreachableCount: number;
  staleCount: number;
}

export interface SharePointReconciliationHealthSnapshot {
  generatedAt: Date;
  bindings: SiteBindingReconciliationHealth[];
  pendingJobs: number;
  retryingJobs: number;
  deadLetteredJobs: number;
  recentJobRuns: number;
  recentJobFailures: number;
}

/**
 * Builds one organisation's reconciliation health snapshot. Tenant-scoped
 * by `ctx.organisationId` throughout — never accepts a raw organisation id
 * from a caller.
 */
export async function getSharePointReconciliationHealth(
  ctx: TenantRepositoryContext,
  now: Date = new Date(),
): Promise<SharePointReconciliationHealthSnapshot> {
  const staleThreshold = new Date(now.getTime() - DEFAULT_STALE_AFTER_MS);
  const recentSince = new Date(now.getTime() - RECENT_WINDOW_MS);

  const [bindings, pendingJobs, retryingJobs, deadLetteredJobs, recentJobRuns, recentJobFailures] = await Promise.all([
    prisma.storageSiteBinding.findMany({
      where: { organisationId: ctx.organisationId },
      include: { reconciliationCursor: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, topic: SHAREPOINT_RECONCILE_JOB_TOPIC, status: "PENDING" } }),
    prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, topic: SHAREPOINT_RECONCILE_JOB_TOPIC, status: "RETRY" } }),
    prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, topic: SHAREPOINT_RECONCILE_JOB_TOPIC, status: "DEAD_LETTER" } }),
    prisma.jobRun.count({ where: { organisationId: ctx.organisationId, jobType: SHAREPOINT_RECONCILE_JOB_TOPIC, startedAt: { gte: recentSince } } }),
    prisma.jobRun.count({
      where: { organisationId: ctx.organisationId, jobType: SHAREPOINT_RECONCILE_JOB_TOPIC, startedAt: { gte: recentSince }, status: "FAILED" },
    }),
  ]);

  const bindingHealth: SiteBindingReconciliationHealth[] = await Promise.all(
    bindings.map(async (binding) => {
      const cursor = binding.reconciliationCursor;
      const isStale = !cursor || cursor.lastSuccessAt === null || cursor.lastSuccessAt < staleThreshold;

      const [issueGroups, unreachableCount, staleCount] = await Promise.all([
        prisma.externalFileReference.groupBy({
          by: ["reconciliationIssue"],
          where: { organisationId: ctx.organisationId, siteBindingId: binding.id, reconciliationIssue: { not: null } },
          _count: { _all: true },
        }),
        prisma.externalFileReference.count({ where: { organisationId: ctx.organisationId, siteBindingId: binding.id, referenceStatus: "UNREACHABLE" } }),
        prisma.externalFileReference.count({ where: { organisationId: ctx.organisationId, siteBindingId: binding.id, referenceStatus: "STALE" } }),
      ]);

      const issueCounts: Record<string, number> = {};
      for (const group of issueGroups) {
        if (group.reconciliationIssue) issueCounts[group.reconciliationIssue] = group._count._all;
      }

      return {
        siteBindingId: binding.id,
        label: binding.label,
        cursorStatus: cursor?.status ?? null,
        lastSuccessAt: cursor?.lastSuccessAt ?? null,
        lastAttemptAt: cursor?.lastAttemptAt ?? null,
        isStale,
        issueCounts,
        unreachableCount,
        staleCount,
      };
    }),
  );

  return {
    generatedAt: now,
    bindings: bindingHealth,
    pendingJobs,
    retryingJobs,
    deadLetteredJobs,
    recentJobRuns,
    recentJobFailures,
  };
}
