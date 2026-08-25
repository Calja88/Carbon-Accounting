/**
 * UI01 — EMS module registry (Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md,
 * "EMS home, module navigation and route discoverability").
 *
 * Single source of truth for every EMS route the app links from the top
 * navigation and the `/ems` landing page, plus the permission that gates
 * it. Keeping this list separate from the React components lets a plain
 * Node test assert that every entry still resolves to a real page file —
 * a route can go missing from navigation (T46/T50/T52/T63 already had)
 * without ever failing a build, because Next.js does not complain about an
 * unlinked route.
 *
 * `status: "available"` entries point at pages that exist on this branch.
 * `status: "planned"` entries describe EMS UI work explicitly deferred to a
 * later task (UI02, UI04, UI09-UI12) — rendered as a disabled placeholder,
 * never a broken link.
 */

import type { PermissionCode } from "@/lib/rbac/permission-catalogue";
import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";

export type EmsModuleCategory =
  | "foundation"
  | "documents"
  | "operations"
  | "legal"
  | "objectives"
  | "assurance"
  | "people"
  | "review";

export interface EmsModule {
  id: string;
  label: string;
  description: string;
  category: EmsModuleCategory;
  /** Additional permission beyond `ems.view`, required to see/use this module. */
  permission?: PermissionCode;
}

export interface AvailableEmsModule extends EmsModule {
  status: "available";
  /** Route relative to the app router's `(app)` group, e.g. `/ems/processes`. */
  href: string;
  /** Filesystem path of the page this href renders, relative to the repo root — checked by the route-registry test. */
  pageFile: string;
}

export interface PlannedEmsModule extends EmsModule {
  status: "planned";
  /** Which delivery-pack task is expected to build this module. */
  plannedTask: string;
}

export type EmsModuleEntry = AvailableEmsModule | PlannedEmsModule;

export const EMS_MODULE_CATEGORY_LABELS: Record<EmsModuleCategory, string> = {
  foundation: "Programme & foundation",
  documents: "Controlled documents & evidence",
  operations: "Aspects & operations",
  legal: "Legal & compliance",
  objectives: "Objectives & actions",
  assurance: "Audits, incidents & nonconformities",
  people: "Competence",
  review: "Management review",
};

/**
 * Every entry here is either a link to a page that exists on this branch, or
 * an explicitly deferred placeholder. Do not add an "available" entry unless
 * `pageFile` exists — the route-registry test enforces that.
 */
export const EMS_MODULES: EmsModuleEntry[] = [
  // --- Foundation (T23 — deferred to UI02) ---
  {
    id: "programme",
    label: "EMS programme & scope",
    description: "Programme status, scope boundary, context, interested parties and planned changes.",
    category: "foundation",
    status: "available",
    href: "/ems/programme",
    pageFile: "src/app/(app)/ems/programme/page.tsx",
  },

  // --- Controlled documents & evidence (T22 — UI03) ---
  {
    id: "documents",
    label: "Controlled documents",
    description: "Document register, revision lifecycle, approval and distribution.",
    category: "documents",
    status: "available",
    href: "/ems/documents",
    pageFile: "src/app/(app)/ems/documents/page.tsx",
  },
  {
    id: "evidence",
    label: "Evidence hub",
    description: "Shared evidence objects across the EMS, with status and authorised download.",
    category: "documents",
    status: "available",
    href: "/ems/evidence",
    pageFile: "src/app/(app)/ems/evidence/page.tsx",
  },

  // --- Aspects & operations (T30-T35) ---
  {
    id: "processes",
    label: "Process/activity profiles",
    description: "Site processes, activities, products and services the EMS covers.",
    category: "operations",
    status: "available",
    href: "/ems/processes",
    pageFile: "src/app/(app)/ems/processes/page.tsx",
  },
  {
    id: "aspects",
    label: "Aspect register",
    description: "Environmental aspects, impacts and significance ratings.",
    category: "operations",
    status: "available",
    href: "/ems/aspects",
    pageFile: "src/app/(app)/ems/aspects/page.tsx",
  },
  {
    id: "controls",
    label: "Operational controls",
    description: "Controls that manage significant aspects and their assigned owners.",
    category: "operations",
    status: "available",
    href: "/ems/controls",
    pageFile: "src/app/(app)/ems/controls/page.tsx",
  },
  {
    id: "monitoring",
    label: "Monitoring & measurement",
    description: "Recorded monitoring results and equipment calibration status.",
    category: "operations",
    status: "available",
    href: "/ems/monitoring",
    pageFile: "src/app/(app)/ems/monitoring/page.tsx",
  },
  {
    id: "providers",
    label: "External providers",
    description: "Outsourced processes and contracted/external provider controls.",
    category: "operations",
    status: "available",
    href: "/ems/providers",
    pageFile: "src/app/(app)/ems/providers/page.tsx",
  },
  {
    id: "communications",
    label: "Communications",
    description: "Internal and external EMS communications.",
    category: "operations",
    status: "available",
    href: "/ems/communications",
    pageFile: "src/app/(app)/ems/communications/page.tsx",
  },
  {
    id: "emergency",
    label: "Emergency preparedness",
    description: "Emergency plans and recorded exercise outcomes.",
    category: "operations",
    status: "available",
    href: "/ems/emergency",
    pageFile: "src/app/(app)/ems/emergency/page.tsx",
  },

  // --- Legal & compliance (T40-T46) ---
  {
    id: "legal-provider-health",
    label: "Legal sync health",
    description: "Legislation source connection and sync status.",
    category: "legal",
    status: "available",
    href: "/ems/legal/provider-health",
    pageFile: "src/app/(app)/ems/legal/provider-health/page.tsx",
    permission: "ems.legal_source.manage",
  },
  {
    id: "legal-applicability",
    label: "Applicability workflow",
    description: "Assess and review which legal changes apply to this organisation.",
    category: "legal",
    status: "available",
    href: "/ems/legal/applicability",
    pageFile: "src/app/(app)/ems/legal/applicability/page.tsx",
  },
  {
    id: "legal-obligations",
    label: "Compliance obligations",
    description: "Versioned compliance obligations and their approval state.",
    category: "legal",
    status: "available",
    href: "/ems/legal/obligations",
    pageFile: "src/app/(app)/ems/legal/obligations/page.tsx",
  },
  {
    id: "legal-evaluations",
    label: "Compliance evaluations",
    description: "Recorded evaluations against compliance obligations.",
    category: "legal",
    status: "available",
    href: "/ems/legal/evaluations",
    pageFile: "src/app/(app)/ems/legal/evaluations/page.tsx",
  },
  {
    id: "legal-other-requirements",
    label: "Other requirements",
    description: "Non-legal commitments the organisation has chosen to comply with.",
    category: "legal",
    status: "available",
    href: "/ems/legal/other-requirements",
    pageFile: "src/app/(app)/ems/legal/other-requirements/page.tsx",
  },

  // --- Objectives & actions (T50-T52) ---
  {
    id: "objectives",
    label: "Objectives & metrics",
    description: "EMS objectives, metric definitions and progress reviews.",
    category: "objectives",
    status: "available",
    href: "/ems/objectives",
    pageFile: "src/app/(app)/ems/objectives/page.tsx",
  },
  {
    id: "actions",
    label: "Action programmes",
    description: "Actions and action programmes supporting objectives.",
    category: "objectives",
    status: "available",
    href: "/ems/actions",
    pageFile: "src/app/(app)/ems/actions/page.tsx",
  },

  // --- Audits, incidents, nonconformities (T60-T64) ---
  {
    id: "audits",
    label: "Audit programme",
    description: "Internal audit programme, checklists, findings and reports.",
    category: "assurance",
    status: "available",
    href: "/ems/audits",
    pageFile: "src/app/(app)/ems/audits/page.tsx",
  },
  {
    id: "incidents",
    label: "Environmental incidents",
    description: "Reported incidents and their assessment/management state.",
    category: "assurance",
    status: "available",
    href: "/ems/incidents",
    pageFile: "src/app/(app)/ems/incidents/page.tsx",
  },
  {
    id: "nonconformities",
    label: "Nonconformities & CAPA",
    description: "Nonconformities, root cause, corrective actions and effectiveness reviews.",
    category: "assurance",
    status: "available",
    href: "/ems/nonconformities",
    pageFile: "src/app/(app)/ems/nonconformities/page.tsx",
  },

  // --- Competence (T70-T71 — deferred to UI09/UI10) ---
  {
    id: "competence",
    label: "Competence & training",
    description: "Competence requirements, assignments, training evidence and expiry.",
    category: "people",
    status: "planned",
    plannedTask: "UI09",
  },

  // --- Management review (T72-T73 — deferred to UI11/UI12) ---
  {
    id: "management-review",
    label: "Management review",
    description: "Review cycle, agenda, pack, minutes and decisions.",
    category: "review",
    status: "planned",
    plannedTask: "UI11",
  },
];

export function isAvailable(entry: EmsModuleEntry): entry is AvailableEmsModule {
  return entry.status === "available";
}

/**
 * The modules a given membership may see, gated first on `ems.view` (whole
 * EMS surface) and then on each entry's own extra permission, if any. A
 * "planned" entry has no extra permission of its own today, so it is shown
 * to anyone with `ems.view` — the page just tells them it isn't built yet.
 */
export function getVisibleEmsModules(context: OrganisationContext): EmsModuleEntry[] {
  if (!hasPermission(context, "ems.view")) return [];
  return EMS_MODULES.filter((entry) => !entry.permission || hasPermission(context, entry.permission));
}
