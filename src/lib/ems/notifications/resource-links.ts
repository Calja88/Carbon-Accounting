/**
 * UI04 — maps a notification's `resourceType` (T24, `src/lib/notifications/types.ts`)
 * to the EMS route that shows that record, so a work-queue item can link back
 * to it. Only resource types whose `resourceId` is known to be the id used by
 * an existing detail/list route are linked; everything else resolves to
 * `null` rather than guessing a URL that might 404.
 */

const RESOURCE_TYPE_ROUTES: Record<string, (resourceId: string) => string> = {
  controlled_document: (id) => `/ems/documents/${id}`,
  audit_report: (id) => `/ems/audits/${id}`,
  compliance_obligation: () => `/ems/legal/obligations`,
  compliance_evaluation: () => `/ems/legal/evaluations`,
  legal_source: () => `/ems/legal/provider-health`,
  action: () => `/ems/actions`,
  objective: () => `/ems/objectives`,
  ems_scope_version: () => `/ems/programme`,
  change_assessment: () => `/ems/programme`,
  operational_control: () => `/ems/controls`,
  monitoring_equipment: () => `/ems/monitoring`,
  external_provider_control: () => `/ems/providers`,
  emergency_plan: () => `/ems/emergency`,
  corrective_action: () => `/ems/nonconformities`,
};

export function resourceLink(resourceType: string, resourceId: string): string | null {
  const route = RESOURCE_TYPE_ROUTES[resourceType];
  return route ? route(resourceId) : null;
}
