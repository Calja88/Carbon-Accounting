/**
 * UI13 — EMS dashboard, reporting and leadership-overview read model
 * (Docs/SHAREPOINT_AND_EMS_UI_CLAUDE_DELIVERY_PACK.md, "UI13 - EMS dashboard
 * and reporting entry points").
 *
 * Deliberately a thin composition layer: every figure here comes from an
 * existing tenant-scoped, permission-checked list/report read already used
 * by its own module page (UI06-UI12). This module adds no new Prisma
 * queries, no new domain state, and no second calculation system — it only
 * groups/counts rows those reads already return, and skips a section
 * entirely (rather than guessing) when the caller lacks the permission the
 * underlying read requires, or when no organisation-wide read exists yet
 * for that figure (e.g. cross-audit findings, cross-nonconformity CAPA
 * effectiveness — both are scoped per-parent-record upstream).
 */

import type { OrganisationContext } from "@/lib/organisation/context";
import { hasPermission } from "@/lib/rbac/authorize";
import { listOverdueOrUnevaluatedObligations } from "@/lib/ems/legal/evaluation-service";
import { listSignificantAspectControlGaps } from "@/lib/ems/controls/control-service";
import { listActionDashboard } from "@/lib/ems/actions/action-service";
import { listEmsAudits } from "@/lib/ems/audits/audit-service";
import { listNonconformities } from "@/lib/ems/nonconformity/nonconformity-service";
import { listEnvironmentalIncidents } from "@/lib/ems/incidents/incident-service";
import { listCompetenceGaps } from "@/lib/ems/competence/gap-service";
import { listCompetenceAssignments } from "@/lib/ems/competence/assignment-service";
import { listManagementReviews } from "@/lib/ems/review/review-service";
import { listOpenPriorActions } from "@/lib/ems/review/review-service";
import { listManagementReviewDecisions } from "@/lib/ems/review/minutes-service";
import { listControlledDocuments } from "@/lib/documents/document-control-service";
import { listEvidenceObjects, activeEvidenceStorageProviderName } from "@/lib/documents/evidence-service";
import { listMyNotifications } from "@/lib/notifications/notification-service";

/** A dashboard section either has a figure, or names why it doesn't. */
export type DashboardSection<T> =
  | { available: true; data: T }
  | { available: false; reason: "NO_PERMISSION" | "NO_DATA" };

const unavailable = (reason: "NO_PERMISSION" | "NO_DATA"): DashboardSection<never> => ({ available: false, reason });
const available = <T,>(data: T): DashboardSection<T> => ({ available: true, data });

export interface ComplianceSummary {
  overdueOrUnevaluatedCount: number;
}

export interface AspectsSummary {
  controlGapCount: number;
}

export interface ObjectivesSummary {
  openActionCount: number;
  overdueActionCount: number;
}

export interface AuditsSummary {
  byStatus: Partial<Record<string, number>>;
  totalAudits: number;
}

export interface NonconformitiesSummary {
  openCount: number;
  byStatus: Partial<Record<string, number>>;
}

export interface IncidentsSummary {
  openCount: number;
  byStatus: Partial<Record<string, number>>;
  last90DaysCount: number;
}

export interface CompetenceSummary {
  gapCount: number;
  overdueCount: number;
  expiredCount: number;
  expiringWithin60DaysCount: number;
}

export interface ManagementReviewSummary {
  latestStatus: string | null;
  latestScheduledDate: Date | null;
  openPriorActionCount: number | null;
  latestDecisionCount: number | null;
}

export interface DocumentsSummary {
  totalControlled: number;
  effectiveCount: number;
  inReviewOrDraftCount: number;
  evidenceObjectCount: number;
  activeStorageProvider: string;
}

export interface NotificationsSummary {
  pendingCount: number;
}

export interface EmsDashboardSummary {
  compliance: DashboardSection<ComplianceSummary>;
  aspects: DashboardSection<AspectsSummary>;
  objectives: DashboardSection<ObjectivesSummary>;
  audits: DashboardSection<AuditsSummary>;
  nonconformities: DashboardSection<NonconformitiesSummary>;
  incidents: DashboardSection<IncidentsSummary>;
  competence: DashboardSection<CompetenceSummary>;
  managementReview: DashboardSection<ManagementReviewSummary>;
  documents: DashboardSection<DocumentsSummary>;
  notifications: DashboardSection<NotificationsSummary>;
}

const CLOSED_NC_STATUSES = new Set(["CLOSED"]);
const CLOSED_INCIDENT_STATUSES = new Set(["CLOSED"]);

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/**
 * Tenant-scoped EMS leadership/reporting summary. Every underlying read is
 * itself permission-checked and organisation-scoped; this function only
 * decides, ahead of calling, whether the caller's membership holds the
 * permission that read requires, so a restricted user sees fewer sections
 * rather than a thrown error.
 */
export async function getEmsDashboardSummary(context: OrganisationContext): Promise<EmsDashboardSummary> {
  const canView = hasPermission(context, "ems.view");
  const canViewCompetence = hasPermission(context, "ems.competence.view");

  const [
    compliance,
    aspects,
    objectives,
    audits,
    nonconformities,
    incidents,
    competence,
    managementReview,
    documents,
    notifications,
  ] = await Promise.all([
    canView ? loadCompliance(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadAspects(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadObjectives(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadAudits(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadNonconformities(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadIncidents(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canViewCompetence ? loadCompetence(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadManagementReview(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadDocuments(context) : Promise.resolve(unavailable("NO_PERMISSION")),
    canView ? loadNotifications(context) : Promise.resolve(unavailable("NO_PERMISSION")),
  ]);

  return { compliance, aspects, objectives, audits, nonconformities, incidents, competence, managementReview, documents, notifications };
}

async function loadCompliance(context: OrganisationContext): Promise<DashboardSection<ComplianceSummary>> {
  const rows = await listOverdueOrUnevaluatedObligations(context);
  return available({ overdueOrUnevaluatedCount: rows.length });
}

async function loadAspects(context: OrganisationContext): Promise<DashboardSection<AspectsSummary>> {
  const rows = await listSignificantAspectControlGaps(context);
  return available({ controlGapCount: rows.length });
}

async function loadObjectives(context: OrganisationContext): Promise<DashboardSection<ObjectivesSummary>> {
  const rows = await listActionDashboard(context);
  return available({
    openActionCount: rows.length,
    overdueActionCount: rows.filter((row) => row.overdue).length,
  });
}

async function loadAudits(context: OrganisationContext): Promise<DashboardSection<AuditsSummary>> {
  const rows = await listEmsAudits(context);
  return available({ byStatus: countBy(rows.map((row) => row.status)), totalAudits: rows.length });
}

async function loadNonconformities(context: OrganisationContext): Promise<DashboardSection<NonconformitiesSummary>> {
  const rows = await listNonconformities(context);
  return available({
    openCount: rows.filter((row) => !CLOSED_NC_STATUSES.has(row.status)).length,
    byStatus: countBy(rows.map((row) => row.status)),
  });
}

async function loadIncidents(context: OrganisationContext): Promise<DashboardSection<IncidentsSummary>> {
  const rows = await listEnvironmentalIncidents(context);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return available({
    openCount: rows.filter((row) => !CLOSED_INCIDENT_STATUSES.has(row.status)).length,
    byStatus: countBy(rows.map((row) => row.status)),
    last90DaysCount: rows.filter((row) => row.reportedAt.getTime() >= ninetyDaysAgo.getTime()).length,
  });
}

async function loadCompetence(context: OrganisationContext): Promise<DashboardSection<CompetenceSummary>> {
  const [gaps, assignments] = await Promise.all([
    listCompetenceGaps(context),
    listCompetenceAssignments(context),
  ]);
  const sixtyDaysOut = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const expiringWithin60DaysCount = assignments.filter(
    (row) => row.status === "COMPETENT" && row.competentUntil && row.competentUntil.getTime() <= sixtyDaysOut.getTime(),
  ).length;
  return available({
    gapCount: gaps.filter((row) => row.severity === "GAP").length,
    overdueCount: gaps.filter((row) => row.severity === "OVERDUE").length,
    expiredCount: gaps.filter((row) => row.severity === "EXPIRED").length,
    expiringWithin60DaysCount,
  });
}

async function loadManagementReview(context: OrganisationContext): Promise<DashboardSection<ManagementReviewSummary>> {
  const reviews = await listManagementReviews(context);
  const latest = reviews[0] ?? null;
  if (!latest) {
    return available({ latestStatus: null, latestScheduledDate: null, openPriorActionCount: null, latestDecisionCount: null });
  }
  const [openPriorActions, decisions] = await Promise.all([
    listOpenPriorActions(context, latest.id),
    listManagementReviewDecisions(context, latest.id),
  ]);
  return available({
    latestStatus: latest.status,
    latestScheduledDate: latest.scheduledDate,
    openPriorActionCount: openPriorActions.length,
    latestDecisionCount: decisions.length,
  });
}

async function loadDocuments(context: OrganisationContext): Promise<DashboardSection<DocumentsSummary>> {
  const [documents, evidence] = await Promise.all([listControlledDocuments(context), listEvidenceObjects(context)]);
  return available({
    totalControlled: documents.length,
    effectiveCount: documents.filter((doc) => doc.currentRevision?.status === "EFFECTIVE").length,
    inReviewOrDraftCount: documents.filter(
      (doc) => doc.currentRevision?.status === "DRAFT" || doc.currentRevision?.status === "IN_REVIEW",
    ).length,
    evidenceObjectCount: evidence.length,
    activeStorageProvider: activeEvidenceStorageProviderName(),
  });
}

async function loadNotifications(context: OrganisationContext): Promise<DashboardSection<NotificationsSummary>> {
  const rows = await listMyNotifications(context, { status: "PENDING", take: 200 });
  return available({ pendingCount: rows.length });
}
