/**
 * Cross-tenant adversarial suite (task T80,
 * Docs/PHASE8_HARDENING_READINESS_SPEC.md §3): the machine-readable
 * resource/endpoint registry the spec requires — "so adding a new
 * customer-owned route without an isolation test fails CI".
 *
 * Every customer-owned resource root reachable through a tenant repository
 * accessor (`findTenant*`, `requireTenant*`, `require*InScope`,
 * `getAuditEvent`, `findActiveTenantMembership`) is listed here, one entry
 * per exported function, across every repository module in
 * `src/lib/repositories/**`. The T34 monitoring/calibration resources are
 * registered separately (`contextShape: "service"`) because they were built
 * with inline tenant checks in their service module rather than a
 * `findTenant*` repository wrapper (see `monitoring-service.ts`,
 * `calibration-service.ts`) — the registry still names them so the same "no
 * resource escapes isolation testing" guarantee applies.
 *
 * `src/lib/security/__tests__/resource-endpoint-registry.test.ts` is the CI
 * gate: it parses each source module listed in `REGISTRY_SOURCE_MODULES`
 * for exported accessor functions and fails if any of them is missing from
 * this file, and fails again if a registered entry's function name does not
 * appear in its declared test file. Two ways to break CI, one way to fix
 * both: register the new resource here and give it a real negative test.
 */

export type ResourceContextShape =
  /** `(ctx: TenantRepositoryContext, id: string, expectedParentId?: string)` */
  | "tenant"
  /** `(context: OrganisationContext, id: string)` — combines RBAC scope with tenant ownership. */
  | "organisation"
  /** No single `findTenant*` wrapper; tenant checks are inline in the named service module/function(s). */
  | "service";

export interface ResourceEndpointEntry {
  /** Unique registry key, `<domain>.<resource>`. */
  key: string;
  /** Human label for reports/docs. */
  label: string;
  /** Implementation task this resource shipped in. */
  task: string;
  /** Source module the accessor function is exported from. */
  module: keyof typeof REGISTRY_SOURCE_MODULES;
  /** Exported function name inside that module. */
  fn: string;
  /** True when the function accepts an `expectedParentId` nested-parent-substitution guard. */
  hasParentGuard: boolean;
  /** Calling contract the function follows — see `ResourceContextShape`. */
  contextShape: ResourceContextShape;
  /** Repo-relative test file expected to exercise this function's cross-tenant denial. */
  testFile: string;
}

/**
 * Every module the completeness check parses for exported resource-accessor
 * functions. Path is repo-relative from the project root.
 */
export const REGISTRY_SOURCE_MODULES = {
  "ems-repository": "src/lib/repositories/ems-repository.ts",
  "carbon-repository": "src/lib/repositories/carbon-repository.ts",
  "lca-repository": "src/lib/repositories/lca-repository.ts",
  "documents-repository": "src/lib/repositories/documents-repository.ts",
  "notifications-repository": "src/lib/repositories/notifications-repository.ts",
  "audit-repository": "src/lib/repositories/audit-repository.ts",
  "storage-connection-repository": "src/lib/repositories/storage-connection-repository.ts",
} as const;

const EMS_TEST_FILE = "src/lib/repositories/__tests__/ems-repository.test.ts";

export const RESOURCE_ENDPOINT_REGISTRY: ResourceEndpointEntry[] = [
  // ---------------------------------------------------------------------
  // EMS programme foundation (T23)
  // ---------------------------------------------------------------------
  { key: "ems.emsProgramme", label: "EMS programme", task: "T23", module: "ems-repository", fn: "findTenantEmsProgramme", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emsScopeVersion", label: "EMS scope version", task: "T23", module: "ems-repository", fn: "findTenantEmsScopeVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.standardRequirementMap", label: "Standard requirement map", task: "T23", module: "ems-repository", fn: "findTenantStandardRequirementMap", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.contextIssue", label: "Context issue", task: "T23", module: "ems-repository", fn: "findTenantContextIssue", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.interestedParty", label: "Interested party", task: "T23", module: "ems-repository", fn: "findTenantInterestedParty", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.interestedPartyRequirement", label: "Interested party requirement", task: "T23", module: "ems-repository", fn: "findTenantInterestedPartyRequirement", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emsRiskOpportunity", label: "EMS risk/opportunity", task: "T23", module: "ems-repository", fn: "findTenantEmsRiskOpportunity", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.changeAssessment", label: "Change assessment", task: "T23", module: "ems-repository", fn: "findTenantChangeAssessment", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.environmentalPolicyRecord", label: "Environmental policy record", task: "T23", module: "ems-repository", fn: "findTenantEnvironmentalPolicyRecord", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Process/activity profiles (T30)
  // ---------------------------------------------------------------------
  { key: "ems.activityProcess", label: "Activity process", task: "T30", module: "ems-repository", fn: "findTenantActivityProcess", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Aspect/impact register (T31) and significance engine (T32)
  // ---------------------------------------------------------------------
  { key: "ems.environmentalAspect", label: "Environmental aspect", task: "T31", module: "ems-repository", fn: "findTenantEnvironmentalAspect", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.environmentalImpact", label: "Environmental impact", task: "T31", module: "ems-repository", fn: "findTenantEnvironmentalImpact", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.significanceMethod", label: "Significance method", task: "T32", module: "ems-repository", fn: "findTenantSignificanceMethod", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.aspectAssessment", label: "Aspect assessment", task: "T32", module: "ems-repository", fn: "findTenantAspectAssessment", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Operational controls (T33)
  // ---------------------------------------------------------------------
  { key: "ems.operationalControl", label: "Operational control", task: "T33", module: "ems-repository", fn: "findTenantOperationalControl", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.controlCheck", label: "Control check", task: "T33", module: "ems-repository", fn: "findTenantControlCheck", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Environmental monitoring and calibration (T34) — service-shaped, no
  // findTenant* wrapper. See monitoring-service.ts / calibration-service.ts.
  // ---------------------------------------------------------------------
  { key: "ems.monitoringPlan", label: "Monitoring plan", task: "T34", module: "ems-repository", fn: "monitoring-service:findVisiblePlan", hasParentGuard: false, contextShape: "service", testFile: "src/lib/ems/monitoring/__tests__/monitoring-tenant-isolation.test.ts" },
  { key: "ems.monitoringResult", label: "Monitoring result", task: "T34", module: "ems-repository", fn: "monitoring-service:findVisibleResult", hasParentGuard: false, contextShape: "service", testFile: "src/lib/ems/monitoring/__tests__/monitoring-tenant-isolation.test.ts" },
  { key: "ems.monitoringEquipment", label: "Monitoring equipment", task: "T34", module: "ems-repository", fn: "calibration-service:findVisibleEquipment", hasParentGuard: false, contextShape: "service", testFile: "src/lib/ems/monitoring/__tests__/monitoring-tenant-isolation.test.ts" },
  { key: "ems.equipmentCalibration", label: "Equipment calibration", task: "T34", module: "ems-repository", fn: "calibration-service:findVisibleCalibration", hasParentGuard: false, contextShape: "service", testFile: "src/lib/ems/monitoring/__tests__/monitoring-tenant-isolation.test.ts" },

  // ---------------------------------------------------------------------
  // External providers, communications, emergency preparedness (T35)
  // ---------------------------------------------------------------------
  { key: "ems.externalProviderControl", label: "External-provider control", task: "T35", module: "ems-repository", fn: "findTenantExternalProviderControl", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.externalProviderEvaluation", label: "External-provider evaluation", task: "T35", module: "ems-repository", fn: "findTenantExternalProviderEvaluation", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.communicationPlan", label: "Communication plan", task: "T35", module: "ems-repository", fn: "findTenantCommunicationPlan", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.communicationRecord", label: "Communication record", task: "T35", module: "ems-repository", fn: "findTenantCommunicationRecord", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emergencyScenario", label: "Emergency scenario", task: "T35", module: "ems-repository", fn: "findTenantEmergencyScenario", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emergencyPlan", label: "Emergency plan", task: "T35", module: "ems-repository", fn: "findTenantEmergencyPlan", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emergencyExercise", label: "Emergency exercise", task: "T35", module: "ems-repository", fn: "findTenantEmergencyExercise", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Legal register: applicability (T43), obligation versioning (T44),
  // compliance evaluation (T45), other requirements (T46)
  // ---------------------------------------------------------------------
  { key: "ems.applicabilityAssessment", label: "Applicability assessment", task: "T43", module: "ems-repository", fn: "findTenantApplicabilityAssessment", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.complianceObligation", label: "Compliance obligation", task: "T44", module: "ems-repository", fn: "findTenantComplianceObligation", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.complianceObligationVersion", label: "Compliance obligation version", task: "T44", module: "ems-repository", fn: "findTenantComplianceObligationVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.complianceEvaluationProgramme", label: "Compliance evaluation programme", task: "T45", module: "ems-repository", fn: "findTenantComplianceEvaluationProgramme", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.complianceEvaluation", label: "Compliance evaluation", task: "T45", module: "ems-repository", fn: "findTenantComplianceEvaluation", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.complianceEvaluationItem", label: "Compliance evaluation item", task: "T45", module: "ems-repository", fn: "findTenantComplianceEvaluationItem", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.otherRequirementSource", label: "Other requirement source", task: "T46", module: "ems-repository", fn: "findTenantOtherRequirementSource", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Objectives and metrics (T50), action programmes (T52)
  // ---------------------------------------------------------------------
  { key: "ems.environmentalObjective", label: "Environmental objective", task: "T50", module: "ems-repository", fn: "findTenantEnvironmentalObjective", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.environmentalObjectiveVersion", label: "Environmental objective version", task: "T50", module: "ems-repository", fn: "findTenantEnvironmentalObjectiveVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.objectiveMetricDefinition", label: "Objective metric definition", task: "T50", module: "ems-repository", fn: "findTenantObjectiveMetricDefinition", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.objectiveMetricVersion", label: "Objective metric version", task: "T50", module: "ems-repository", fn: "findTenantObjectiveMetricVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.actionProgramme", label: "Action programme", task: "T52", module: "ems-repository", fn: "findTenantActionProgramme", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.actionItem", label: "Action item", task: "T52", module: "ems-repository", fn: "findTenantActionItem", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Audit programme and execution (T60), checklists/findings/report (T61)
  // ---------------------------------------------------------------------
  { key: "ems.auditProgramme", label: "Audit programme", task: "T60", module: "ems-repository", fn: "findTenantAuditProgramme", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditProgrammeItem", label: "Audit programme item", task: "T60", module: "ems-repository", fn: "findTenantAuditProgrammeItem", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.emsAudit", label: "Planned audit", task: "T60", module: "ems-repository", fn: "findTenantEmsAudit", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditTeamMember", label: "Audit team member", task: "T60", module: "ems-repository", fn: "findTenantAuditTeamMember", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditChecklistVersion", label: "Audit checklist version", task: "T61", module: "ems-repository", fn: "findTenantAuditChecklistVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditChecklistItem", label: "Audit checklist item", task: "T61", module: "ems-repository", fn: "findTenantAuditChecklistItem", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditQuestionResponse", label: "Audit question response", task: "T61", module: "ems-repository", fn: "findTenantAuditQuestionResponse", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditFinding", label: "Audit finding", task: "T61", module: "ems-repository", fn: "findTenantAuditFinding", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.auditReportRevision", label: "Audit report revision", task: "T61", module: "ems-repository", fn: "findTenantAuditReportRevision", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Environmental incident intake (T62)
  // ---------------------------------------------------------------------
  { key: "ems.incidentSeverityLevel", label: "Incident severity level", task: "T62", module: "ems-repository", fn: "findTenantIncidentSeverityLevel", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.environmentalIncident", label: "Environmental incident", task: "T62", module: "ems-repository", fn: "findTenantEnvironmentalIncident", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.incidentCorrection", label: "Incident correction", task: "T62", module: "ems-repository", fn: "findTenantIncidentCorrection", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.incidentNotificationAssessment", label: "Incident notification assessment", task: "T62", module: "ems-repository", fn: "findTenantIncidentNotificationAssessment", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Nonconformity workflow (T63), root cause/CAPA (T64)
  // ---------------------------------------------------------------------
  { key: "ems.nonconformityClassification", label: "Nonconformity classification", task: "T63", module: "ems-repository", fn: "findTenantNonconformityClassification", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.nonconformity", label: "Nonconformity", task: "T63", module: "ems-repository", fn: "findTenantNonconformity", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.containmentRecord", label: "Containment record", task: "T63", module: "ems-repository", fn: "findTenantContainmentRecord", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.rootCauseAnalysis", label: "Root cause analysis", task: "T64", module: "ems-repository", fn: "findTenantRootCauseAnalysis", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.correctiveAction", label: "Corrective action", task: "T64", module: "ems-repository", fn: "findTenantCorrectiveAction", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.effectivenessReview", label: "Effectiveness review", task: "T64", module: "ems-repository", fn: "findTenantEffectivenessReview", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Competence requirements and assignments (T70), evidence/assessment (T71)
  // ---------------------------------------------------------------------
  { key: "ems.personProfile", label: "Person profile", task: "T70", module: "ems-repository", fn: "findTenantPersonProfile", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.competenceRequirement", label: "Competence requirement", task: "T70", module: "ems-repository", fn: "findTenantCompetenceRequirement", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.competenceRequirementVersion", label: "Competence requirement version", task: "T70", module: "ems-repository", fn: "findTenantCompetenceRequirementVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.competenceAssignment", label: "Competence assignment", task: "T70", module: "ems-repository", fn: "findTenantCompetenceAssignment", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.competenceEvidence", label: "Competence evidence", task: "T71", module: "ems-repository", fn: "findTenantCompetenceEvidence", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.competenceAssessment", label: "Competence assessment", task: "T71", module: "ems-repository", fn: "findTenantCompetenceAssessment", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Management review agenda (T72), review pack/decisions/minutes (T73)
  // ---------------------------------------------------------------------
  { key: "ems.managementReviewAgendaTemplate", label: "Management review agenda template", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewAgendaTemplate", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewAgendaTemplateVersion", label: "Management review agenda template version", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewAgendaTemplateVersion", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewAgendaItemDefinition", label: "Management review agenda item definition", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewAgendaItemDefinition", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewInputDefinition", label: "Management review input definition", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewInputDefinition", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReview", label: "Management review", task: "T72", module: "ems-repository", fn: "findTenantManagementReview", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewAttendee", label: "Management review attendee", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewAttendee", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewInputLink", label: "Management review input link", task: "T72", module: "ems-repository", fn: "findTenantManagementReviewInputLink", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewPack", label: "Management review pack", task: "T73", module: "ems-repository", fn: "findTenantManagementReviewPack", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewPackByReviewId", label: "Management review pack (by review)", task: "T73", module: "ems-repository", fn: "findTenantManagementReviewPackByReviewId", hasParentGuard: false, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewAiNarrative", label: "Management review AI narrative", task: "T73", module: "ems-repository", fn: "findTenantManagementReviewAiNarrative", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewDecision", label: "Management review decision", task: "T73", module: "ems-repository", fn: "findTenantManagementReviewDecision", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },
  { key: "ems.managementReviewMinuteRevision", label: "Management review minute revision", task: "T73", module: "ems-repository", fn: "findTenantManagementReviewMinuteRevision", hasParentGuard: true, contextShape: "tenant", testFile: EMS_TEST_FILE },

  // ---------------------------------------------------------------------
  // Corporate carbon domain (T16)
  // ---------------------------------------------------------------------
  { key: "carbon.entity", label: "Entity", task: "T16", module: "carbon-repository", fn: "requireEntityInScope", hasParentGuard: false, contextShape: "organisation", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.site", label: "Site", task: "T16", module: "carbon-repository", fn: "requireSiteInScope", hasParentGuard: false, contextShape: "organisation", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.activityEntry", label: "Activity entry", task: "T16", module: "carbon-repository", fn: "findTenantActivityEntry", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.calculation", label: "Calculation", task: "T16", module: "carbon-repository", fn: "findTenantCalculation", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.reportSnapshot", label: "Report snapshot", task: "T16", module: "carbon-repository", fn: "findTenantReportSnapshot", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.sourceDocument", label: "Source document", task: "T16", module: "carbon-repository", fn: "findTenantSourceDocument", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },
  { key: "carbon.documentExtraction", label: "Document extraction", task: "T16", module: "carbon-repository", fn: "findTenantDocumentExtraction", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/carbon-repository.test.ts" },

  // ---------------------------------------------------------------------
  // Product LCA domain (T17)
  // ---------------------------------------------------------------------
  { key: "lca.assessment", label: "LCA assessment", task: "T17", module: "lca-repository", fn: "requireAssessmentInScope", hasParentGuard: false, contextShape: "organisation", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.product", label: "Product", task: "T17", module: "lca-repository", fn: "requireProductInScope", hasParentGuard: false, contextShape: "organisation", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.supplier", label: "Supplier", task: "T17", module: "lca-repository", fn: "requireSupplierInScope", hasParentGuard: false, contextShape: "organisation", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.evidence", label: "LCA evidence", task: "T17", module: "lca-repository", fn: "findTenantEvidence", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.evidenceBlob", label: "LCA evidence blob", task: "T17", module: "lca-repository", fn: "findTenantEvidenceBlob", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.assessmentVersion", label: "LCA assessment version", task: "T17", module: "lca-repository", fn: "findTenantAssessmentVersion", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.supplierPcf", label: "Supplier PCF", task: "T17", module: "lca-repository", fn: "findTenantSupplierPcf", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.process", label: "LCA process", task: "T17", module: "lca-repository", fn: "findTenantProcess", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.inventoryItem", label: "LCA inventory item", task: "T17", module: "lca-repository", fn: "findTenantInventoryItem", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.run", label: "LCA calculation run", task: "T17", module: "lca-repository", fn: "findTenantRun", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },
  { key: "lca.result", label: "LCA calculation result", task: "T17", module: "lca-repository", fn: "findTenantResult", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/lca-repository.test.ts" },

  // ---------------------------------------------------------------------
  // Controlled documents / shared evidence (T22)
  // ---------------------------------------------------------------------
  { key: "documents.controlledDocument", label: "Controlled document", task: "T22", module: "documents-repository", fn: "findTenantControlledDocument", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/documents-repository.test.ts" },
  { key: "documents.controlledDocumentRevision", label: "Controlled document revision", task: "T22", module: "documents-repository", fn: "findTenantControlledDocumentRevision", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/documents-repository.test.ts" },
  { key: "documents.evidenceObject", label: "Evidence object", task: "T22", module: "documents-repository", fn: "findTenantEvidenceObject", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/documents-repository.test.ts" },
  { key: "documents.evidenceLink", label: "Evidence link", task: "T22", module: "documents-repository", fn: "findTenantEvidenceLink", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/documents-repository.test.ts" },

  // ---------------------------------------------------------------------
  // Notifications and reminders (T24)
  // ---------------------------------------------------------------------
  { key: "notifications.notification", label: "Notification", task: "T24", module: "notifications-repository", fn: "findTenantNotification", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/notifications-repository.test.ts" },
  { key: "notifications.reminderRule", label: "Reminder rule", task: "T24", module: "notifications-repository", fn: "findTenantReminderRule", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/notifications-repository.test.ts" },
  { key: "notifications.activeMembership", label: "Active tenant membership (recipient resolution)", task: "T24", module: "notifications-repository", fn: "findActiveTenantMembership", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/notifications-repository.test.ts" },

  // ---------------------------------------------------------------------
  // Generic audit events (T20)
  // ---------------------------------------------------------------------
  { key: "audit.auditEvent", label: "Audit event", task: "T20", module: "audit-repository", fn: "getAuditEvent", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/audit-repository.test.ts" },

  // ---------------------------------------------------------------------
  // SharePoint storage connection / external-file references (SP01)
  // ---------------------------------------------------------------------
  { key: "storage.organisationStorageConnection", label: "Organisation storage connection", task: "SP01", module: "storage-connection-repository", fn: "findTenantStorageConnection", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/storage-connection-repository.test.ts" },
  { key: "storage.storageSiteBinding", label: "Storage site binding", task: "SP01", module: "storage-connection-repository", fn: "findTenantSiteBinding", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/storage-connection-repository.test.ts" },
  { key: "storage.externalFileReference", label: "External file reference", task: "SP01", module: "storage-connection-repository", fn: "findTenantExternalFileReference", hasParentGuard: true, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/storage-connection-repository.test.ts" },
  { key: "storage.externalFileReferenceForRevision", label: "External file reference (by controlled-document revision)", task: "SP04", module: "storage-connection-repository", fn: "findTenantExternalFileReferenceForRevision", hasParentGuard: false, contextShape: "tenant", testFile: "src/lib/repositories/__tests__/storage-connection-repository.test.ts" },
];

/** Every registered key must be unique — guards the registry itself against a copy/paste duplicate. */
export function assertRegistryKeysUnique(entries: ResourceEndpointEntry[] = RESOURCE_ENDPOINT_REGISTRY): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      throw new Error(`Duplicate resource-endpoint registry key: ${entry.key}`);
    }
    seen.add(entry.key);
  }
}
