import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionSystemRoleTemplates, seedPermissionCatalogue } from "./permissions";

/**
 * UI14 hardening pass — synthetic demo-data seed.
 *
 * Standalone, idempotent, manual-only script (`pnpm exec tsx
 * prisma/seed/ems-demo.ts` / `pnpm run db:seed:ems-demo`). Never wired into
 * `db:seed` or postinstall. Reuses the `paragon-group` organisation the main
 * seed (`prisma/seed/index.ts`) and `scripts/backfill-organisation.ts` both
 * target — never creates a second tenant.
 *
 * Everything created here is synthetic fixture data for browser smoke
 * testing: fake emails on a `*.demo.example`/`*.ui14-demo.example` domain,
 * obviously fake names ("Demo ..."), no real environmental figures. Writes
 * go directly through `prisma.<model>.create(...)` rather than the guarded
 * service layer, because this script has no authenticated `OrganisationContext`
 * to fabricate — this is read-side fixture data, not a test of write-side
 * business rules.
 *
 * Idempotency strategy: every section either upserts on a real unique
 * constraint, or does a `findFirst` on a stable marker (a fixed reference/
 * key string chosen for this script) before creating. Re-running the whole
 * script is safe.
 */

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Ui14Demo!2026";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

function fakeSha256(marker: string): string {
  // Not a real digest — a fixed-length hex placeholder derived from a
  // stable marker string, long enough to satisfy any "looks like a
  // checksum" UI rendering without implying real content hashing.
  const base = Buffer.from(marker).toString("hex").padEnd(64, "0").slice(0, 64);
  return base;
}

// ---------------------------------------------------------------------------
// Part A — organisation, role templates, RBAC personas
// ---------------------------------------------------------------------------

async function getOrganisation() {
  const organisation = await prisma.organisation.upsert({
    where: { slug: "paragon-group" },
    update: {},
    create: { name: "Paragon Group", slug: "paragon-group" },
  });
  return organisation;
}

interface PersonaSeed {
  email: string;
  name: string;
  templateKey:
    | "SUSTAINABILITY_LEAD"
    | "ORGANISATION_ADMINISTRATOR"
    | "EMS_CONTRIBUTOR"
    | "FINANCE_READ_ONLY"
    | "SITE_MANAGER";
  status: "ACTIVE" | "SUSPENDED";
  accessMode: "ORGANISATION_WIDE" | "RESTRICTED";
}

const PERSONAS: PersonaSeed[] = [
  {
    email: "sustainability.lead@ui14-demo.example",
    name: "Demo Sustainability Lead",
    templateKey: "SUSTAINABILITY_LEAD",
    status: "ACTIVE",
    accessMode: "ORGANISATION_WIDE",
  },
  {
    email: "org.admin@ui14-demo.example",
    name: "Demo Organisation Administrator",
    templateKey: "ORGANISATION_ADMINISTRATOR",
    status: "ACTIVE",
    accessMode: "ORGANISATION_WIDE",
  },
  {
    email: "contributor@ui14-demo.example",
    name: "Demo EMS Contributor",
    templateKey: "EMS_CONTRIBUTOR",
    status: "ACTIVE",
    accessMode: "ORGANISATION_WIDE",
  },
  {
    email: "readonly@ui14-demo.example",
    name: "Demo Read Only",
    templateKey: "FINANCE_READ_ONLY",
    status: "ACTIVE",
    accessMode: "ORGANISATION_WIDE",
  },
  {
    email: "restricted.site@ui14-demo.example",
    name: "Demo Restricted Site Manager",
    templateKey: "SITE_MANAGER",
    status: "ACTIVE",
    accessMode: "RESTRICTED",
  },
  {
    email: "suspended@ui14-demo.example",
    name: "Demo Suspended User",
    templateKey: "EMS_CONTRIBUTOR",
    status: "SUSPENDED",
    accessMode: "ORGANISATION_WIDE",
  },
];

interface MembershipHandle {
  membershipId: string;
  userId: string;
}

async function seedPersonas(organisationId: string): Promise<Record<string, MembershipHandle>> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const handles: Record<string, MembershipHandle> = {};

  const [paragonId, hullSite] = await Promise.all([
    prisma.entity.findFirstOrThrow({ where: { organisationId, name: "Paragon ID" } }),
    prisma.site.findFirstOrThrow({ where: { organisationId, name: "Hull Site" } }),
  ]);

  for (const persona of PERSONAS) {
    const user = await prisma.user.upsert({
      where: { email: persona.email },
      update: { name: persona.name },
      create: {
        name: persona.name,
        email: persona.email,
        passwordHash,
        role: "DATA_OWNER",
      },
    });

    const role = await prisma.roleDefinition.findFirst({
      where: { organisationId, templateKey: persona.templateKey },
    });
    if (!role) {
      throw new Error(`Role template ${persona.templateKey} not provisioned for organisation ${organisationId}`);
    }

    const now = new Date();
    const membership = await prisma.organisationMembership.upsert({
      where: { organisationId_userId: { organisationId, userId: user.id } },
      update: {
        status: persona.status,
        accessMode: persona.accessMode,
        activatedAt: now,
        suspendedAt: persona.status === "SUSPENDED" ? now : null,
      },
      create: {
        organisationId,
        userId: user.id,
        status: persona.status,
        accessMode: persona.accessMode,
        activatedAt: now,
        suspendedAt: persona.status === "SUSPENDED" ? now : null,
      },
    });

    await prisma.membershipRole.upsert({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      update: {},
      create: { organisationId, membershipId: membership.id, roleId: role.id },
    });

    if (persona.accessMode === "RESTRICTED") {
      await prisma.membershipEntityScope.upsert({
        where: { membershipId_entityId: { membershipId: membership.id, entityId: paragonId.id } },
        update: {},
        create: { organisationId, membershipId: membership.id, entityId: paragonId.id },
      });
      await prisma.membershipSiteScope.upsert({
        where: { membershipId_siteId: { membershipId: membership.id, siteId: hullSite.id } },
        update: {},
        create: { organisationId, membershipId: membership.id, siteId: hullSite.id },
      });
    }

    handles[persona.email] = { membershipId: membership.id, userId: user.id };
  }

  return handles;
}

// ---------------------------------------------------------------------------
// Part B — one representative record per EMS domain
// ---------------------------------------------------------------------------

interface SeedContext {
  organisationId: string;
  sl: MembershipHandle; // Sustainability Lead
  admin: MembershipHandle; // Organisation Administrator
  paragonIdId: string;
  hullSiteId: string;
  roleIdByTemplate: Record<string, string>;
}

const skipped: string[] = [];

async function seedCompetence(ctx: SeedContext) {
  const { organisationId } = ctx;

  // Person A: linked to the Sustainability Lead's own membership.
  let personA = await prisma.personProfile.findFirst({
    where: { organisationId, membershipId: ctx.sl.membershipId },
  });
  if (!personA) {
    personA = await prisma.personProfile.create({
      data: {
        organisationId,
        membershipId: ctx.sl.membershipId,
        personType: "EMPLOYEE",
        entityId: ctx.paragonIdId,
        siteId: ctx.hullSiteId,
        createdByMembershipId: ctx.sl.membershipId,
      },
    });
  }

  // Person B: a standalone contractor with no login membership.
  let personB = await prisma.personProfile.findFirst({
    where: { organisationId, displayName: "Demo Contractor — Bureau Operations" },
  });
  if (!personB) {
    personB = await prisma.personProfile.create({
      data: {
        organisationId,
        personType: "CONTRACTOR",
        displayName: "Demo Contractor — Bureau Operations",
        entityId: ctx.paragonIdId,
        siteId: ctx.hullSiteId,
        createdByMembershipId: ctx.sl.membershipId,
      },
    });
  }

  let requirement = await prisma.competenceRequirement.findFirst({
    where: { organisationId, requirementKey: "env-awareness-training-demo" },
  });
  if (!requirement) {
    requirement = await prisma.competenceRequirement.create({
      data: { organisationId, requirementKey: "env-awareness-training-demo" },
    });
  }

  let requirementVersion = await prisma.competenceRequirementVersion.findFirst({
    where: { organisationId, requirementId: requirement.id, version: 1 },
  });
  if (!requirementVersion) {
    requirementVersion = await prisma.competenceRequirementVersion.create({
      data: {
        organisationId,
        requirementId: requirement.id,
        version: 1,
        title: "Environmental Awareness Training (Demo)",
        description: "Synthetic demo requirement: awareness of the EMS policy, significant aspects and emergency procedures.",
        renewalRule: "Renew every 12 months.",
        acceptableEvidence: "Completion certificate from the demo training provider.",
        trainingSatisfiesRequirement: true,
        status: "ACTIVE",
        preparedByUserId: ctx.sl.userId,
        approvedByUserId: ctx.sl.userId,
        approvedAt: new Date(),
      },
    });
  }

  if (requirement.activeVersionId !== requirementVersion.id) {
    await prisma.competenceRequirement.update({
      where: { organisationId_id: { organisationId, id: requirement.id } },
      data: { activeVersionId: requirementVersion.id },
    });
  }

  const emsContributorRoleId = ctx.roleIdByTemplate.EMS_CONTRIBUTOR;
  const existingScope = await prisma.competenceRequirementScope.findFirst({
    where: { organisationId, requirementVersionId: requirementVersion.id, scopeType: "ROLE", roleId: emsContributorRoleId },
  });
  if (!existingScope) {
    await prisma.competenceRequirementScope.create({
      data: {
        organisationId,
        requirementVersionId: requirementVersion.id,
        scopeType: "ROLE",
        roleId: emsContributorRoleId,
      },
    });
  }

  // Assignment A — comfortably valid (not expiring soon).
  let assignmentA = await prisma.competenceAssignment.findFirst({
    where: { organisationId, requirementVersionId: requirementVersion.id, personId: personA.id },
  });
  if (!assignmentA) {
    assignmentA = await prisma.competenceAssignment.create({
      data: {
        organisationId,
        requirementVersionId: requirementVersion.id,
        personId: personA.id,
        status: "COMPETENT",
        assignedByMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-60),
        competentUntil: daysFromNow(300),
      },
    });
  }

  const evidenceAExists = await prisma.competenceEvidence.findFirst({
    where: { organisationId, assignmentId: assignmentA.id },
  });
  if (!evidenceAExists) {
    await prisma.competenceEvidence.create({
      data: {
        organisationId,
        assignmentId: assignmentA.id,
        personId: personA.id,
        evidenceType: "TRAINING",
        issuedDate: daysFromNow(-65),
        expiryDate: daysFromNow(300),
        status: "VERIFIED",
        submittedByMembershipId: ctx.sl.membershipId,
        verifiedByMembershipId: ctx.sl.membershipId,
        verifiedAt: daysFromNow(-60),
      },
    });
  }

  // Assignment B — expiring within the 30-day window, for /ems/competence/expiry.
  let assignmentB = await prisma.competenceAssignment.findFirst({
    where: { organisationId, requirementVersionId: requirementVersion.id, personId: personB.id },
  });
  if (!assignmentB) {
    assignmentB = await prisma.competenceAssignment.create({
      data: {
        organisationId,
        requirementVersionId: requirementVersion.id,
        personId: personB.id,
        status: "COMPETENT",
        assignedByMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-300),
        competentUntil: daysFromNow(15),
      },
    });
  }

  const evidenceBExists = await prisma.competenceEvidence.findFirst({
    where: { organisationId, assignmentId: assignmentB.id },
  });
  if (!evidenceBExists) {
    await prisma.competenceEvidence.create({
      data: {
        organisationId,
        assignmentId: assignmentB.id,
        personId: personB.id,
        evidenceType: "TRAINING",
        issuedDate: daysFromNow(-350),
        expiryDate: daysFromNow(15),
        status: "VERIFIED",
        submittedByMembershipId: ctx.sl.membershipId,
        verifiedByMembershipId: ctx.sl.membershipId,
        verifiedAt: daysFromNow(-345),
      },
    });
  }

  return { personA, personB, requirementVersion };
}

async function seedManagementReview(ctx: SeedContext, personAId: string) {
  const { organisationId } = ctx;

  let template = await prisma.managementReviewAgendaTemplate.findFirst({
    where: { organisationId, templateKey: "demo-standard-agenda" },
  });
  if (!template) {
    template = await prisma.managementReviewAgendaTemplate.create({
      data: { organisationId, templateKey: "demo-standard-agenda", name: "Standard Management Review Agenda (Demo)" },
    });
  }

  let templateVersion = await prisma.managementReviewAgendaTemplateVersion.findFirst({
    where: { organisationId, templateId: template.id, version: 1 },
  });
  if (!templateVersion) {
    templateVersion = await prisma.managementReviewAgendaTemplateVersion.create({
      data: {
        organisationId,
        templateId: template.id,
        version: 1,
        name: "Standard agenda v1 (Demo)",
        status: "ACTIVE",
        preparedByUserId: ctx.sl.userId,
        approvedByUserId: ctx.sl.userId,
        approvedAt: daysFromNow(-90),
      },
    });
    await prisma.managementReviewAgendaItemDefinition.create({
      data: {
        organisationId,
        templateVersionId: templateVersion.id,
        order: 1,
        title: "Status of actions from previous reviews (Demo)",
      },
    });
    await prisma.managementReviewAgendaItemDefinition.create({
      data: {
        organisationId,
        templateVersionId: templateVersion.id,
        order: 2,
        title: "Compliance evaluation results (Demo)",
      },
    });
  }

  if (template.activeVersionId !== templateVersion.id) {
    await prisma.managementReviewAgendaTemplate.update({
      where: { organisationId_id: { organisationId, id: template.id } },
      data: { activeVersionId: templateVersion.id },
    });
  }

  let review = await prisma.managementReview.findFirst({
    where: { organisationId, reference: "MR-DEMO-2026-01" },
  });
  if (!review) {
    review = await prisma.managementReview.create({
      data: {
        organisationId,
        reference: "MR-DEMO-2026-01",
        periodStart: daysFromNow(-180),
        periodEnd: daysFromNow(-1),
        cutoffDate: daysFromNow(-5),
        scheduledDate: daysFromNow(-10),
        heldDate: daysFromNow(-10),
        chairMembershipId: ctx.sl.membershipId,
        coordinatorMembershipId: ctx.admin.membershipId,
        agendaTemplateId: template.id,
        agendaTemplateVersionId: templateVersion.id,
        status: "APPROVED",
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const attendeeExists = await prisma.managementReviewAttendee.findFirst({
    where: { organisationId, reviewId: review.id, personId: personAId },
  });
  if (!attendeeExists) {
    await prisma.managementReviewAttendee.create({
      data: {
        organisationId,
        reviewId: review.id,
        personId: personAId,
        role: "CHAIR",
        invited: true,
        attended: true,
      },
    });
  }

  let pack = await prisma.managementReviewPack.findFirst({ where: { organisationId, reviewId: review.id } });
  if (!pack) {
    pack = await prisma.managementReviewPack.create({
      data: {
        organisationId,
        reviewId: review.id,
        agendaTemplateVersionId: templateVersion.id,
        cutoffDate: review.cutoffDate,
        status: "ISSUED",
        payload: { note: "Synthetic demo pack payload — no real environmental data.", agendaItems: 2 },
        checksumSha256: fakeSha256(`pack:${review.id}`),
        generatedAt: daysFromNow(-9),
        issuedByUserId: ctx.sl.userId,
        issuedAt: daysFromNow(-9),
      },
    });
  }

  const minutesExist = await prisma.managementReviewMinuteRevision.findFirst({
    where: { organisationId, reviewId: review.id, revisionNumber: 1 },
  });
  if (!minutesExist) {
    await prisma.managementReviewMinuteRevision.create({
      data: {
        organisationId,
        reviewId: review.id,
        revisionNumber: 1,
        status: "APPROVED",
        content: { summary: "Synthetic demo minutes — review held, actions and compliance status discussed." },
        checksumSha256: fakeSha256(`minutes:${review.id}`),
        preparedByMembershipId: ctx.admin.membershipId,
        preparedAt: daysFromNow(-9),
        approvedByMembershipId: ctx.sl.membershipId,
        approvedAt: daysFromNow(-8),
      },
    });
  }

  const decisionExists = await prisma.managementReviewDecision.findFirst({
    where: { organisationId, reviewId: review.id, text: "Approve additional demo training budget for 2026 (Demo)" },
  });
  if (!decisionExists) {
    await prisma.managementReviewDecision.create({
      data: {
        organisationId,
        reviewId: review.id,
        decisionType: "RESOURCE_ALLOCATION",
        text: "Approve additional demo training budget for 2026 (Demo)",
        rationale: "Synthetic demo rationale — supports competence gaps identified in the review pack.",
        ownerMembershipId: ctx.sl.membershipId,
        targetDate: daysFromNow(60),
        recordedByMembershipId: ctx.admin.membershipId,
      },
    });
  }

  return review;
}

async function seedSharedInfra(ctx: SeedContext) {
  const { organisationId } = ctx;

  let programme = await prisma.emsProgramme.findFirst({
    where: { organisationId, name: "Paragon Group EMS Programme (Demo)" },
  });
  if (!programme) {
    programme = await prisma.emsProgramme.create({
      data: {
        organisationId,
        name: "Paragon Group EMS Programme (Demo)",
        status: "ACTIVE",
        standardsProfile: "ISO14001",
        standardsProfileVersion: "2015",
        certificationIntent: "PLANNED",
        ownerMembershipId: ctx.sl.membershipId,
      },
    });
  }

  let process = await prisma.activityProcess.findFirst({
    where: { organisationId, programmeId: programme.id, name: "Card/label production line (Demo)" },
  });
  if (!process) {
    process = await prisma.activityProcess.create({
      data: {
        organisationId,
        programmeId: programme.id,
        entityId: ctx.paragonIdId,
        siteId: ctx.hullSiteId,
        name: "Card/label production line (Demo)",
        description: "Synthetic demo process representing card/label manufacturing at the Hull site.",
        activityType: "ACTIVITY",
        lifecycleStage: "PRODUCTION",
        operatingCondition: "NORMAL",
        status: "ACTIVE",
        createdByMembershipId: ctx.sl.membershipId,
      },
    });
  }

  let aspect = await prisma.environmentalAspect.findFirst({
    where: { organisationId, processId: process.id, name: "Solvent-based ink use (Demo)" },
  });
  if (!aspect) {
    aspect = await prisma.environmentalAspect.create({
      data: {
        organisationId,
        processId: process.id,
        name: "Solvent-based ink use (Demo)",
        description: "Synthetic demo aspect: solvent-based ink use in the print and finishing step.",
        sourceInputOutput: "Input — ink consumption",
        controlRelationship: "DIRECT_CONTROL",
        operatingCondition: "NORMAL",
        effect: "ADVERSE",
      },
    });
  }

  let controlledDocument = await prisma.controlledDocument.findFirst({
    where: { organisationId, reference: "EMS-EMG-001-DEMO" },
  });
  if (!controlledDocument) {
    controlledDocument = await prisma.controlledDocument.create({
      data: {
        organisationId,
        reference: "EMS-EMG-001-DEMO",
        title: "Site Emergency Response Procedure (Demo)",
        category: "procedure",
        classification: "INTERNAL",
        ownerMembershipId: ctx.sl.membershipId,
        reviewIntervalMonths: 12,
      },
    });
  }

  let revision = await prisma.controlledDocumentRevision.findFirst({
    where: { organisationId, documentId: controlledDocument.id, revisionNumber: 1 },
  });
  if (!revision) {
    revision = await prisma.controlledDocumentRevision.create({
      data: {
        organisationId,
        documentId: controlledDocument.id,
        revisionNumber: 1,
        status: "EFFECTIVE",
        changeSummary: "Initial synthetic demo revision.",
        checksumSha256: fakeSha256(`doc:${controlledDocument.id}`),
        mimeType: "application/pdf",
        sizeBytes: 20480,
        classification: "INTERNAL",
        retentionCategory: "STANDARD",
        preparedByUserId: ctx.sl.userId,
        reviewedByUserId: ctx.admin.userId,
        approvedByUserId: ctx.sl.userId,
        reviewedAt: daysFromNow(-200),
        approvedAt: daysFromNow(-190),
        effectiveDate: daysFromNow(-190),
        reviewDueDate: daysFromNow(175),
      },
    });
  }

  if (controlledDocument.currentRevisionId !== revision.id) {
    await prisma.controlledDocument.update({
      where: { organisationId_id: { organisationId, id: controlledDocument.id } },
      data: { currentRevisionId: revision.id },
    });
  }

  return { programme, process, aspect, controlledDocument, revision };
}

async function seedAuditsIncidentsNonconformity(ctx: SeedContext, aspectId: string, processId: string) {
  const { organisationId } = ctx;

  // --- Audits ---
  let auditProgramme = await prisma.auditProgramme.findFirst({
    where: { organisationId, name: "Internal Audit Programme 2026 (Demo)" },
  });
  if (!auditProgramme) {
    auditProgramme = await prisma.auditProgramme.create({
      data: {
        organisationId,
        name: "Internal Audit Programme 2026 (Demo)",
        description: "Synthetic demo internal audit programme.",
        riskBasis: "Risk-based synthetic demo prioritisation across Hull manufacturing operations.",
        periodStart: daysFromNow(-360),
        periodEnd: daysFromNow(5),
        ownerMembershipId: ctx.sl.membershipId,
        status: "ACTIVE",
        approvedAt: daysFromNow(-350),
        approvedByUserId: ctx.sl.userId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  let audit = await prisma.emsAudit.findFirst({
    where: { organisationId, programmeId: auditProgramme.id, title: "Hull Manufacturing Internal Audit (Demo)" },
  });
  if (!audit) {
    audit = await prisma.emsAudit.create({
      data: {
        organisationId,
        programmeId: auditProgramme.id,
        type: "INTERNAL",
        title: "Hull Manufacturing Internal Audit (Demo)",
        objectives: "Verify operational control effectiveness for the print and finishing line (demo).",
        criteriaSummary: "ISO 14001:2015 Clause 8.1, site operational control procedure (demo).",
        leadMembershipId: ctx.sl.membershipId,
        scheduledStart: daysFromNow(-20),
        scheduledEnd: daysFromNow(-18),
        status: "REPORT_ISSUED",
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const auditScopeExists = await prisma.emsAuditScope.findFirst({ where: { organisationId, auditId: audit.id, aspectId } });
  if (!auditScopeExists) {
    await prisma.emsAuditScope.create({ data: { organisationId, auditId: audit.id, aspectId, processId } });
  }

  let checklistVersion = await prisma.auditChecklistVersion.findFirst({
    where: { organisationId, auditId: audit.id, version: 1 },
  });
  if (!checklistVersion) {
    checklistVersion = await prisma.auditChecklistVersion.create({
      data: {
        organisationId,
        auditId: audit.id,
        version: 1,
        status: "FROZEN",
        frozenAt: daysFromNow(-19),
        frozenByUserId: ctx.sl.userId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  let checklistItem = await prisma.auditChecklistItem.findFirst({
    where: { organisationId, checklistVersionId: checklistVersion.id, sortOrder: 0 },
  });
  if (!checklistItem) {
    checklistItem = await prisma.auditChecklistItem.create({
      data: {
        organisationId,
        checklistVersionId: checklistVersion.id,
        sortOrder: 0,
        question: "Is solvent-based ink stored per the operational control procedure? (Demo)",
        criteriaReference: "Operational control procedure (demo)",
        expectedEvidence: "Storage area inspection / logbook (demo).",
      },
    });
  }

  const responseExists = await prisma.auditQuestionResponse.findFirst({
    where: { organisationId, checklistItemId: checklistItem.id },
  });
  if (!responseExists) {
    await prisma.auditQuestionResponse.create({
      data: {
        organisationId,
        checklistItemId: checklistItem.id,
        auditId: audit.id,
        result: "NONCONFORMANCE",
        notes: "Synthetic demo finding: storage log incomplete for the last review period.",
        auditorMembershipId: ctx.sl.membershipId,
        respondedAt: daysFromNow(-18),
      },
    });
  }

  let finding = await prisma.auditFinding.findFirst({
    where: { organisationId, auditId: audit.id, statement: "Solvent storage log incomplete for the last review period (Demo)" },
  });
  if (!finding) {
    finding = await prisma.auditFinding.create({
      data: {
        organisationId,
        auditId: audit.id,
        classification: "MINOR_NONCONFORMITY",
        status: "CONFIRMED",
        statement: "Solvent storage log incomplete for the last review period (Demo)",
        objectiveEvidence: "Storage logbook missing three entries (demo).",
        criterionReference: "Operational control procedure (demo)",
        scopeRef: { resourceType: "environmental_aspect", resourceId: aspectId },
        ownerMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-2),
        confirmedAt: daysFromNow(-17),
        confirmedByUserId: ctx.sl.userId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const reportExists = await prisma.auditReportRevision.findFirst({ where: { organisationId, auditId: audit.id } });
  if (!reportExists) {
    await prisma.auditReportRevision.create({
      data: {
        organisationId,
        auditId: audit.id,
        revisionNumber: 1,
        status: "ISSUED",
        preparerUserId: ctx.sl.userId,
        reviewerUserId: ctx.admin.userId,
        issuerUserId: ctx.sl.userId,
        issuedAt: daysFromNow(-15),
        frozenPayload: { findings: 1, checklistItems: 1, note: "Synthetic demo issued report." },
        checksumSha256: fakeSha256(`audit-report:${audit.id}`),
      },
    });
  }

  // --- Incidents ---
  let severityLevel = await prisma.incidentSeverityLevel.findFirst({
    where: { organisationId, key: "moderate-demo" },
  });
  if (!severityLevel) {
    severityLevel = await prisma.incidentSeverityLevel.create({
      data: {
        organisationId,
        key: "moderate-demo",
        label: "Moderate (Demo)",
        rank: 2,
        requiresEscalation: false,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  let incident = await prisma.environmentalIncident.findFirst({
    where: { organisationId, reference: "INC-DEMO-0001" },
  });
  if (!incident) {
    incident = await prisma.environmentalIncident.create({
      data: {
        organisationId,
        reference: "INC-DEMO-0001",
        reportedAt: daysFromNow(-10),
        occurredAt: daysFromNow(-10),
        discoveredAt: daysFromNow(-10),
        entityId: ctx.paragonIdId,
        siteId: ctx.hullSiteId,
        processId,
        aspectId,
        type: "minor_spill_demo",
        factualDescription: "Synthetic demo incident: small solvent spill contained within the bunded storage area.",
        immediateResponse: "Area isolated and absorbent applied (demo).",
        potentialReceptors: "None identified beyond the bunded area (demo).",
        severityLevelId: severityLevel.id,
        severityConfigSnapshot: { key: severityLevel.key, label: severityLevel.label, rank: severityLevel.rank },
        status: "INVESTIGATING",
        reporterMembershipId: ctx.sl.membershipId,
        reporterUserId: ctx.sl.userId,
      },
    });
  }

  const assessmentExists = await prisma.incidentNotificationAssessment.findFirst({
    where: { organisationId, incidentId: incident.id },
  });
  if (!assessmentExists) {
    await prisma.incidentNotificationAssessment.create({
      data: {
        organisationId,
        incidentId: incident.id,
        authorityOrParty: "Local Environmental Health Authority (Demo)",
        dueTrigger: "Within 24 hours of discovery (demo policy).",
        decision: "NOT_REQUIRED",
        rationale: "Synthetic demo rationale: fully contained, no offsite release, below reportable threshold.",
        reviewerMembershipId: ctx.sl.membershipId,
      },
    });
  }

  // --- Nonconformity / CAPA ---
  let classification = await prisma.nonconformityClassification.findFirst({
    where: { organisationId, key: "moderate-demo" },
  });
  if (!classification) {
    classification = await prisma.nonconformityClassification.create({
      data: { organisationId, key: "moderate-demo", label: "Moderate (Demo)", rank: 2, createdByUserId: ctx.sl.userId },
    });
  }

  let nonconformity = await prisma.nonconformity.findFirst({
    where: { organisationId, reference: "NC-DEMO-0001" },
  });
  if (!nonconformity) {
    nonconformity = await prisma.nonconformity.create({
      data: {
        organisationId,
        reference: "NC-DEMO-0001",
        sourceType: "AUDIT_FINDING",
        sourceId: finding.id,
        statement: "Solvent storage logbook not maintained per procedure (Demo).",
        requirementReference: "ISO 14001:2015 Clause 8.1 — operational control (demo).",
        classificationId: classification.id,
        classificationConfigSnapshot: { key: classification.key, label: classification.label, rank: classification.rank },
        status: "CLOSED",
        ownerMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-1),
        closedAt: daysFromNow(-1),
        closedByUserId: ctx.sl.userId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const sourceLinkExists = await prisma.nonconformitySourceLink.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id, sourceId: finding.id },
  });
  if (!sourceLinkExists) {
    await prisma.nonconformitySourceLink.create({
      data: {
        organisationId,
        nonconformityId: nonconformity.id,
        sourceType: "AUDIT_FINDING",
        sourceId: finding.id,
        isPrimary: true,
        linkedByMembershipId: ctx.sl.membershipId,
      },
    });
  }

  const containmentExists = await prisma.containmentRecord.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id },
  });
  if (!containmentExists) {
    await prisma.containmentRecord.create({
      data: {
        organisationId,
        nonconformityId: nonconformity.id,
        actionTaken: "Re-briefed shift staff and issued a checklist reminder (demo).",
        actionTakenAt: daysFromNow(-16),
        ownerMembershipId: ctx.sl.membershipId,
        adequacyReviewed: true,
        adequate: true,
        adequacyReviewNotes: "Synthetic demo review: containment adequate pending permanent fix.",
        adequacyReviewerMembershipId: ctx.admin.membershipId,
        adequacyReviewedAt: daysFromNow(-15),
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const rootCauseExists = await prisma.rootCauseAnalysis.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id },
  });
  let rootCause = rootCauseExists;
  if (!rootCause) {
    rootCause = await prisma.rootCauseAnalysis.create({
      data: {
        organisationId,
        nonconformityId: nonconformity.id,
        method: "FIVE_WHYS",
        analysisPayload: { whys: ["Log not filled in", "No reminder in shift handover", "Handover checklist outdated"] },
        conclusion: "Synthetic demo conclusion: shift handover checklist did not include the storage log check.",
        approvedByMembershipId: ctx.sl.membershipId,
        approvedAt: daysFromNow(-14),
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const correctiveActionExists = await prisma.correctiveAction.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id },
  });
  let correctiveAction = correctiveActionExists;
  if (!correctiveAction) {
    correctiveAction = await prisma.correctiveAction.create({
      data: {
        organisationId,
        nonconformityId: nonconformity.id,
        description: "Update shift handover checklist to include the solvent storage log check (demo).",
        completionCriteria: "Updated checklist issued and shift leads briefed (demo).",
        ownerMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-10),
        status: "VERIFIED",
        completedAt: daysFromNow(-10),
        completedByUserId: ctx.sl.userId,
        completionEvidenceNote: "Updated checklist circulated (demo).",
        verifiedAt: daysFromNow(-8),
        verifiedByMembershipId: ctx.admin.membershipId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const effectivenessExists = await prisma.effectivenessReview.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id },
  });
  if (!effectivenessExists) {
    await prisma.nonconformity.update({ where: { id: nonconformity.id }, data: { reviewCycle: 1 } });
    await prisma.effectivenessReview.create({
      data: {
        reviewCycle: 1,
        organisationId,
        nonconformityId: nonconformity.id,
        criteria: "Three consecutive shifts with a complete storage log (demo).",
        reviewDate: daysFromNow(-5),
        reviewerMembershipId: ctx.admin.membershipId,
        result: "EFFECTIVE",
        decision: "Synthetic demo decision: corrective action effective, nonconformity may close.",
      },
    });
  }

  const closureExists = await prisma.nonconformityClosure.findFirst({
    where: { organisationId, nonconformityId: nonconformity.id },
  });
  if (!closureExists) {
    await prisma.nonconformityClosure.create({
      data: {
        organisationId,
        nonconformityId: nonconformity.id,
        snapshot: {
          containment: "adequate",
          rootCause: rootCause.conclusion,
          correctiveActionStatus: "VERIFIED",
          effectiveness: "EFFECTIVE",
        },
        rationale: "Synthetic demo closure — containment, root cause, corrective action and effectiveness review all complete.",
        closedByUserId: ctx.sl.userId,
        closedAt: daysFromNow(-1),
      },
    });
  }

  return { audit, finding, incident, nonconformity };
}

async function seedAspectsOperations(ctx: SeedContext, aspectId: string, processId: string, controlledDocumentRevisionId: string) {
  const { organisationId } = ctx;

  let method = await prisma.significanceMethod.findFirst({
    where: { organisationId, methodKey: "demo-weighted-sum", version: 1 },
  });
  if (!method) {
    method = await prisma.significanceMethod.create({
      data: {
        organisationId,
        programmeId: (await prisma.emsProgramme.findFirstOrThrow({ where: { organisationId } })).id,
        methodKey: "demo-weighted-sum",
        name: "Weighted Sum Significance Method (Demo)",
        version: 1,
        status: "DRAFT",
        formula: "WEIGHTED_SUM",
        formulaConfig: { criteria: ["severity", "likelihood"] },
        threshold: 50,
        preparedByMembershipId: ctx.sl.membershipId,
      },
    });

    await prisma.significanceCriterion.create({
      data: {
        organisationId,
        methodId: method.id,
        key: "severity",
        label: "Severity (Demo)",
        scaleConfig: { min: 1, max: 5 },
        weight: 0.6,
        required: true,
        sortOrder: 0,
      },
    });
    await prisma.significanceCriterion.create({
      data: {
        organisationId,
        methodId: method.id,
        key: "likelihood",
        label: "Likelihood (Demo)",
        scaleConfig: { min: 1, max: 5 },
        weight: 0.4,
        required: true,
        sortOrder: 1,
      },
    });

    method = await prisma.significanceMethod.update({
      where: { organisationId_id: { organisationId, id: method.id } },
      data: { status: "APPROVED", approvedByMembershipId: ctx.sl.membershipId, approvedAt: new Date() },
    });
  }

  const assessmentExists = await prisma.aspectAssessment.findFirst({
    where: { organisationId, aspectId, methodId: method.id },
  });
  let aspectAssessment = assessmentExists;
  if (!aspectAssessment) {
    aspectAssessment = await prisma.aspectAssessment.create({
      data: {
        organisationId,
        aspectId,
        methodId: method.id,
        assessmentVersion: 1,
        status: "APPROVED",
        methodKeySnapshot: method.methodKey,
        methodVersionSnapshot: method.version,
        formulaSnapshot: method.formula,
        formulaConfigSnapshot: method.formulaConfig ?? {},
        thresholdSnapshot: method.threshold,
        criteriaSnapshot: { severity: { weight: 0.6 }, likelihood: { weight: 0.4 } },
        criterionInputs: { severity: 4, likelihood: 3 },
        calculatedScore: 72,
        calculatedSignificant: true,
        calculationTrace: { formula: "WEIGHTED_SUM", steps: ["4*0.6=2.4", "3*0.4=1.2", "(2.4+1.2)/5*100=72"] },
        finalSignificant: true,
        assessedByMembershipId: ctx.sl.membershipId,
        approvedByMembershipId: ctx.sl.membershipId,
        approvedAt: new Date(),
      },
    });
  }

  let control = await prisma.operationalControl.findFirst({
    where: { organisationId, controlKey: "demo-solvent-storage-control", version: 1 },
  });
  if (!control) {
    control = await prisma.operationalControl.create({
      data: {
        organisationId,
        controlKey: "demo-solvent-storage-control",
        version: 1,
        title: "Solvent Storage Control (Demo)",
        type: "PROCEDURAL",
        status: "ACTIVE",
        description: "Synthetic demo procedural control governing solvent-based ink storage.",
        frequency: "Daily check",
        acceptanceCriteria: "Storage log fully completed each shift (demo).",
        effectivenessCriteria: "No storage-related nonconformities in a rolling 90 days (demo).",
        ownerMembershipId: ctx.sl.membershipId,
        controlledDocumentRevisionId,
        reviewDueDate: daysFromNow(180),
      },
    });
  }

  const controlAspectExists = await prisma.operationalControlAspect.findFirst({
    where: { organisationId, controlId: control.id, aspectId },
  });
  if (!controlAspectExists) {
    await prisma.operationalControlAspect.create({ data: { organisationId, controlId: control.id, aspectId } });
  }

  let monitoringPlan = await prisma.monitoringPlan.findFirst({
    where: { organisationId, planKey: "demo-solvent-storage-monitoring" },
  });
  if (!monitoringPlan) {
    monitoringPlan = await prisma.monitoringPlan.create({
      data: {
        organisationId,
        planKey: "demo-solvent-storage-monitoring",
        parameter: "Solvent storage temperature (Demo)",
        method: "Digital thermometer reading (demo).",
        location: "Hull Site — solvent store (demo).",
        frequency: "Daily",
        unit: "°C",
        acceptanceCriteria: "Below 25°C (demo).",
        status: "ACTIVE",
        aspectId,
        controlId: control.id,
        responsibleMembershipId: ctx.sl.membershipId,
        reviewDueDate: daysFromNow(90),
      },
    });
  }

  const monitoringResultExists = await prisma.monitoringResult.findFirst({
    where: { organisationId, planId: monitoringPlan.id },
  });
  if (!monitoringResultExists) {
    await prisma.monitoringResult.create({
      data: {
        organisationId,
        planId: monitoringPlan.id,
        measuredAt: daysFromNow(-1),
        value: 21.4,
        unit: "°C",
        dataQualityFlag: "VALIDATED",
        reviewStatus: "REVIEWED",
        recordedByMembershipId: ctx.sl.membershipId,
        reviewedByMembershipId: ctx.admin.membershipId,
        reviewedAt: daysFromNow(-1),
        reviewNote: "Synthetic demo reading, within acceptance criteria.",
      },
    });
  }

  let provider = await prisma.externalProviderControl.findFirst({
    where: { organisationId, providerReference: "DEMO-WASTE-CARRIER-01" },
  });
  if (!provider) {
    provider = await prisma.externalProviderControl.create({
      data: {
        organisationId,
        providerReference: "DEMO-WASTE-CARRIER-01",
        providerName: "Demo Licensed Waste Carrier Ltd.",
        providedDescription: "Synthetic demo hazardous waste collection provider.",
        communicatedRequirements: "Must hold a valid waste carrier licence and provide consignment notes (demo).",
        evaluationFrequency: "Annual",
        status: "ACTIVE",
        ownerMembershipId: ctx.sl.membershipId,
        lastReviewedAt: daysFromNow(-100),
        nextReviewDueDate: daysFromNow(265),
      },
    });
  }

  const providerAspectExists = await prisma.externalProviderControlAspect.findFirst({
    where: { organisationId, providerControlId: provider.id, aspectId },
  });
  if (!providerAspectExists) {
    await prisma.externalProviderControlAspect.create({ data: { organisationId, providerControlId: provider.id, aspectId } });
  }

  const providerEvalExists = await prisma.externalProviderEvaluation.findFirst({
    where: { organisationId, providerControlId: provider.id },
  });
  if (!providerEvalExists) {
    await prisma.externalProviderEvaluation.create({
      data: {
        organisationId,
        providerControlId: provider.id,
        evaluatedAt: daysFromNow(-100),
        criteriaSnapshot: { licenceValid: true, consignmentNotesProvided: true },
        result: "PASS",
        notes: "Synthetic demo evaluation — licence current, no issues.",
        reviewerMembershipId: ctx.sl.membershipId,
      },
    });
  }

  let scenario = await prisma.emergencyScenario.findFirst({
    where: { organisationId, name: "Solvent Storage Fire (Demo)" },
  });
  if (!scenario) {
    scenario = await prisma.emergencyScenario.create({
      data: {
        organisationId,
        aspectId,
        processId,
        siteId: ctx.hullSiteId,
        name: "Solvent Storage Fire (Demo)",
        triggerDescription: "Ignition source near the solvent store (demo scenario).",
        receptors: "Site personnel, neighbouring units (demo).",
        credibleConsequence: "Localised fire, smoke plume (demo).",
        priority: "HIGH",
        controlsSummary: "Fire suppression system, trained first responders (demo).",
        reviewDueDate: daysFromNow(180),
        status: "ACTIVE",
      },
    });
  }

  let plan = await prisma.emergencyPlan.findFirst({
    where: { organisationId, scenarioId: scenario.id, version: 1 },
  });
  if (!plan) {
    plan = await prisma.emergencyPlan.create({
      data: {
        organisationId,
        scenarioId: scenario.id,
        version: 1,
        status: "ACTIVE",
        controlledDocumentRevisionId,
        roles: "Fire warden (demo role), site incident controller (demo role).",
        resources: "Fire extinguishers, evacuation assembly point (demo).",
        effectiveDate: daysFromNow(-190),
        reviewDueDate: daysFromNow(175),
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const exerciseExists = await prisma.emergencyExercise.findFirst({
    where: { organisationId, scenarioId: scenario.id, planId: plan.id },
  });
  let exercise = exerciseExists;
  if (!exercise) {
    exercise = await prisma.emergencyExercise.create({
      data: {
        organisationId,
        scenarioId: scenario.id,
        planId: plan.id,
        type: "TABLETOP",
        exerciseDate: daysFromNow(-30),
        participantMembershipIds: [ctx.sl.membershipId, ctx.admin.membershipId],
        objectives: "Test communication and evacuation roles (demo).",
        outcome: "PARTIAL",
        observations: "Synthetic demo observation: assembly point roll call took longer than target.",
        lessons: "Refresh fire warden refresher training (demo).",
        recordedByUserId: ctx.sl.userId,
      },
    });
  }

  const exerciseActionExists = await prisma.emergencyExerciseAction.findFirst({
    where: { organisationId, exerciseId: exercise.id },
  });
  if (!exerciseActionExists) {
    await prisma.emergencyExerciseAction.create({
      data: {
        organisationId,
        exerciseId: exercise.id,
        description: "Refresh fire warden roll-call training (demo).",
        ownerMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-3),
        status: "OPEN",
      },
    });
  }

  return { aspectAssessment, control };
}

async function seedLegalCompliance(ctx: SeedContext, aspectId: string) {
  const { organisationId } = ctx;

  let source = await prisma.otherRequirementSource.findFirst({
    where: { organisationId, title: "Trade Effluent Consent (Demo)" },
  });
  if (!source) {
    source = await prisma.otherRequirementSource.create({
      data: {
        organisationId,
        type: "CONSENT",
        title: "Trade Effluent Consent (Demo)",
        issuingParty: "Demo Regional Water Authority",
        reference: "TEC-DEMO-2026-01",
        description: "Synthetic demo trade effluent discharge consent.",
        issuedAt: daysFromNow(-300),
        effectiveFrom: daysFromNow(-300),
        expiryDate: daysFromNow(65),
        nextReviewAt: daysFromNow(30),
        status: "ACTIVE",
        ownerMembershipId: ctx.sl.membershipId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  let assessment = await prisma.applicabilityAssessment.findFirst({
    where: { organisationId, otherRequirementSourceId: source.id },
  });
  if (!assessment) {
    assessment = await prisma.applicabilityAssessment.create({
      data: {
        organisationId,
        otherRequirementSourceId: source.id,
        status: "APPLICABLE",
        rationale: "Synthetic demo rationale — site discharges trade effluent under this consent.",
        proposedDecision: "APPLICABLE",
        assessedByMembershipId: ctx.sl.membershipId,
        reviewedByMembershipId: ctx.admin.membershipId,
        reviewedAt: daysFromNow(-280),
        nextReviewAt: daysFromNow(30),
      },
    });

    await prisma.applicabilityAssessmentScope.create({
      data: { organisationId, assessmentId: assessment.id, aspectId },
    });
  }

  let obligation = await prisma.complianceObligation.findFirst({
    where: {
      organisationId,
      versions: { some: { otherRequirementSourceId: source.id } },
    },
  });
  if (!obligation) {
    obligation = await prisma.complianceObligation.create({ data: { organisationId } });
  }

  let obligationVersion = await prisma.complianceObligationVersion.findFirst({
    where: { organisationId, obligationId: obligation.id, version: 1 },
  });
  if (!obligationVersion) {
    obligationVersion = await prisma.complianceObligationVersion.create({
      data: {
        organisationId,
        obligationId: obligation.id,
        version: 1,
        title: "Trade Effluent Discharge Limits (Demo)",
        requirementSummary: "Synthetic demo requirement: discharge within consented limits and submit quarterly samples.",
        otherRequirementSourceId: source.id,
        applicabilityAssessmentId: assessment.id,
        ownerMembershipId: ctx.sl.membershipId,
        frequency: "Quarterly",
        triggerDescription: "Quarterly sampling window (demo).",
        effectiveFrom: daysFromNow(-280),
        reviewDueDate: daysFromNow(30),
        status: "ACTIVE",
        preparedByUserId: ctx.sl.userId,
        approvedByUserId: ctx.sl.userId,
        approvedAt: daysFromNow(-270),
      },
    });
  }

  if (obligation.activeVersionId !== obligationVersion.id) {
    await prisma.complianceObligation.update({
      where: { organisationId_id: { organisationId, id: obligation.id } },
      data: { activeVersionId: obligationVersion.id },
    });
  }

  const obligationScopeExists = await prisma.complianceObligationVersionScope.findFirst({
    where: { organisationId, obligationVersionId: obligationVersion.id, aspectId },
  });
  if (!obligationScopeExists) {
    await prisma.complianceObligationVersionScope.create({
      data: { organisationId, obligationVersionId: obligationVersion.id, aspectId },
    });
  }

  const approvalExists = await prisma.complianceObligationApproval.findFirst({
    where: { organisationId, obligationVersionId: obligationVersion.id },
  });
  if (!approvalExists) {
    await prisma.complianceObligationApproval.create({
      data: {
        organisationId,
        obligationVersionId: obligationVersion.id,
        decision: "APPROVED",
        permissionCode: "ems.compliance_obligation.approve",
        comment: "Synthetic demo approval.",
        approverMembershipId: ctx.sl.membershipId,
        decidedAt: daysFromNow(-270),
      },
    });
  }

  let evaluationProgramme = await prisma.complianceEvaluationProgramme.findFirst({
    where: { organisationId, name: "Quarterly Compliance Evaluation (Demo)" },
  });
  if (!evaluationProgramme) {
    evaluationProgramme = await prisma.complianceEvaluationProgramme.create({
      data: {
        organisationId,
        name: "Quarterly Compliance Evaluation (Demo)",
        description: "Synthetic demo evaluation programme.",
        periodStart: daysFromNow(-90),
        periodEnd: daysFromNow(0),
        recurrence: "QUARTERLY",
        leadMembershipId: ctx.sl.membershipId,
        status: "ACTIVE",
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  let evaluation = await prisma.complianceEvaluation.findFirst({
    where: { organisationId, programmeId: evaluationProgramme.id },
  });
  if (!evaluation) {
    evaluation = await prisma.complianceEvaluation.create({
      data: {
        organisationId,
        programmeId: evaluationProgramme.id,
        periodStart: daysFromNow(-90),
        periodEnd: daysFromNow(0),
        leadMembershipId: ctx.sl.membershipId,
        status: "ISSUED",
        reportPayload: { items: 1, note: "Synthetic demo issued evaluation report." },
        issuedAt: daysFromNow(-2),
        issuedByUserId: ctx.sl.userId,
        createdByUserId: ctx.sl.userId,
      },
    });
  }

  const evalItemExists = await prisma.complianceEvaluationItem.findFirst({
    where: { organisationId, evaluationId: evaluation.id, obligationVersionId: obligationVersion.id },
  });
  if (!evalItemExists) {
    await prisma.complianceEvaluationItem.create({
      data: {
        organisationId,
        evaluationId: evaluation.id,
        obligationVersionId: obligationVersion.id,
        status: "COMPLIANT",
        rationale: "Synthetic demo rationale — quarterly samples within consented limits.",
        evaluatorMembershipId: ctx.sl.membershipId,
        evaluatedAt: daysFromNow(-3),
        followUpDate: daysFromNow(85),
      },
    });
  }

  return { obligationVersion };
}

async function seedObjectivesActions(ctx: SeedContext, aspectAssessmentId: string) {
  const { organisationId } = ctx;

  let objective = await prisma.environmentalObjective.findFirst({
    where: {
      organisationId,
      versions: { some: { title: "Reduce Solvent Storage Nonconformities (Demo)" } },
    },
  });
  if (!objective) {
    objective = await prisma.environmentalObjective.create({ data: { organisationId } });
  }

  let objectiveVersion = await prisma.environmentalObjectiveVersion.findFirst({
    where: { organisationId, objectiveId: objective.id, version: 1 },
  });
  if (!objectiveVersion) {
    objectiveVersion = await prisma.environmentalObjectiveVersion.create({
      data: {
        organisationId,
        objectiveId: objective.id,
        version: 1,
        title: "Reduce Solvent Storage Nonconformities (Demo)",
        intent: "Synthetic demo objective: eliminate recurring solvent storage log nonconformities.",
        ownerMembershipId: ctx.sl.membershipId,
        baselineDescription: "One minor nonconformity in the last 12 months (demo baseline).",
        baselineDate: daysFromNow(-360),
        targetValue: 0,
        unit: "nonconformities",
        targetDate: daysFromNow(300),
        evaluationMethod: "Count of solvent-storage nonconformities per rolling 12 months (demo).",
        status: "ACTIVE",
        preparedByUserId: ctx.sl.userId,
        approvedByUserId: ctx.sl.userId,
        approvedAt: daysFromNow(-350),
      },
    });
  }

  if (objective.activeVersionId !== objectiveVersion.id) {
    await prisma.environmentalObjective.update({
      where: { organisationId_id: { organisationId, id: objective.id } },
      data: { activeVersionId: objectiveVersion.id },
    });
  }

  const sourceLinkExists = await prisma.objectiveSourceLink.findFirst({
    where: { organisationId, objectiveVersionId: objectiveVersion.id, aspectAssessmentId },
  });
  if (!sourceLinkExists) {
    await prisma.objectiveSourceLink.create({
      data: { organisationId, objectiveVersionId: objectiveVersion.id, linkType: "ASPECT_ASSESSMENT", aspectAssessmentId },
    });
  }

  let metricDefinition = await prisma.objectiveMetricDefinition.findFirst({
    where: { organisationId, objectiveId: objective.id },
  });
  if (!metricDefinition) {
    metricDefinition = await prisma.objectiveMetricDefinition.create({ data: { organisationId, objectiveId: objective.id } });
  }

  let metricVersion = await prisma.objectiveMetricVersion.findFirst({
    where: { organisationId, metricDefinitionId: metricDefinition.id, version: 1 },
  });
  if (!metricVersion) {
    metricVersion = await prisma.objectiveMetricVersion.create({
      data: {
        organisationId,
        metricDefinitionId: metricDefinition.id,
        version: 1,
        name: "Solvent Storage Nonconformity Count (Demo)",
        sourceType: "MANUAL",
        unit: "count",
        frequency: "MONTHLY",
        boundaryDescription: "Hull site solvent storage area (demo).",
        status: "ACTIVE",
        preparedByUserId: ctx.sl.userId,
        approvedByUserId: ctx.sl.userId,
        approvedAt: daysFromNow(-350),
      },
    });
  }

  if (metricDefinition.activeVersionId !== metricVersion.id) {
    await prisma.objectiveMetricDefinition.update({
      where: { organisationId_id: { organisationId, id: metricDefinition.id } },
      data: { activeVersionId: metricVersion.id },
    });
  }

  let actionProgramme = await prisma.actionProgramme.findFirst({
    where: { organisationId, title: "Solvent Storage Improvement Programme (Demo)" },
  });
  if (!actionProgramme) {
    actionProgramme = await prisma.actionProgramme.create({
      data: {
        organisationId,
        objectiveId: objective.id,
        title: "Solvent Storage Improvement Programme (Demo)",
        resourcesDescription: "Synthetic demo — shift lead time and updated checklist stationery.",
        ownerMembershipId: ctx.sl.membershipId,
        startDate: daysFromNow(-30),
        targetDate: daysFromNow(300),
        status: "ACTIVE",
      },
    });
  }

  const actionItemExists = await prisma.actionItem.findFirst({
    where: { organisationId, programmeId: actionProgramme.id, title: "Roll out updated shift handover checklist (Demo)" },
  });
  if (!actionItemExists) {
    await prisma.actionItem.create({
      data: {
        organisationId,
        programmeId: actionProgramme.id,
        title: "Roll out updated shift handover checklist (Demo)",
        description: "Synthetic demo action — distribute and train all shifts on the updated checklist.",
        priority: "HIGH",
        ownerMembershipId: ctx.sl.membershipId,
        dueDate: daysFromNow(-4), // deliberately overdue for status-badge coverage
        completionCriteria: "All shift leads trained and sign-off recorded (demo).",
        status: "OPEN",
      },
    });
  }

  return { objectiveVersion };
}

async function seedDocumentsEvidence(ctx: SeedContext, aspectId: string) {
  const { organisationId } = ctx;

  const existing = await prisma.evidenceObject.findFirst({
    where: { organisationId, filename: "demo-solvent-storage-inspection.pdf" },
  });
  if (existing) return existing;

  const evidence = await prisma.evidenceObject.create({
    data: {
      organisationId,
      filename: "demo-solvent-storage-inspection.pdf",
      mimeType: "application/pdf",
      byteSize: 15360,
      checksumSha256: fakeSha256("evidence:solvent-storage-inspection"),
      classification: "INTERNAL",
      retentionCategory: "STANDARD",
      malwareScanStatus: "CLEAN",
      malwareScannedAt: new Date(),
      malwareScanner: "demo-no-op-scanner",
      uploadedByUserId: ctx.sl.userId,
    },
  });

  await prisma.evidenceLink.create({
    data: {
      evidenceId: evidence.id,
      organisationId,
      resourceType: "environmental_aspect",
      resourceId: aspectId,
      purpose: "Supporting inspection evidence (demo).",
      linkedByUserId: ctx.sl.userId,
    },
  });

  return evidence;
}

async function seedNotification(ctx: SeedContext, reviewId: string) {
  const { organisationId } = ctx;

  const existing = await prisma.notification.findFirst({
    where: { organisationId, recipientMembershipId: ctx.sl.membershipId, dedupeKey: "ui14-demo-management-review-due" },
  });
  if (existing) return existing;

  return prisma.notification.create({
    data: {
      organisationId,
      recipientMembershipId: ctx.sl.membershipId,
      type: "ems.review_due",
      channel: "IN_APP",
      status: "PENDING",
      title: "Management review approved (Demo)",
      body: "Synthetic demo notification: management review MR-DEMO-2026-01 minutes were approved.",
      resourceType: "management_review",
      resourceId: reviewId,
      dedupeKey: "ui14-demo-management-review-due",
    },
  });
}

async function main() {
  console.log("Seeding organisation (reusing paragon-group)...");
  const organisation = await getOrganisation();

  console.log("Ensuring the permission catalogue is seeded (defensive, same as scripts/backfill-organisation.ts)...");
  await seedPermissionCatalogue(prisma);

  console.log("Provisioning system role templates for the organisation...");
  await provisionSystemRoleTemplates(prisma, organisation.id);

  console.log("Seeding RBAC demo personas...");
  const handles = await seedPersonas(organisation.id);

  const [paragonId, hullSite] = await Promise.all([
    prisma.entity.findFirstOrThrow({ where: { organisationId: organisation.id, name: "Paragon ID" } }),
    prisma.site.findFirstOrThrow({ where: { organisationId: organisation.id, name: "Hull Site" } }),
  ]);

  const roleDefs = await prisma.roleDefinition.findMany({ where: { organisationId: organisation.id } });
  const roleIdByTemplate: Record<string, string> = {};
  for (const role of roleDefs) {
    if (role.templateKey) roleIdByTemplate[role.templateKey] = role.id;
  }

  const ctx: SeedContext = {
    organisationId: organisation.id,
    sl: handles["sustainability.lead@ui14-demo.example"],
    admin: handles["org.admin@ui14-demo.example"],
    paragonIdId: paragonId.id,
    hullSiteId: hullSite.id,
    roleIdByTemplate,
  };

  console.log("Seeding competence domain (1/8)...");
  const { personA } = await seedCompetence(ctx);

  console.log("Seeding management review domain (2/8)...");
  const review = await seedManagementReview(ctx, personA.id);

  console.log("Seeding shared EMS infrastructure (programme/process/aspect/controlled document)...");
  const shared = await seedSharedInfra(ctx);

  console.log("Seeding audits/incidents/nonconformity domain (3/8)...");
  await seedAuditsIncidentsNonconformity(ctx, shared.aspect.id, shared.process.id);

  console.log("Seeding aspects & operations domain (4/8)...");
  const { aspectAssessment } = await seedAspectsOperations(ctx, shared.aspect.id, shared.process.id, shared.revision.id);

  console.log("Seeding legal & compliance domain (5/8)...");
  await seedLegalCompliance(ctx, shared.aspect.id);

  console.log("Seeding objectives & actions domain (6/8)...");
  await seedObjectivesActions(ctx, aspectAssessment.id);

  console.log("Seeding documents/evidence hub domain (7/8)...");
  await seedDocumentsEvidence(ctx, shared.aspect.id);

  console.log("Seeding notifications domain (8/8)...");
  await seedNotification(ctx, review.id);

  if (skipped.length > 0) {
    console.log("Skipped domains:");
    for (const note of skipped) console.log(`  - ${note}`);
  }

  console.log("UI14 EMS demo seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
