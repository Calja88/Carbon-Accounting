import { EMS_MODULES, isAvailable, type AvailableEmsModule } from "@/lib/ems/navigation/registry";
import { SYSTEM_ROLE_TEMPLATES } from "@/lib/rbac/role-templates";
import type { PermissionCode } from "@/lib/rbac/permission-catalogue";

/**
 * UI14 synthetic personas. Credentials/roles must match
 * `prisma/seed/ems-demo.ts` exactly — that script is the only place these
 * users are created (local synthetic Postgres only, never a real database).
 */
export const PERSONAS = {
  sustainabilityLead: { email: "sustainability.lead@ui14-demo.example", templateKey: "SUSTAINABILITY_LEAD", active: true },
  orgAdmin: { email: "org.admin@ui14-demo.example", templateKey: "ORGANISATION_ADMINISTRATOR", active: true },
  contributor: { email: "contributor@ui14-demo.example", templateKey: "EMS_CONTRIBUTOR", active: true },
  readOnly: { email: "readonly@ui14-demo.example", templateKey: "FINANCE_READ_ONLY", active: true },
  restrictedSite: { email: "restricted.site@ui14-demo.example", templateKey: "SITE_MANAGER", active: true },
  suspended: { email: "suspended@ui14-demo.example", templateKey: "EMS_CONTRIBUTOR", active: false },
} as const;

export const DEMO_PASSWORD = "Ui14Demo!2026";

export type PersonaKey = keyof typeof PERSONAS;

const permissionsByTemplate = new Map<string, Set<PermissionCode>>(
  SYSTEM_ROLE_TEMPLATES.map((t) => [t.templateKey, new Set(t.permissionCodes as PermissionCode[])]),
);

/** Mirrors `getVisibleEmsModules` (registry.ts) without needing a live `OrganisationContext`. */
export function visibleModulesFor(persona: PersonaKey): AvailableEmsModule[] {
  const def = PERSONAS[persona];
  if (!def.active) return [];
  const granted = permissionsByTemplate.get(def.templateKey) ?? new Set<PermissionCode>();
  if (!granted.has("ems.view")) return [];
  return EMS_MODULES.filter(isAvailable).filter((m) => !m.permission || granted.has(m.permission));
}

export function hiddenModulesFor(persona: PersonaKey): AvailableEmsModule[] {
  const visible = new Set(visibleModulesFor(persona).map((m) => m.id));
  return EMS_MODULES.filter(isAvailable).filter((m) => !visible.has(m.id));
}
