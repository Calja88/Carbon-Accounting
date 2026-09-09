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
