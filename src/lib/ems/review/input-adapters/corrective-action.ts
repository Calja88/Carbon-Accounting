/**
 * CAPA-status input adapter (task T72) — reads T64's `CorrectiveAction`
 * rows, each an exact record (not a versioned document, so
 * `sourceVersionLabel` carries its status/updatedAt rather than a version
 * number) alongside its most recent `EffectivenessReview` outcome, if any.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const STALE_AFTER_MS = 200 * 24 * 60 * 60 * 1000; // ~6.5 months

export const correctiveActionAdapter: ReviewInputAdapter = {
  sourceType: "CORRECTIVE_ACTION",

  async resolveCandidates(ctx: TenantRepositoryContext, cutoff: Date): Promise<ReviewInputResolution[]> {
    const rows = await prisma.correctiveAction.findMany({
      where: tenantWhere(ctx, { createdAt: { lte: cutoff } }),
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        nonconformityId: true,
        status: true,
        updatedAt: true,
        dueDate: true,
      },
    });

    const reviews = await prisma.effectivenessReview.findMany({
      where: tenantWhere(ctx, { nonconformityId: { in: rows.map((row) => row.nonconformityId) } }),
      orderBy: { reviewDate: "desc" },
    });
    const latestReviewByNonconformity = new Map<string, (typeof reviews)[number]>();
    for (const review of reviews) {
      if (!latestReviewByNonconformity.has(review.nonconformityId)) {
        latestReviewByNonconformity.set(review.nonconformityId, review);
      }
    }

    return rows.map((row) => {
      const review = latestReviewByNonconformity.get(row.nonconformityId);
      return {
        sourceType: "CORRECTIVE_ACTION" as const,
        sourceRecordId: row.id,
        sourceVersionLabel: `${row.status} @ ${row.updatedAt.toISOString()}`,
        summary: {
          nonconformityId: row.nonconformityId,
          status: row.status,
          dueDate: row.dueDate.toISOString(),
          effectivenessResult: review?.result ?? null,
        },
        isStale: cutoff.getTime() - row.updatedAt.getTime() > STALE_AFTER_MS,
      };
    });
  },
};
