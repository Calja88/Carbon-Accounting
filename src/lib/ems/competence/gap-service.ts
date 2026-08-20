/**
 * Competence gap reporting (task T70, Docs/PHASE7_COMPETENCE_MANAGEMENT_REVIEW_SPEC.md
 * §3 "CompetenceGap: derived/read model"). Deliberately a read model, not a
 * persisted workflow — the spec allows either shape, and a read model keeps
 * this task's schema surface to what person/requirement mapping actually
 * needs, leaving the fuller severity/mitigation workflow to T71/T72 if
 * product wants it.
 *
 * Fixed decisions (T70 acceptance: "gap report is tenant/site scoped"):
 *  - tenant scope comes from `tenantWhere` like every other read in this
 *    module family;
 *  - site scope reuses the exact RESTRICTED-membership visibility rule as
 *    `listPersonProfiles`/`accessiblePersonProfileFilter` (person-service.ts)
 *    — a Site Manager only ever sees gaps for persons scoped to their
 *    granted Entity/Site, never the wider organisation;
 *  - a gap includes both an assignment already marked GAP and one that is
 *    REQUIRED/IN_PROGRESS past its `dueDate` — the latter is reported as
 *    "OVERDUE" severity without mutating the assignment's own status, so
 *    listing gaps is never itself a write;
 *  - the report never joins `PersonSensitiveProfile` — only
 *    `PersonProfile.displayName`/membership are surfaced, keeping the gap
 *    view usable by anyone with `ems.competence.view` regardless of the
 *    separate `ems.competence.sensitive.view` grant.
 */

import type { CompetenceAssignmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { tenantWhere } from "@/lib/repositories/tenant-scope";

const VIEW_PERMISSION = "ems.competence.view" as const;

export type CompetenceGapSeverity = "GAP" | "OVERDUE";

export interface CompetenceGapRow {
  assignmentId: string;
  personId: string;
  personDisplayName: string | null;
  requirementVersionId: string;
  requirementTitle: string;
  status: "REQUIRED" | "IN_PROGRESS" | "GAP";
  severity: CompetenceGapSeverity;
  dueDate: Date | null;
  gapSince: Date | null;
  gapNote: string | null;
}

/** Mirrors `accessiblePersonProfileFilter` (person-service.ts) exactly. */
function accessiblePersonFilter(context: OrganisationContext) {
  if (context.access.mode === "ORGANISATION_WIDE") return {};
  return {
    OR: [
      { siteId: { in: [...context.access.siteIds] } },
      { entityId: { in: [...context.access.entityIds] } },
    ],
  };
}

export interface ListCompetenceGapsFilter {
  entityId?: string;
  siteId?: string;
}

/** Tenant- and site-scoped competence gap report. */
export async function listCompetenceGaps(context: OrganisationContext, filter: ListCompetenceGapsFilter = {}): Promise<CompetenceGapRow[]> {
  requirePermission(context, VIEW_PERMISSION);
  const ctx = toTenantRepositoryContext(context);
  const now = new Date();

  const openStatuses: CompetenceAssignmentStatus[] = ["REQUIRED", "IN_PROGRESS", "GAP"];
  const assignments = await prisma.competenceAssignment.findMany({
    where: tenantWhere(ctx, {
      status: { in: openStatuses },
      person: {
        ...accessiblePersonFilter(context),
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.siteId ? { siteId: filter.siteId } : {}),
      },
    }),
    include: {
      person: { select: { id: true, displayName: true, membership: { select: { user: { select: { name: true } } } } } },
      requirementVersion: { select: { id: true, title: true } },
    },
    orderBy: { assignedAt: "desc" },
  });

  const rows: CompetenceGapRow[] = [];
  for (const assignment of assignments) {
    const isOverdue = assignment.status !== "GAP" && Boolean(assignment.dueDate) && assignment.dueDate! < now;
    if (assignment.status !== "GAP" && !isOverdue) continue;

    rows.push({
      assignmentId: assignment.id,
      personId: assignment.person.id,
      personDisplayName: assignment.person.displayName ?? assignment.person.membership?.user.name ?? null,
      requirementVersionId: assignment.requirementVersion.id,
      requirementTitle: assignment.requirementVersion.title,
      status: assignment.status,
      severity: assignment.status === "GAP" ? "GAP" : "OVERDUE",
      dueDate: assignment.dueDate,
      gapSince: assignment.gapSince,
      gapNote: assignment.gapNote,
    });
  }

  return rows;
}
