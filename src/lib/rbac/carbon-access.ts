import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission, PermissionDeniedError } from "./authorize";

export function requireCarbonView(context: OrganisationContext): void {
  requirePermission(context, "carbon.view");
}
/** Frozen reports describe the whole organisation. This sprint cannot prove a restricted frozen boundary. */
export function requireFrozenReportAccess(context: OrganisationContext, exporting = false): void {
  requireCarbonView(context);
  if (exporting) requirePermission(context, "carbon.report.export");
  if (context.access.mode !== "ORGANISATION_WIDE") throw new PermissionDeniedError("ENTITY_NOT_IN_SCOPE");
}
/**
 * Phase 5B — exporting the live management report. It reuses the same
 * `carbon.report.export` permission the frozen-report export already requires,
 * rather than inventing an export role of its own.
 *
 * It deliberately does *not* go through `requireFrozenReportAccess`: that
 * insists on ORGANISATION_WIDE access because a frozen report describes the
 * whole organisation, whereas the management report is site-scoped by design,
 * so a restricted site lead exports a truthful report for their own sites.
 */
export function requireManagementReportExport(context: OrganisationContext): void {
  requireCarbonView(context);
  requirePermission(context, "carbon.report.export");
}
