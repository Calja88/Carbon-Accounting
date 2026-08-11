/**
 * Worker health snapshot (task T21 acceptance: "...and worker health").
 * Derived entirely from `OutboxMessage`/`JobRun` state rather than a
 * separate heartbeat table — a stuck worker shows up as a growing backlog
 * of stale leases and a `JobRun` failure streak, which is what an operator
 * actually needs to see.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

export interface WorkerHealthSnapshot {
  pendingCount: number;
  retryCount: number;
  staleLeaseCount: number;
  deadLetterCount: number;
  recentRunCount: number;
  recentFailureCount: number;
}

const RECENT_WINDOW_MS = 60 * 60 * 1000;

/** Platform-wide snapshot across every organisation — for platform operators, not a tenant-facing view. */
export async function getPlatformWorkerHealth(): Promise<WorkerHealthSnapshot> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS);
  const [pendingCount, retryCount, staleLeaseCount, deadLetterCount, recentRunCount, recentFailureCount] =
    await Promise.all([
      prisma.outboxMessage.count({ where: { status: "PENDING" } }),
      prisma.outboxMessage.count({ where: { status: "RETRY" } }),
      prisma.outboxMessage.count({ where: { status: "LEASED", leaseUntil: { lt: new Date() } } }),
      prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } }),
      prisma.jobRun.count({ where: { startedAt: { gte: since } } }),
      prisma.jobRun.count({ where: { startedAt: { gte: since }, status: "FAILED" } }),
    ]);
  return { pendingCount, retryCount, staleLeaseCount, deadLetterCount, recentRunCount, recentFailureCount };
}

/** Tenant-scoped snapshot for an organisation's own jobs only. */
export async function getOrganisationWorkerHealth(ctx: TenantRepositoryContext): Promise<WorkerHealthSnapshot> {
  const since = new Date(Date.now() - RECENT_WINDOW_MS);
  const [pendingCount, retryCount, staleLeaseCount, deadLetterCount, recentRunCount, recentFailureCount] =
    await Promise.all([
      prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, status: "PENDING" } }),
      prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, status: "RETRY" } }),
      prisma.outboxMessage.count({
        where: { organisationId: ctx.organisationId, status: "LEASED", leaseUntil: { lt: new Date() } },
      }),
      prisma.outboxMessage.count({ where: { organisationId: ctx.organisationId, status: "DEAD_LETTER" } }),
      prisma.jobRun.count({ where: { organisationId: ctx.organisationId, startedAt: { gte: since } } }),
      prisma.jobRun.count({
        where: { organisationId: ctx.organisationId, startedAt: { gte: since }, status: "FAILED" },
      }),
    ]);
  return { pendingCount, retryCount, staleLeaseCount, deadLetterCount, recentRunCount, recentFailureCount };
}
