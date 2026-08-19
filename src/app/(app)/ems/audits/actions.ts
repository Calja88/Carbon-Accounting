"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  AuditProgrammeError,
  createAuditProgramme,
  approveAuditProgramme,
  activateAuditProgramme,
  completeAuditProgramme,
  createAuditProgrammeItem,
  type AuditScopeEntryInput,
} from "@/lib/ems/audits/programme-service";
import {
  createEmsAudit,
  rescheduleEmsAudit,
  assignAuditTeamMember,
  removeAuditTeamMember,
  startAuditPreparation,
  startAuditExecution,
} from "@/lib/ems/audits/audit-service";
import {
  AuditChecklistError,
  ensureDraftChecklistVersion,
  addChecklistItem,
  removeChecklistItem,
  freezeChecklistVersion,
  recordQuestionResponse,
} from "@/lib/ems/audits/checklist-service";
import {
  AuditFindingError,
  createAuditFinding,
  confirmAuditFinding,
  requireActionOnAuditFinding,
  acceptAuditFindingAsObservation,
  closeAuditFinding,
} from "@/lib/ems/audits/finding-service";
import {
  AuditReportError,
  createAuditReportDraft,
  issueAuditReport,
} from "@/lib/ems/audits/report-service";
import {
  createAuditProgrammeFormSchema,
  createAuditProgrammeItemFormSchema,
  createEmsAuditFormSchema,
  rescheduleEmsAuditFormSchema,
  assignAuditTeamMemberFormSchema,
  addChecklistItemFormSchema,
  recordQuestionResponseFormSchema,
  createAuditFindingFormSchema,
} from "@/lib/ems/audits/audit-schemas";

export interface AuditActionState {
  error: string | null;
  message: string | null;
}

const emptyState: AuditActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof AuditProgrammeError) return error.message;
  if (error instanceof AuditChecklistError) return error.message;
  if (error instanceof AuditFindingError) return error.message;
  if (error instanceof AuditReportError) return error.message;
  throw error;
}

function revalidateAudits() {
  revalidatePath("/ems/audits");
}

function scopesFromForm(parsed: { entityIds: string[]; siteIds: string[] }): AuditScopeEntryInput[] {
  return [...parsed.entityIds.map((entityId) => ({ entityId })), ...parsed.siteIds.map((siteId) => ({ siteId }))];
}

export async function createAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createAuditProgrammeFormSchema.safeParse({
      name: formData.get("name"),
      description: formData.get("description"),
      objectives: formData.get("objectives"),
      riskBasis: formData.get("riskBasis"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      ownerMembershipId: formData.get("ownerMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the programme details." };
    await createAuditProgramme(context, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      objectives: parsed.data.objectives || null,
      riskBasis: parsed.data.riskBasis,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      ownerMembershipId: parsed.data.ownerMembershipId,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit programme created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function approveAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await approveAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme approved." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function activateAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await activateAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme activated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function completeAuditProgrammeAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const programmeId = String(formData.get("programmeId") ?? "");
    if (!programmeId) return { ...emptyState, error: "Choose a programme." };
    await completeAuditProgramme(context, programmeId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Programme completed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createAuditProgrammeItemAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createAuditProgrammeItemFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      title: formData.get("title"),
      rationale: formData.get("rationale"),
      priority: formData.get("priority") || "MEDIUM",
      plannedStart: formData.get("plannedStart"),
      plannedEnd: formData.get("plannedEnd"),
      siteIds: formData.getAll("siteIds").map(String),
      entityIds: formData.getAll("entityIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the planned audit details." };
    await createAuditProgrammeItem(context, parsed.data.programmeId, {
      title: parsed.data.title,
      rationale: parsed.data.rationale || null,
      priority: parsed.data.priority,
      plannedStart: parsed.data.plannedStart,
      plannedEnd: parsed.data.plannedEnd,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Planned audit added to the programme." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createEmsAuditAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createEmsAuditFormSchema.safeParse({
      programmeId: formData.get("programmeId"),
      programmeItemId: formData.get("programmeItemId"),
      type: formData.get("type"),
      title: formData.get("title"),
      objectives: formData.get("objectives"),
      criteriaSummary: formData.get("criteriaSummary"),
      leadMembershipId: formData.get("leadMembershipId"),
      scheduledStart: formData.get("scheduledStart"),
      scheduledEnd: formData.get("scheduledEnd"),
      siteIds: formData.getAll("siteIds").map(String),
      entityIds: formData.getAll("entityIds").map(String),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the audit details." };
    await createEmsAudit(context, {
      programmeId: parsed.data.programmeId,
      programmeItemId: parsed.data.programmeItemId || null,
      type: parsed.data.type,
      title: parsed.data.title,
      objectives: parsed.data.objectives || null,
      criteriaSummary: parsed.data.criteriaSummary,
      leadMembershipId: parsed.data.leadMembershipId,
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd,
      scopes: scopesFromForm(parsed.data),
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit scheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function rescheduleEmsAuditAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = rescheduleEmsAuditFormSchema.safeParse({
      auditId: formData.get("auditId"),
      scheduledStart: formData.get("scheduledStart"),
      scheduledEnd: formData.get("scheduledEnd"),
      reason: formData.get("reason"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the new schedule." };
    await rescheduleEmsAudit(context, parsed.data.auditId, {
      scheduledStart: parsed.data.scheduledStart,
      scheduledEnd: parsed.data.scheduledEnd,
      reason: parsed.data.reason || null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Audit rescheduled." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function assignAuditTeamMemberAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = assignAuditTeamMemberFormSchema.safeParse({
      auditId: formData.get("auditId"),
      membershipId: formData.get("membershipId"),
      role: formData.get("role"),
      independenceDeclared: formData.get("independenceDeclared") === "on" || formData.get("independenceDeclared") === "true",
      conflictDeclared: formData.get("conflictDeclared") === "on" || formData.get("conflictDeclared") === "true",
      conflictNotes: formData.get("conflictNotes"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the team assignment details." };
    await assignAuditTeamMember(context, parsed.data.auditId, {
      membershipId: parsed.data.membershipId,
      role: parsed.data.role,
      independenceDeclared: parsed.data.independenceDeclared,
      conflictDeclared: parsed.data.conflictDeclared,
      conflictNotes: parsed.data.conflictNotes || null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Team member assigned." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function removeAuditTeamMemberAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const memberId = String(formData.get("memberId") ?? "");
    if (!memberId) return { ...emptyState, error: "Choose a team member." };
    await removeAuditTeamMember(context, memberId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Team member removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startAuditPreparationAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await startAuditPreparation(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Audit moved to preparation." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function startAuditExecutionAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await startAuditExecution(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Audit execution started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

// --- Checklists, evidence, findings and frozen report (T61) ---

export async function ensureDraftChecklistAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await ensureDraftChecklistVersion(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Checklist started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function addChecklistItemAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = addChecklistItemFormSchema.safeParse({
      checklistVersionId: formData.get("checklistVersionId"),
      question: formData.get("question"),
      criteriaReference: formData.get("criteriaReference"),
      expectedEvidence: formData.get("expectedEvidence"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the checklist item." };
    await addChecklistItem(context, parsed.data.checklistVersionId, {
      question: parsed.data.question,
      criteriaReference: parsed.data.criteriaReference || null,
      expectedEvidence: parsed.data.expectedEvidence || null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Checklist item added." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function removeChecklistItemAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const itemId = String(formData.get("itemId") ?? "");
    if (!itemId) return { ...emptyState, error: "Choose a checklist item." };
    await removeChecklistItem(context, itemId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Checklist item removed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function freezeChecklistAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await freezeChecklistVersion(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Checklist frozen." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function recordQuestionResponseAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = recordQuestionResponseFormSchema.safeParse({
      checklistItemId: formData.get("checklistItemId"),
      result: formData.get("result"),
      notes: formData.get("notes"),
      auditorMembershipId: formData.get("auditorMembershipId"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the response." };
    await recordQuestionResponse(context, parsed.data.checklistItemId, {
      result: parsed.data.result,
      notes: parsed.data.notes || null,
      auditorMembershipId: parsed.data.auditorMembershipId,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Response recorded." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createAuditFindingAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const dueDateRaw = String(formData.get("dueDate") ?? "").trim();
    const parsed = createAuditFindingFormSchema.safeParse({
      auditId: formData.get("auditId"),
      classification: formData.get("classification"),
      statement: formData.get("statement"),
      objectiveEvidence: formData.get("objectiveEvidence"),
      criterionReference: formData.get("criterionReference"),
      ownerMembershipId: formData.get("ownerMembershipId"),
      dueDate: dueDateRaw || undefined,
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the finding details." };
    await createAuditFinding(context, parsed.data.auditId, {
      classification: parsed.data.classification,
      statement: parsed.data.statement,
      objectiveEvidence: parsed.data.objectiveEvidence || null,
      criterionReference: parsed.data.criterionReference || null,
      ownerMembershipId: parsed.data.ownerMembershipId || null,
      dueDate: parsed.data.dueDate ?? null,
      actorUserId: context.userId,
    });
    revalidateAudits();
    return { ...emptyState, message: "Finding raised. Its classification is a working category, not a certification decision." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function confirmAuditFindingAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const findingId = String(formData.get("findingId") ?? "");
    if (!findingId) return { ...emptyState, error: "Choose a finding." };
    await confirmAuditFinding(context, findingId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Finding confirmed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function requireActionOnAuditFindingAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const findingId = String(formData.get("findingId") ?? "");
    if (!findingId) return { ...emptyState, error: "Choose a finding." };
    await requireActionOnAuditFinding(context, findingId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Finding marked as requiring action." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function acceptAuditFindingAsObservationAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const findingId = String(formData.get("findingId") ?? "");
    if (!findingId) return { ...emptyState, error: "Choose a finding." };
    await acceptAuditFindingAsObservation(context, findingId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Finding accepted as an observation." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function closeAuditFindingAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const findingId = String(formData.get("findingId") ?? "");
    if (!findingId) return { ...emptyState, error: "Choose a finding." };
    await closeAuditFinding(context, findingId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Finding closed." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function createAuditReportDraftAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await createAuditReportDraft(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Report drafting started." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function issueAuditReportAction(_previous: AuditActionState, formData: FormData): Promise<AuditActionState> {
  try {
    const context = await requireOrganisationContext();
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) return { ...emptyState, error: "Choose an audit." };
    await issueAuditReport(context, auditId, context.userId);
    revalidateAudits();
    return { ...emptyState, message: "Audit report issued and frozen." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}
