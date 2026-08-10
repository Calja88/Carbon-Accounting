/**
 * Phase 1 RBAC (T11) permission catalogue — PHASE1_TENANCY_RBAC_SPEC.md §5.
 *
 * Codes are stable API identifiers seeded into `PermissionDefinition`. They
 * are never reused or renamed once shipped; only the `description` label may
 * change. `isSensitive` follows the spec note under the catalogue: role
 * administration, compliance/audit/management-review approval steps,
 * corrective-action effectiveness review, exports, and management-level
 * competence/incident access are marked sensitive.
 */

export interface PermissionCatalogueEntry {
  code: string;
  domain: string;
  description: string;
  isSensitive: boolean;
}

function entry(
  code: string,
  description: string,
  isSensitive = false,
): PermissionCatalogueEntry {
  return { code, domain: code.split(".")[0], description, isSensitive };
}

export const PERMISSION_CATALOGUE: PermissionCatalogueEntry[] = [
  // --- Organisation administration ---
  entry("organisation.view", "View organisation profile and settings"),
  entry("organisation.settings.manage", "Change organisation settings"),
  entry("organisation.membership.view", "View organisation members"),
  entry("organisation.membership.manage", "Invite, suspend, or remove members"),
  entry("organisation.role.view", "View role definitions and grants"),
  entry("organisation.role.manage", "Create, edit, or assign roles and permissions", true),
  entry("organisation.access_review.manage", "Run and record periodic access reviews"),

  // --- Corporate carbon ---
  entry("carbon.view", "View corporate carbon activity data and calculations"),
  entry("carbon.entry.create", "Create activity data entries"),
  entry("carbon.entry.review", "Review submitted activity data entries"),
  entry("carbon.entry.approve", "Approve activity data entries"),
  entry("carbon.contract.manage", "Manage site energy contracts"),
  entry("carbon.document.manage", "Manage evidence documents for carbon entries"),
  entry("carbon.report.generate", "Generate carbon report snapshots"),
  entry("carbon.report.export", "Export carbon reports", true),
  entry("carbon.factor.view", "View the emission factor library"),
  entry("carbon.factor.manage", "Import or manage emission factor sets"),

  // --- Product LCA / PCF ---
  entry("lca.view", "View product LCA assessments and results"),
  entry("lca.product.manage", "Create or edit products and manufacturing locations"),
  entry("lca.assessment.edit", "Edit an open LCA assessment"),
  entry("lca.assessment.calculate", "Run LCA calculations"),
  entry("lca.assessment.approve", "Approve an LCA assessment"),
  entry("lca.version.issue", "Issue an immutable LCA assessment version"),
  entry("lca.verification.record", "Record third-party verification of an LCA result"),
  entry("lca.methodology.manage", "Manage LCA methodology profiles"),
  entry("lca.supplier.manage", "Manage suppliers and supplier PCF records"),
  entry("lca.evidence.manage", "Manage LCA evidence attachments"),
  entry("lca.export", "Export LCA results and reports", true),

  // --- AI layer ---
  entry("ai.use", "Use AI suggestion/summarisation features"),
  entry("ai.settings.manage", "Configure AI provider settings and task models"),
  entry("ai.audit.view", "View the AI interaction and suggestion audit trail"),

  // --- EMS (ISO 14001) ---
  entry("ems.view", "View EMS programme content"),
  entry("ems.programme.manage", "Manage the EMS programme definition"),
  entry("ems.context.manage", "Manage organisational context records"),
  entry("ems.policy.manage", "Manage the environmental policy"),
  entry("ems.aspect.edit", "Edit environmental aspects and impacts"),
  entry("ems.aspect.approve", "Approve environmental aspect significance ratings"),
  entry("ems.control.manage", "Manage operational controls"),
  entry("ems.monitoring.record", "Record monitoring and measurement results"),
  entry("ems.monitoring.review", "Review recorded monitoring results"),
  entry("ems.legal_source.manage", "Manage legal/compliance register sources"),
  entry("ems.applicability.assess", "Assess legal applicability"),
  entry("ems.applicability.review", "Review legal applicability assessments"),
  entry("ems.compliance_obligation.edit", "Edit a compliance obligation draft"),
  entry("ems.compliance_obligation.approve", "Approve a compliance obligation", true),
  entry("ems.compliance_evaluation.perform", "Perform a compliance evaluation"),
  entry("ems.objective.manage", "Manage EMS objectives"),
  entry("ems.action.manage", "Manage EMS actions"),
  entry("ems.audit_programme.manage", "Manage the internal audit programme"),
  entry("ems.audit.perform", "Perform an internal audit"),
  entry("ems.audit_report.issue", "Issue an internal audit report", true),
  entry("ems.incident.report", "Report an environmental incident"),
  entry("ems.incident.manage", "Manage and close out incident records", true),
  entry("ems.nonconformity.manage", "Manage nonconformity records"),
  entry("ems.corrective_action.manage", "Manage corrective actions"),
  entry("ems.corrective_action.effectiveness_review", "Review corrective action effectiveness", true),
  entry("ems.competence.view", "View competence records"),
  entry("ems.competence.manage", "Manage competence records and evidence", true),
  entry("ems.management_review.manage", "Prepare and manage management review inputs"),
  entry("ems.management_review.approve", "Approve management review outputs", true),
  entry("ems.controlled_document.manage", "Manage controlled documents"),
  entry("ems.communication.manage", "Manage internal/external EMS communications"),
  entry("ems.emergency_plan.manage", "Manage emergency preparedness plans"),
  entry("ems.emergency_exercise.record", "Record emergency exercise outcomes"),
  entry("ems.export", "Export EMS records", true),

  // --- Platform audit trail ---
  entry("audit.view", "View the platform audit trail"),
  entry("audit.export", "Export the platform audit trail", true),
];

export const PERMISSION_CODES = PERMISSION_CATALOGUE.map((p) => p.code);

const codeSet = new Set(PERMISSION_CODES);

export function isKnownPermissionCode(code: string): boolean {
  return codeSet.has(code);
}
