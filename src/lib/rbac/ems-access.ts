import type { OrganisationContext, PermissionCode } from "@/lib/organisation/context";
import { requirePermission, PermissionDeniedError } from "./authorize";
/** Only for the EMS surfaces whose complete scope is not yet implemented. */
export function requireUnscopedEmsAccess(context: OrganisationContext, permission: PermissionCode = "ems.view"): void {
  requirePermission(context, permission);
  if (context.access.mode !== "ORGANISATION_WIDE") throw new PermissionDeniedError("ENTITY_NOT_IN_SCOPE");
}
