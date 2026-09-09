/**
 * Actions-status input adapter (task T72) — reads T52's `ActionItem` rows
 * still open (not COMPLETED/VERIFIED/CANCELLED) as of the review cutoff.
 * Overlaps deliberately with `review-service.ts#listOpenPriorActions` (the
 * "open prior actions are included" read model, spec §1 acceptance): this
 * adapter is what a coordinator links as the agenda's "actions status"
 * input, while the prior-actions list is always shown regardless of
 * whether it has been linked — see `review-service.ts` file header.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "REOPENED"] as const;

export const actionProgrammeAdapter: ReviewInputAdapter = {
  sourceType: "ACTION_PROGRAMME",

  async resolveCandidates(ctx: TenantRepositoryContext, cutoff: Date): Promise<ReviewInputResolution[]> {
    const rows = await prisma.actionItem.findMany({
      where: tenantWhere(ctx, {
        status: { in: [...OPEN_STATUSES] },
        createdAt: { lte: cutoff },
      }),
      orderBy: { dueDate: "asc" },
      take: 50,
      select: { id: true, programmeId: true, title: true, status: true, dueDate: true },
    });

    return rows.map((row) => ({
      sourceType: "ACTION_PROGRAMME" as const,
      sourceRecordId: row.id,
      sourceVersionLabel: row.status,
      summary: {
        programmeId: row.programmeId,
        title: row.title,
        status: row.status,
        dueDate: row.dueDate.toISOString(),
      },
      isStale: false,
    }));
  },
};
