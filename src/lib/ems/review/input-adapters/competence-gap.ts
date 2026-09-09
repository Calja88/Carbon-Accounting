/**
 * Competence-gap input adapter (task T72) — reads T71's `CompetenceAssignment`
 * rows currently in a gap state (GAP or EXPIRED). Mirrors
 * `gap-service.ts#listCompetenceGaps`'s status filter, but reads directly
 * through `TenantRepositoryContext` rather than `OrganisationContext`
 * (adapters run inside an already permission-checked `review-service.ts`
 * call, not as a standalone user-facing read) and does not apply that
 * service's site-scoped visibility narrowing — a review coordinator with
 * `ems.management_review.manage` sees the organisation-wide gap picture.
 *
 * Every assignment is "current" by construction (gap-service.ts's own
 * comment: "a requirement revision does not alter historical assignment"),
 * so there is no historical cutoff to apply here the way issued
 * evaluations/reports have — `isStale` is always false.
 */

import type { CompetenceAssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const GAP_STATUSES: readonly CompetenceAssignmentStatus[] = ["GAP", "EXPIRED"];

export const competenceGapAdapter: ReviewInputAdapter = {
  sourceType: "COMPETENCE_GAP",

  async resolveCandidates(ctx: TenantRepositoryContext, _cutoff: Date): Promise<ReviewInputResolution[]> {
    const rows = await prisma.competenceAssignment.findMany({
      where: tenantWhere(ctx, { status: { in: [...GAP_STATUSES] } }),
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        personId: true,
        requirementVersionId: true,
        status: true,
        gapSince: true,
        updatedAt: true,
      },
    });

    return rows.map((row) => ({
      sourceType: "COMPETENCE_GAP" as const,
      sourceRecordId: row.id,
      sourceVersionLabel: row.status,
      summary: {
        personId: row.personId,
        requirementVersionId: row.requirementVersionId,
        status: row.status,
        gapSince: row.gapSince ? row.gapSince.toISOString() : null,
      },
      isStale: false,
    }));
  },
};
