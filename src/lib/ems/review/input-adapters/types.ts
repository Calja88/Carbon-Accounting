/**
 * Read-only input adapter contract for management review inputs (task T72,
 * Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md §5 "pack adapter
 * contract" / §11 "read-only interfaces from prior modules").
 *
 * T72 only needs the *resolution* half of the spec §5 contract — finding
 * the exact current source record(s)/version(s) a coordinator can link
 * into a review via `ManagementReviewInputLink` (review-service.ts). The
 * full frozen `ReviewInputSnapshot`/checksum/generator-version pack
 * (spec §5 "same database snapshot/cutoff and generator version must
 * serialize identically") is T73's `pack-service.ts` — not built here
 * (task packet "do not implement beyond T72").
 *
 * Every adapter is tenant-scoped through `TenantRepositoryContext` and
 * reads exclusively already-issued/frozen source rows where the source
 * module has that concept (T45 `ComplianceEvaluation.status === "ISSUED"`,
 * T61 `AuditReportRevision.status === "ISSUED"`), never a draft/mutable
 * one — an unissued source can never be linked as a review input.
 */

import type { ManagementReviewInputSourceType } from "@prisma/client";
import type { TenantRepositoryContext } from "@/lib/repositories/context";

/** One exact source record a review can link for an input key. */
export interface ReviewInputResolution {
  sourceType: ManagementReviewInputSourceType;
  sourceRecordId: string;
  sourceVersionLabel: string | null;
  summary: Record<string, unknown>;
  /** True when the resolved record predates the requested cutoff by more than the adapter's freshness window. */
  isStale: boolean;
}

export interface ReviewInputAdapter {
  readonly sourceType: ManagementReviewInputSourceType;
  /** Resolves every candidate exact source record as of `cutoff`, newest first. */
  resolveCandidates(ctx: TenantRepositoryContext, cutoff: Date): Promise<ReviewInputResolution[]>;
}
