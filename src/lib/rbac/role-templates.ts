/**
 * Phase 1 RBAC (T11) system role templates — PHASE1_TENANCY_RBAC_SPEC.md §6.
 *
 * These are the six default templates cloned into an Organisation's own
 * `RoleDefinition` rows at provisioning time (T12 backfill / T13 onboarding),
 * per spec §1.6: role assignments always point to an organisation-owned copy,
 * never a shared mutable template. "Scoped"/"Restricted" cells in the spec
 * table grant the same permission codes as the unscoped equivalent — the
 * restriction comes from the membership's `MembershipEntityScope` /
 * `MembershipSiteScope` rows, not from a different permission set.
 *
 * The spec table is a compressed summary, not a literal per-code list, so a
 * few cells required a judgment call. Recorded here (and repeated in the T11
 * task report as owner decisions) rather than left implicit:
 *
 *  - "X if assigned/if granted" (Compliance evaluation + Competence for
 *    Auditor): read as fully conditional, so NOT granted by default.
 *  - "Perform/issue if granted" (Audit programme/report for Auditor): only
 *    the second clause is conditional, so `ems.audit.perform` is granted by
 *    default and `ems.audit_report.issue` is withheld.
 *  - "Contribute" (Management review for EMS Contributor / Site Manager) and
 *    "Metadata only" (Competence for Organisation Administrator): the
 *    catalogue has no permission code at that granularity, so neither is
 *    granted; contribution happens through other already-granted edit
 *    permissions.
 *  - "Findings only" (Incidents/NC/CAPA for Auditor): no matching code;
 *    left ungranted.
 *  - The `ai.*` domain and the platform `audit.view`/`audit.export` domain
 *    are not covered by the spec §6 table at all. T11 left `ai.*` ungranted
 *    for every template pending a dedicated AI-governance decision; T18 (the
 *    task that first makes AI actually organisation-scoped and enforces
 *    these codes at runtime) makes that decision explicit rather than
 *    leaving every template permanently locked out of AI once enforcement
 *    exists: `ai.use` is granted to every template, preserving the AI
 *    layer's pre-T18 behaviour where any signed-in member could use it
 *    (scope was previously enforced only by Entity/Site, never by a
 *    permission code); `ai.settings.manage` and `ai.audit.view` are granted
 *    only to Sustainability Lead and Organisation Administrator, mirroring
 *    the "admin status does not imply platform-global access" rule — this is
 *    still an organisation-scoped grant, not platform admin. Flagged as an
 *    owner decision in the T18 report; revisit if product wants finer-grained
 *    AI governance later. `audit.view` (the platform's own RBAC/change audit trail,
 *    distinct from the EMS audit programme) is given to Sustainability Lead
 *    and Organisation Administrator only, as the two oversight roles;
 *    `audit.export` is withheld from every template as sensitive.
 *  - "Carbon entry/manage" marks EMS Contributor identically to
 *    Sustainability Lead (both "✓"), which is taken at face value and
 *    includes `carbon.entry.approve` for both — unlike the LCA and
 *    compliance-obligation rows, this table has no separate "approve" row
 *    to withhold. Worth confirming with the product owner given the
 *    maker-checker pattern used elsewhere (LCA versions, compliance
 *    obligations).
 *  - T35 (external providers/communications/emergency preparedness) added
 *    three permission codes at T31 catalogue time that no template granted
 *    yet: `ems.communication.manage`, `ems.emergency_plan.manage`,
 *    `ems.emergency_exercise.record`. Following the same "manage vs
 *    contribute" split used for EMS_ASPECTS_EDIT/EMS_ASPECTS_APPROVE, the
 *    two "manage" codes (communications, plans) are granted only to
 *    Sustainability Lead; `ems.emergency_exercise.record` — day-to-day
 *    drill recording — is also granted to EMS Contributor and Site Manager.
 *    Provider controls reuse `ems.control.manage` per Phase 3 spec §4, so no
 *    new code or template change was needed for that part. Flagged here as
 *    an owner decision to confirm, same as the AI-governance note above.
 */

// Type-only: RoleTemplateKey is never read as a runtime value in this file —
// each templateKey below is the enum's own string literal, checked against
// the type by tsc, so this has no runtime dependency on @prisma/client's
// generated enum object (see organisation-backfill.ts for the matching fix).
import type { RoleTemplateKey } from "@prisma/client";

export interface RoleTemplateDefinition {
  templateKey: RoleTemplateKey;
  name: string;
  description: string;
  permissionCodes: string[];
}

const ORG_VIEW = ["organisation.view", "organisation.membership.view", "organisation.role.view"];
const ORG_MANAGE = [...ORG_VIEW, "organisation.settings.manage", "organisation.membership.manage", "organisation.role.manage", "organisation.access_review.manage"];

const CARBON_ENTRY_FULL = ["carbon.entry.create", "carbon.entry.review", "carbon.entry.approve", "carbon.contract.manage", "carbon.document.manage"];
const CARBON_REPORT_FULL = ["carbon.report.generate", "carbon.report.export", "carbon.factor.view"];
const CARBON_REPORT_VIEW = ["carbon.factor.view"];

const LCA_EDIT_FULL = ["lca.view", "lca.product.manage", "lca.assessment.edit", "lca.assessment.calculate", "lca.supplier.manage", "lca.evidence.manage"];
const LCA_APPROVE_FULL = ["lca.assessment.approve", "lca.version.issue", "lca.verification.record", "lca.methodology.manage", "lca.export"];

const EMS_PROGRAMME_MANAGE = ["ems.programme.manage", "ems.context.manage", "ems.policy.manage"];
const EMS_ASPECTS_EDIT = ["ems.aspect.edit", "ems.control.manage", "ems.monitoring.record"];
const EMS_ASPECTS_APPROVE = ["ems.aspect.approve", "ems.monitoring.review"];
const EMS_APPLICABILITY_ASSESS = ["ems.applicability.assess", "ems.legal_source.manage"];
const EMS_APPLICABILITY_REVIEW = ["ems.applicability.review"];
const EMS_OBJECTIVES_MANAGE = ["ems.objective.manage", "ems.action.manage"];
const EMS_INCIDENT_WORK = ["ems.incident.report", "ems.nonconformity.manage", "ems.corrective_action.manage"];
const EMS_INCIDENT_MANAGE = [...EMS_INCIDENT_WORK, "ems.incident.manage", "ems.corrective_action.effectiveness_review"];
const EMS_AUDIT_MANAGE = ["ems.audit_programme.manage", "ems.audit.perform", "ems.audit_report.issue"];
const EMS_DOCUMENT_MANAGE = ["ems.controlled_document.manage"];
// T35: provider controls reuse ems.control.manage per Phase 3 spec §4 — no
// separate provider permission code exists.
const EMS_COMMUNICATIONS_EMERGENCY_MANAGE = ["ems.communication.manage", "ems.emergency_plan.manage", "ems.emergency_exercise.record"];

export const SYSTEM_ROLE_TEMPLATES: RoleTemplateDefinition[] = [
  {
    templateKey: "SUSTAINABILITY_LEAD",
    name: "Sustainability Lead",
    description: "Full EMS and carbon/LCA authority; the only default approver of compliance obligations.",
    permissionCodes: [
      ...ORG_VIEW,
      "carbon.view",
      ...CARBON_ENTRY_FULL,
      ...CARBON_REPORT_FULL,
      ...LCA_EDIT_FULL,
      ...LCA_APPROVE_FULL,
      "ems.view",
      ...EMS_PROGRAMME_MANAGE,
      ...EMS_ASPECTS_EDIT,
      ...EMS_ASPECTS_APPROVE,
      ...EMS_APPLICABILITY_ASSESS,
      ...EMS_APPLICABILITY_REVIEW,
      "ems.compliance_obligation.edit",
      "ems.compliance_obligation.approve",
      "ems.compliance_evaluation.perform",
      ...EMS_OBJECTIVES_MANAGE,
      "ems.objective.approve",
      ...EMS_AUDIT_MANAGE,
      ...EMS_INCIDENT_MANAGE,
      "ems.competence.view",
      "ems.competence.manage",
      "ems.management_review.manage",
      "ems.management_review.approve",
      ...EMS_DOCUMENT_MANAGE,
      "ems.controlled_document.approve",
      ...EMS_COMMUNICATIONS_EMERGENCY_MANAGE,
      "ems.notification.manage",
      "audit.view",
      "ai.use",
      "ai.settings.manage",
      "ai.audit.view",
    ],
  },
  {
    templateKey: "EMS_CONTRIBUTOR",
    name: "EMS Contributor",
    description: "Does the day-to-day carbon, LCA, and EMS work without approval or role authority.",
    permissionCodes: [
      "carbon.view",
      ...CARBON_ENTRY_FULL,
      ...LCA_EDIT_FULL,
      "ems.view",
      ...EMS_PROGRAMME_MANAGE,
      ...EMS_ASPECTS_EDIT,
      ...EMS_APPLICABILITY_ASSESS,
      "ems.compliance_obligation.edit",
      "ems.compliance_evaluation.perform",
      ...EMS_OBJECTIVES_MANAGE,
      ...EMS_INCIDENT_WORK,
      "ems.competence.view",
      ...EMS_DOCUMENT_MANAGE,
      "ems.emergency_exercise.record",
      "ems.notification.manage",
      "ai.use",
    ],
  },
  {
    templateKey: "SITE_MANAGER",
    name: "Site Manager",
    description: "Same working permissions as EMS Contributor, intended for a RESTRICTED membership scoped to specific entities/sites.",
    permissionCodes: [
      "carbon.view",
      ...CARBON_ENTRY_FULL,
      ...CARBON_REPORT_VIEW,
      ...LCA_EDIT_FULL,
      "ems.view",
      ...EMS_PROGRAMME_MANAGE,
      ...EMS_ASPECTS_EDIT,
      ...EMS_APPLICABILITY_ASSESS,
      "ems.compliance_obligation.edit",
      "ems.compliance_evaluation.perform",
      ...EMS_OBJECTIVES_MANAGE,
      ...EMS_INCIDENT_WORK,
      "ems.competence.view",
      ...EMS_DOCUMENT_MANAGE,
      "ems.emergency_exercise.record",
      "ai.use",
    ],
  },
  {
    templateKey: "AUDITOR",
    name: "Auditor",
    description: "Read access plus the ability to perform internal audits; cannot issue audit reports or approve anything by default.",
    permissionCodes: [
      "carbon.view",
      ...CARBON_REPORT_VIEW,
      "ems.view",
      "ems.audit.perform",
      "ai.use",
    ],
  },
  {
    templateKey: "FINANCE_READ_ONLY",
    name: "Finance (read-only)",
    description: "Read-only across carbon/EMS, plus the ability to generate and export carbon reports for financial reporting.",
    permissionCodes: [
      "carbon.view",
      ...CARBON_REPORT_FULL,
      "ems.view",
      "ai.use",
    ],
  },
  {
    templateKey: "ORGANISATION_ADMINISTRATOR",
    name: "Organisation Administrator",
    description: "Manages organisation, membership, and role configuration. Does NOT get compliance-obligation approval or LCA approve/issue by default.",
    permissionCodes: [
      ...ORG_MANAGE,
      "carbon.view",
      ...CARBON_ENTRY_FULL,
      ...CARBON_REPORT_FULL,
      ...LCA_EDIT_FULL,
      "ems.view",
      "audit.view",
      "ai.use",
      "ai.settings.manage",
      "ai.audit.view",
    ],
  },
];

export function getRoleTemplate(templateKey: RoleTemplateKey): RoleTemplateDefinition {
  const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.templateKey === templateKey);
  if (!template) {
    throw new Error(`No system role template registered for ${templateKey}`);
  }
  return template;
}
