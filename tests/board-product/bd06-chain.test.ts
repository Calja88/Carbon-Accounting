import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { createEnvironmentalAspect } from "@/lib/ems/aspects/aspect-service";
import { createOperationalControl } from "@/lib/ems/controls/control-service";
import { recordComplianceEvaluationItemResult } from "@/lib/ems/legal/evaluation-service";
import {
  createNonconformityFromSource, linkAdditionalSourceToNonconformity, closeNonconformity, getNonconformity,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { createCorrectiveAction, completeCorrectiveAction, uploadEvidenceToCorrectiveAction } from "@/lib/ems/nonconformity/corrective-action-service";
import { requestEffectivenessReview, performEffectivenessReview } from "@/lib/ems/nonconformity/effectiveness-service";
import { readEvidenceObjectBytes, listEvidenceForResource } from "@/lib/documents/evidence-service";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase(); // throws if this run isn't pointed at a safe, disposable database target

const tag = randomUUID();
const grants = [
  "carbon.view", "ems.view", "ems.nonconformity.manage", "ems.corrective_action.manage",
  "ems.corrective_action.effectiveness_review", "ems.compliance_evaluation.perform", "ems.controlled_document.manage",
];

async function membership(org: string, name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE" = "ORGANISATION_WIDE", permissionCodes: string[] = grants): Promise<OrganisationContext> {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: permissionCodes.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

let owner: OrganisationContext, reviewer: OrganisationContext, restricted: OrganisationContext, foreign: OrganisationContext;
let aspectId: string, controlId: string, obligationVersionId: string, evaluationItemId: string, findingId: string;

beforeAll(async () => {
  for (const code of [...grants, "ems.controlled_document.approve"]) {
    await prisma.permissionDefinition.upsert({ where: { code }, create: { code, domain: code.split(".")[0], description: "Synthetic CI grant" }, update: {} });
  }
  const a = await prisma.organisation.create({ data: { name: "Synthetic BD06 Org", slug: `bd06-a-${tag}` } });
  const b = await prisma.organisation.create({ data: { name: "Synthetic BD06 Foreign", slug: `bd06-b-${tag}` } });
  owner = await membership(a.id, "owner");
  reviewer = await membership(a.id, "reviewer");
  restricted = await membership(a.id, "restricted", "RESTRICTED");
  foreign = await membership(b.id, "foreign");

  await prisma.nonconformityClosurePolicy.create({ data: { organisationId: a.id, requireContainment: false, requireCorrectiveActionsComplete: true, requireEffectivenessReview: true, updatedByUserId: owner.userId } });

  // --- Aspect -> Control (OperationalControlAspect, created by the service itself) ---
  const programme = await prisma.emsProgramme.create({ data: { organisationId: a.id, name: "Synthetic programme", standardsProfile: "ISO14001", standardsProfileVersion: "2015", ownerMembershipId: owner.membershipId } });
  const process = await prisma.activityProcess.create({ data: { organisationId: a.id, programmeId: programme.id, name: "Synthetic process" } });
  const aspect = await createEnvironmentalAspect(owner, {
    processId: process.id, name: "Synthetic diesel combustion", controlRelationship: "DIRECT_CONTROL",
    operatingCondition: "NORMAL", effect: "ADVERSE", actorUserId: owner.userId,
  });
  aspectId = aspect.id;
  const control = await createOperationalControl(owner, {
    controlKey: `CTRL-${tag}`, title: "Synthetic fuel storage control", type: "PROCEDURAL", ownerMembershipId: owner.membershipId,
    reviewDueDate: new Date("2027-01-01"), aspectIds: [aspectId], actorUserId: owner.userId,
  });
  controlId = control.id;

  // --- Control -> Obligation (ComplianceObligationVersionControl), obligation source = internal
  // policy (OtherRequirementSource type VOLUNTARY_COMMITMENT — a real, already-existing source-type
  // category; never presented as statutory law, per BD06's explicit "internal requirement" rule). ---
  const otherSource = await prisma.otherRequirementSource.create({
    data: { organisationId: a.id, type: "VOLUNTARY_COMMITMENT", title: "Internal Environmental Policy — Fuel Storage Standard", issuingParty: "Synthetic Org internal policy", ownerMembershipId: owner.membershipId, createdByUserId: owner.userId },
  });
  const assessment = await prisma.applicabilityAssessment.create({
    data: { organisationId: a.id, otherRequirementSourceId: otherSource.id, status: "APPLICABLE", assessedByMembershipId: owner.membershipId },
  });
  const obligation = await prisma.complianceObligation.create({ data: { organisationId: a.id } });
  const obligationVersion = await prisma.complianceObligationVersion.create({
    data: {
      organisationId: a.id, obligationId: obligation.id, version: 1, title: "Synthetic internal fuel storage requirement",
      requirementSummary: "Internal policy requirement — not a statutory obligation.", otherRequirementSourceId: otherSource.id,
      applicabilityAssessmentId: assessment.id, ownerMembershipId: owner.membershipId, status: "APPROVED", preparedByUserId: owner.userId,
    },
  });
  obligationVersionId = obligationVersion.id;
  await prisma.complianceObligation.update({ where: { id: obligation.id }, data: { activeVersionId: obligationVersion.id } });
  await prisma.complianceObligationVersionControl.create({ data: { organisationId: a.id, obligationVersionId, controlId } });

  // --- Obligation -> Evaluation (ComplianceEvaluationItem), recorded via the real service ---
  const evalProgramme = await prisma.complianceEvaluationProgramme.create({ data: { organisationId: a.id, name: "Synthetic evaluation programme", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), leadMembershipId: owner.membershipId, createdByUserId: owner.userId } });
  const evaluation = await prisma.complianceEvaluation.create({ data: { organisationId: a.id, programmeId: evalProgramme.id, periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), leadMembershipId: owner.membershipId, status: "IN_PROGRESS", createdByUserId: owner.userId } });
  const evaluationItem = await prisma.complianceEvaluationItem.create({ data: { organisationId: a.id, evaluationId: evaluation.id, obligationVersionId, status: "NOT_EVALUATED" } });
  evaluationItemId = evaluationItem.id;
  await recordComplianceEvaluationItemResult(owner, evaluationItemId, { status: "NONCOMPLIANT", rationale: "Synthetic CI: fuel storage secondary containment not yet verified.", actorUserId: owner.userId });

  // --- Audit -> Finding (independent source path, joined to the same NC below) ---
  const auditProgramme = await prisma.auditProgramme.create({ data: { organisationId: a.id, name: "Synthetic audit programme", riskBasis: "Synthetic", periodStart: new Date("2026-01-01"), periodEnd: new Date("2026-12-31"), ownerMembershipId: owner.membershipId, createdByUserId: owner.userId } });
  const audit = await prisma.emsAudit.create({ data: { organisationId: a.id, programmeId: auditProgramme.id, type: "INTERNAL", title: "Synthetic internal audit", criteriaSummary: "Synthetic", leadMembershipId: owner.membershipId, scheduledStart: new Date("2026-02-01"), scheduledEnd: new Date("2026-02-02"), status: "IN_PROGRESS", createdByUserId: owner.userId } });
  const finding = await prisma.auditFinding.create({ data: { organisationId: a.id, auditId: audit.id, classification: "MAJOR_NONCONFORMITY", status: "CONFIRMED", statement: "Synthetic finding: secondary containment not verified.", confirmedAt: new Date(), confirmedByUserId: owner.userId, createdByUserId: owner.userId } });
  findingId = finding.id;
});

afterAll(async () => { await prisma.$disconnect(); });

describe("BD06 real-Postgres connected-records chain", () => {
  it("aspect/control/requirement/evaluation relations resolve correctly", async () => {
    const ctx = toTenantRepositoryContext(owner);
    const controlLink = await prisma.operationalControlAspect.findFirst({ where: { organisationId: ctx.organisationId, aspectId, controlId } });
    expect(controlLink).not.toBeNull();
    const obligationLink = await prisma.complianceObligationVersionControl.findFirst({ where: { organisationId: ctx.organisationId, controlId, obligationVersionId } });
    expect(obligationLink).not.toBeNull();
    const version = await prisma.complianceObligationVersion.findUniqueOrThrow({ where: { id: obligationVersionId }, include: { otherRequirementSource: true, instrument: true } });
    expect(version.instrument).toBeNull();
    expect(version.otherRequirementSource?.type).toBe("VOLUNTARY_COMMITMENT"); // fictional internal policy, never a fabricated statute
    const item = await prisma.complianceEvaluationItem.findUniqueOrThrow({ where: { id: evaluationItemId } });
    expect(item.status).toBe("NONCOMPLIANT");
    expect(item.evaluatorMembershipId).toBe(owner.membershipId);
  });

  it("finding -> NC relationship is exact, and evaluation item is linked as an additional real source", async () => {
    const nc = await createNonconformityFromSource(owner, {
      reference: `BD06-${tag}`, sourceType: "AUDIT_FINDING", sourceId: findingId,
      statement: "Synthetic nonconformity from BD06 chain.", requirementReference: "Internal fuel storage policy",
      operationalControlId: controlId, complianceObligationId: (await prisma.complianceObligation.findFirstOrThrow({ where: { activeVersionId: obligationVersionId } })).id,
      ownerMembershipId: owner.membershipId, actorUserId: owner.userId,
    });
    await linkAdditionalSourceToNonconformity(owner, nc.id, { sourceType: "COMPLIANCE_EVALUATION_ITEM", sourceId: evaluationItemId, actorUserId: owner.userId });

    const links = await prisma.nonconformitySourceLink.findMany({ where: { organisationId: owner.organisationId, nonconformityId: nc.id } });
    expect(links.find((l) => l.isPrimary)?.sourceId).toBe(findingId);
    expect(links.some((l) => l.sourceType === "COMPLIANCE_EVALUATION_ITEM" && l.sourceId === evaluationItemId)).toBe(true);

    // corrective action belongs to the correct NC
    const action = await createCorrectiveAction(owner, nc.id, { description: "Synthetic corrective action", ownerMembershipId: owner.membershipId, dueDate: new Date("2026-06-01"), actorUserId: owner.userId });
    expect(action.nonconformityId).toBe(nc.id);

    // completion evidence is exact and accessible to an authorised actor
    await completeCorrectiveAction(owner, action.id, { completionEvidenceNote: "Synthetic completion note", actorUserId: owner.userId });
    const bytes = Buffer.from(`synthetic evidence for ${nc.id}`);
    const evidence = await uploadEvidenceToCorrectiveAction(owner, { correctiveActionId: action.id, fileName: "completion.txt", mimeType: "text/plain", bytes, actorUserId: owner.userId });
    const readBack = await readEvidenceObjectBytes(owner, evidence.id);
    expect(readBack?.bytes.toString()).toBe(bytes.toString());
    expect(readBack?.evidence.checksumSha256).toBe(evidence.checksumSha256);

    // missing evidence is never fabricated — a restricted-access membership cannot read it at all
    const restrictedRead = await readEvidenceObjectBytes(restricted, evidence.id);
    expect(restrictedRead).toBeNull();
    const restrictedList = await listEvidenceForResource(restricted, "corrective_action", action.id);
    expect(restrictedList).toHaveLength(0); // inaccessible evidence metadata is absent, not merely redacted

    // replay: completing an already-completed action returns a conflict, never a second silent completion
    await expect(completeCorrectiveAction(owner, action.id, { completionEvidenceNote: "Second attempt", actorUserId: owner.userId })).rejects.toThrow();

    // request review, then a DIFFERENT authorised reviewer records the outcome (self-review denied)
    const reviewable = await requestEffectivenessReview(owner, nc.id, { actorUserId: owner.userId });
    await expect(performEffectivenessReview(owner, nc.id, { reviewCycle: reviewable.reviewCycle, criteria: "Synthetic", reviewDate: new Date("2026-07-01"), result: "EFFECTIVE", decision: "Synthetic effective decision", actorUserId: owner.userId })).rejects.toThrow();
    const outcome = await performEffectivenessReview(reviewer, nc.id, { reviewCycle: reviewable.reviewCycle, criteria: "Synthetic", reviewDate: new Date("2026-07-01"), result: "EFFECTIVE", decision: "Synthetic effective decision", actorUserId: reviewer.userId });
    expect(outcome.review.reviewerMembershipId).toBe(reviewer.membershipId);

    // effective current-cycle outcome permits closure only once all prerequisites pass
    const closed = await closeNonconformity(owner, nc.id, owner.userId);
    expect(closed.status).toBe("CLOSED");

    // old issued evidence remains pinned after the later closure transition
    const stillReadable = await readEvidenceObjectBytes(owner, evidence.id);
    expect(stillReadable?.bytes.toString()).toBe(bytes.toString());
  });

  it("ineffective outcome cannot close, and an empty action set cannot reach effectiveness review", async () => {
    const nc = await createNonconformityFromSource(owner, {
      reference: `BD06-empty-${tag}`, sourceType: "MANUAL", sourceReferenceNote: "Synthetic manual source",
      statement: "Synthetic NC with no corrective actions.", requirementReference: "Internal fuel storage policy",
      ownerMembershipId: owner.membershipId, actorUserId: owner.userId,
    });
    await expect(requestEffectivenessReview(owner, nc.id, { actorUserId: owner.userId })).rejects.toThrow();

    const nc2 = await createNonconformityFromSource(owner, {
      reference: `BD06-ineffective-${tag}`, sourceType: "MANUAL", sourceReferenceNote: "Synthetic manual source",
      statement: "Synthetic NC for ineffective-cannot-close proof.", requirementReference: "Internal fuel storage policy",
      ownerMembershipId: owner.membershipId, actorUserId: owner.userId,
    });
    const action2 = await createCorrectiveAction(owner, nc2.id, { description: "Synthetic action 2", ownerMembershipId: owner.membershipId, dueDate: new Date("2026-06-01"), actorUserId: owner.userId });
    await completeCorrectiveAction(owner, action2.id, { completionEvidenceNote: "Synthetic completion note 2", actorUserId: owner.userId });
    const reviewable2 = await requestEffectivenessReview(owner, nc2.id, { actorUserId: owner.userId });
    await performEffectivenessReview(reviewer, nc2.id, { reviewCycle: reviewable2.reviewCycle, criteria: "Synthetic", reviewDate: new Date("2026-07-01"), result: "INEFFECTIVE", decision: "Synthetic ineffective decision", actorUserId: reviewer.userId });
    await expect(closeNonconformity(owner, nc2.id, owner.userId)).rejects.toThrow();
    const stillOpen = await getNonconformity(owner, nc2.id);
    expect(stillOpen.status).not.toBe("CLOSED");
  });

  it("foreign/mixed-parent relation is denied", async () => {
    await expect(createNonconformityFromSource(foreign, {
      reference: `BD06-foreign-${tag}`, sourceType: "AUDIT_FINDING", sourceId: findingId,
      statement: "Attempted cross-tenant NC.", requirementReference: "n/a", ownerMembershipId: foreign.membershipId, actorUserId: foreign.userId,
    })).rejects.toThrow();

    const ownNc = await createNonconformityFromSource(owner, {
      reference: `BD06-mixed-${tag}`, sourceType: "MANUAL", sourceReferenceNote: "Synthetic",
      statement: "Synthetic NC for mixed-parent proof.", requirementReference: "n/a", ownerMembershipId: owner.membershipId, actorUserId: owner.userId,
    });
    await expect(linkAdditionalSourceToNonconformity(owner, ownNc.id, { sourceType: "AUDIT_FINDING", sourceId: randomUUID(), actorUserId: owner.userId })).rejects.toThrow();
  });
});
