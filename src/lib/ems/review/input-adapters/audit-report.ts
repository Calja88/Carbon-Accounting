/**
 * Audit-findings input adapter (task T72) — reads T61's issued
 * `AuditReportRevision` rows. Never reads a DRAFT report: only an issued
 * report has a frozen `frozenPayload`/`checksumSha256`, so only an issued
 * one is a stable "exact version" a review can point at.
 */

import { prisma } from "@/lib/prisma";
import type { TenantRepositoryContext } from "@/lib/repositories/context";
import { tenantWhere } from "@/lib/repositories/tenant-scope";
import type { ReviewInputAdapter, ReviewInputResolution } from "./types";

const STALE_AFTER_MS = 400 * 24 * 60 * 60 * 1000; // ~13 months

export const auditReportAdapter: ReviewInputAdapter = {
  sourceType: "AUDIT_REPORT",

  async resolveCandidates(ctx: TenantRepositoryContext, cutoff: Date): Promise<ReviewInputResolution[]> {
    const rows = await prisma.auditReportRevision.findMany({
      where: tenantWhere(ctx, { status: "ISSUED" as const, issuedAt: { lte: cutoff } }),
      orderBy: { issuedAt: "desc" },
      take: 10,
      select: { id: true, auditId: true, revisionNumber: true, issuedAt: true, checksumSha256: true },
    });

    return rows.map((row) => ({
      sourceType: "AUDIT_REPORT" as const,
      sourceRecordId: row.id,
      sourceVersionLabel: `revision ${row.revisionNumber}`,
      summary: {
        auditId: row.auditId,
        revisionNumber: row.revisionNumber,
        issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
        checksumSha256: row.checksumSha256,
      },
      isStale: row.issuedAt ? cutoff.getTime() - row.issuedAt.getTime() > STALE_AFTER_MS : true,
    }));
  },
};
