/**
 * Compliance-status input adapter (task T72) — reads T45's issued
 * `ComplianceEvaluation` rows. Never reads a PLANNED/IN_PROGRESS/COMPLETED
 * (not-yet-issued) evaluation: only an issued evaluation has a frozen
 * `reportPayload`, so only an issued one is a stable "exact version" a
 * review can point at.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const STALE_AFTER_MS = 400 * 24 * 60 * 60 * 1000; // ~13 months

export const complianceEvaluationAdapter: ReviewInputAdapter = {
  sourceType: "COMPLIANCE_EVALUATION",

  async resolveCandidates(ctx: TenantRepositoryContext, cutoff: Date): Promise<ReviewInputResolution[]> {
    const rows = await prisma.complianceEvaluation.findMany({
      where: tenantWhere(ctx, { status: "ISSUED" as const, issuedAt: { lte: cutoff } }),
      orderBy: { issuedAt: "desc" },
      take: 10,
      select: { id: true, issuedAt: true, periodStart: true, periodEnd: true, programmeId: true },
    });

    return rows.map((row) => ({
      sourceType: "COMPLIANCE_EVALUATION" as const,
      sourceRecordId: row.id,
      sourceVersionLabel: row.issuedAt ? row.issuedAt.toISOString() : null,
      summary: {
        programmeId: row.programmeId,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      },
      isStale: row.issuedAt ? cutoff.getTime() - row.issuedAt.getTime() > STALE_AFTER_MS : true,
    }));
  },
};
