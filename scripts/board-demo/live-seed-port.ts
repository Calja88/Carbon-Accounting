/**
 * BD08 live binding: implements Astra's `DemoSeedPort` (seed-orchestrator.ts)
 * against the actual live domain services. This is the one file Claude
 * writes from scratch for the board demo — the orchestrator, fixture
 * targets/obligations/evidence and the guard are all Astra's, installed
 * verbatim.
 *
 * Every sensitive transition goes through the same real, unmodified service
 * a normal user action would call (createEnvironmentalAspect,
 * createOperationalControl, createNonconformityFromSource,
 * requestEffectivenessReview, generateManagementReviewPack, ...). Reference/
 * static catalog rows that have no lifecycle of their own (Entity/Site,
 * Product/ProductVersion, ActivityDataPoint, EmissionFactorSet/Factor,
 * AuditProgramme/EmsAudit/AuditFinding scaffolding) are created directly,
 * matching the precedent already established in
 * tests/board-product/bd06-chain.test.ts and tests/checkpoint-a/postgres.test.ts.
 *
 * No browser/application module may import this file — it is only ever
 * invoked from an operator script.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  LcaAllocationMethod,
  LcaDataType,
  LcaEmissionClassification,
  LcaFactorSelectionMode,
  LcaItemType,
  LcaLifecycleStage,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";
import { createActivityEntryWithCalculations, prepareReportingData } from "@/lib/entries-service";
import { reviewSourcePeriodObligation } from "@/lib/carbon/source-period-obligation-service";
import { createEnvironmentalAspect } from "@/lib/ems/aspects/aspect-service";
import { createOperationalControl, recordControlCheck, uploadEvidenceToControlCheck } from "@/lib/ems/controls/control-service";
import { createEnvironmentalObjective } from "@/lib/ems/objectives/objective-service";
import {
  createNonconformityFromSource,
  recordContainment,
  reviewContainmentAdequacy,
  closeNonconformity,
} from "@/lib/ems/nonconformity/nonconformity-service";
import { recordRootCauseAnalysis, approveRootCauseAnalysis } from "@/lib/ems/nonconformity/root-cause-service";
import { createCorrectiveAction, completeCorrectiveAction } from "@/lib/ems/nonconformity/corrective-action-service";
import { requestEffectivenessReview, performEffectivenessReview } from "@/lib/ems/nonconformity/effectiveness-service";
import { uploadEvidenceObject, linkEvidence } from "@/lib/documents/evidence-service";
import { uploadDocument } from "@/lib/documents-service";
import { createAssessment } from "@/lib/lca/assessment-service";
import { upsertProcess, upsertInventoryItem, assignFactor } from "@/lib/lca/model-service";
import { runCalculation, getLatestRun, runTotals } from "@/lib/lca/calculation-service";
import { cloneAssessment } from "@/lib/lca/assessment-service";
import { scheduleManagementReview, startManagementReviewInputCollection } from "@/lib/ems/review/review-service";
import { generateManagementReviewPack, issueManagementReviewPack } from "@/lib/ems/review/pack-service";
import { generateBoardManagementPack, issueBoardManagementPack } from "@/lib/board/live-management-pack";
import { createOtherRequirementSource } from "@/lib/ems/legal/other-requirement-service";
import {
  createApplicabilityAssessment,
  attachEvidenceToApplicabilityAssessment,
  submitApplicabilityAssessmentForReview,
  decideApplicabilityAssessment,
} from "@/lib/ems/legal/applicability-service";
import {
  createComplianceObligation,
  submitComplianceObligationVersionForReview,
  approveComplianceObligationVersion,
} from "@/lib/ems/legal/obligation-service";
import {
  createComplianceEvaluationProgramme,
  createComplianceEvaluation,
  startComplianceEvaluation,
  recordComplianceEvaluationItemResult,
  attachEvidenceToComplianceEvaluationItem,
  completeComplianceEvaluation,
  issueComplianceEvaluation,
} from "@/lib/ems/legal/evaluation-service";
import { createAuditProgramme, approveAuditProgramme, activateAuditProgramme } from "@/lib/ems/audits/programme-service";
import { createEmsAudit, assignAuditTeamMember, startAuditPreparation, startAuditExecution } from "@/lib/ems/audits/audit-service";
import { ensureDraftChecklistVersion, addChecklistItem, recordQuestionResponse } from "@/lib/ems/audits/checklist-service";
import { createAuditFinding, confirmAuditFinding } from "@/lib/ems/audits/finding-service";
import { createAuditReportDraft, recordReportReview, issueAuditReport } from "@/lib/ems/audits/report-service";
import { BOARD1, buildSubmissionObligations, IMPROVEMENT_CHAIN, type CarbonTarget } from "./board1";
import { buildSyntheticEvidence } from "./evidence";
import type { DemoDatabaseIdentity } from "./guard";
import type { DemoSeedPort } from "./seed-orchestrator";


function trace(label: string): void {
  process.stderr.write(`[bd08-seed-trace] ${new Date().toISOString()} ${label}\n`);
}

/**
 * The same independent proof tests/checkpoint-a/disposable.ts requires
 * before any real-Postgres test runs — CHECKPOINT_A_DISPOSABLE=1 alone
 * proves nothing (any process could set it), so this also requires the
 * connection to actually be a loopback host on the exact ca_checkpoint
 * database name over a postgres protocol before treating the environment
 * as CI's disposable database. A non-throwing boolean check (unlike
 * disposable.ts's own assertion) because this seed script must run
 * correctly against a real, non-disposable persistent target too.
 */
function isIndependentlyVerifiedDisposableDatabase(): boolean {
  if (process.env.CHECKPOINT_A_DISPOSABLE !== "1") return false;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "invalid:");
    return (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.pathname === "/ca_checkpoint" &&
      ["postgres:", "postgresql:"].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

const FIXTURE_KEY = BOARD1.fixtureVersion;
const ORG_SLUG = "board-1-northstar-demonstration";

/** Every organisation this seed itself creates must carry this slug prefix — the only rule `readConnectedIdentity`'s ordinary-organisation count uses to tell "this fixture" apart from "an ordinary tenant that must never exist in a demo database". */
export const FIXTURE_ORGANISATION_SLUG_PREFIX = "board-1-";

interface SiteRow {
  key: string;
  id: string;
  name: string;
}

export class LiveSeedPort implements DemoSeedPort {
  private organisationId: string | null = null;
  private entityId: string | null = null;
  private sites: SiteRow[] = [];
  private owner: OrganisationContext | null = null;
  private sustainabilityLead: OrganisationContext | null = null;
  private independentReviewer: OrganisationContext | null = null;
  private officialFactorSetId: string | null = null;
  private wttFactorSetId: string | null = null;
  private evidenceIdByKey: Map<string, string> = new Map();
  private aspectId: string | null = null;
  private controlId: string | null = null;
  private otherRequirementSourceId: string | null = null;
  private findingId: string | null = null;
  private nonconformityId: string | null = null;
  private correctiveActionId: string | null = null;
  private lcaAssessmentId: string | null = null;
  private lcaScenarioId: string | null = null;
  private managementReviewId: string | null = null;
  private managementPackId: string | null = null;
  private boardManagementPackId: string | null = null;
  static readonly BOARD_MANAGEMENT_PACK_REFERENCE = "BOARD1-PACK-2026-Q3";
  private invoiceSourceDocumentId: string | null = null;
  private meterReadingSourceDocumentId: string | null = null;

  // -------------------------------------------------------------------
  // Identity / lease
  // -------------------------------------------------------------------

  async readConnectedIdentity(): Promise<DemoDatabaseIdentity> {
    trace("readConnectedIdentity start");
    const manifest = await prisma.demoDatabaseManifest.findUnique({ where: { id: "singleton" } });
    // Checkpoint B fix: a DemoDatabaseManifest row alone proves nothing — it
    // is an ordinary table this same process could insert a row into, so
    // its mere presence is not "independently verified provisioning
    // provenance". Two independent, out-of-band signals are required before
    // this identity can ever be reported as SYNTHETIC/disposable, neither
    // derivable from data already sitting in this database:
    //  1. APP_DATA_MODE=synthetic — the deployment's own environment must
    //     explicitly opt in; unset/anything else always fails closed.
    //  2. BOARD_DEMO_PROVISIONING_TOKEN must match the token the actual
    //     provisioning step wrote into the manifest row at creation time
    //     (never written by this seed script itself) — a stray or copied
    //     manifest row without a matching environment secret is rejected.
    const appDataModeIsSynthetic = process.env.APP_DATA_MODE === "synthetic";
    const provisioningTokenMatches =
      !!manifest &&
      !!process.env.BOARD_DEMO_PROVISIONING_TOKEN &&
      process.env.BOARD_DEMO_PROVISIONING_TOKEN === manifest.provisioningToken;

    // "Ordinary" means neither this fixture's own organisation nor another
    // repo test suite's own clearly-labelled synthetic fixture (the
    // disposable checkpoint-a-postgres CI job intentionally shares one
    // database across every real-Postgres test file; every one of those
    // fixtures — Checkpoint A, BD06, BD08's own concurrency test — names its
    // organisation "Synthetic ..." by established convention).
    //
    // This name-based leniency must NEVER influence the actual persistent-
    // demo trust decision. It is gated on independently PROVING this is the
    // disposable CI database — not merely trusting the CHECKPOINT_A_DISPOSABLE
    // flag by itself (a stray env var proves nothing on its own), but
    // reusing the exact same full check tests/checkpoint-a/disposable.ts
    // applies before any test runs: the flag AND a loopback host AND the
    // exact ca_checkpoint database name AND a postgres protocol. A real
    // target can never satisfy all four at once, so a real environment
    // always uses the strict, name-independent check — an organisation is
    // "ordinary" there purely by not carrying this fixture's own slug
    // prefix, exactly as the Astra guard contract requires (verified
    // database identity, not organisation naming).
    const isDisposableCiSuite = isIndependentlyVerifiedDisposableDatabase();
    const ordinaryOrganisationCount = await prisma.organisation.count({
      where: isDisposableCiSuite
        ? {
            AND: [
              { NOT: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } },
              { NOT: { name: { startsWith: "Synthetic " } } },
            ],
          }
        : { NOT: { slug: { startsWith: FIXTURE_ORGANISATION_SLUG_PREFIX } } },
    });
    if (!manifest || !appDataModeIsSynthetic || !provisioningTokenMatches) {
      // Fails closed: assertDemoTarget will reject an empty actualDatabaseId/
      // manifestEnvironmentId against any configured allow-list value. A
      // manifest existing is not enough on its own — both independent
      // signals above must also hold.
      return { actualDatabaseId: "", manifestEnvironmentId: "", dataClass: "OTHER", disposable: false, ordinaryOrganisationCount };
    }
    return {
      actualDatabaseId: manifest.databaseId,
      manifestEnvironmentId: manifest.environmentId,
      dataClass: "SYNTHETIC",
      disposable: true,
      ordinaryOrganisationCount,
    };
  }

  /**
   * No held transaction, no row lock spanning the build — see
   * beginFixture/markFixtureReady below for why exclusivity now comes from
   * an atomic status CAS instead. Only ensures the lease row exists.
   */
  async withExclusiveFixtureLease<T>(key: string, operation: () => Promise<T>): Promise<T> {
    trace("withExclusiveFixtureLease start");
    await prisma.demoFixtureLease.upsert({
      where: { fixtureKey: key },
      create: { fixtureKey: key },
      update: {},
    });
    return operation();
  }

  async existingFixture(): Promise<{ version: string; digest: string } | null> {
    const lease = await prisma.demoFixtureLease.findUnique({ where: { fixtureKey: FIXTURE_KEY } });
    if (!lease || lease.status === "NONE") return null;
    if (lease.status === "BUILDING") return { version: FIXTURE_KEY, digest: "" }; // deliberately invalid digest -> orchestrator refuses a partial fixture
    return { version: FIXTURE_KEY, digest: lease.digest };
  }

  /**
   * Checkpoint B fix: this CAS (`WHERE status: "NONE"`) is now the entire
   * exclusivity mechanism — the previous design held a Postgres row lock
   * for the whole build via a separate connection, which both self-
   * deadlocked (fixed earlier as an ordinary bug) and meant this BUILDING
   * write only became durable if the whole surrounding transaction
   * eventually committed. A domain-write failure after this point now
   * leaves BUILDING durably persisted — a detectable, unavailable,
   * interrupted build — rather than silently reverting to NONE while
   * partial domain records survive. A concurrent second caller's CAS
   * affects zero rows and is refused immediately, matching the interface's
   * documented "Refuse concurrent seed/reset" contract without needing a
   * held lock at all.
   */
  async beginFixture(version: string): Promise<void> {
    trace("beginFixture start");
    const { count } = await prisma.demoFixtureLease.updateMany({
      where: { fixtureKey: version, status: "NONE" },
      data: { status: "BUILDING", digest: "" },
    });
    if (count === 0) {
      throw new Error(`Fixture "${version}" is already BUILDING or READY — refusing a concurrent or duplicate build.`);
    }
    await this.resolveExistingOrganisation();
  }

  /**
   * Checkpoint B fix: previously discarded verifyAllInvariants' own
   * recomputed digest, so a replay never actually proved the persisted
   * fixture still matches what was issued — an incomplete or altered
   * fixture (or one from a different code version with the same status)
   * could pass silently. Now resolves the exact persisted ids, recomputes
   * the digest from what's actually stored, and rejects any mismatch.
   */
  async verifyExistingFixture(): Promise<void> {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: FIXTURE_KEY } });
    if (lease.status !== "READY") {
      throw new Error(`Fixture "${FIXTURE_KEY}" is not READY (status=${lease.status}) — refusing to verify an incomplete or interrupted build.`);
    }
    await this.resolveExistingOrganisation();
    if (!this.organisationId) throw new Error("Fixture is marked READY but its organisation cannot be found.");
    await this.resolveExistingFixtureState(this.organisationId);
    const { digest } = await this.verifyAllInvariants();
    if (digest !== lease.digest) {
      throw new Error(`Fixture "${FIXTURE_KEY}" digest mismatch: recomputed ${digest} does not match the saved ${lease.digest} — refusing an altered or incomplete fixture.`);
    }
  }

  /**
   * verifyAllInvariants reads several ids off `this` (evidenceIdByKey,
   * lcaAssessmentId/lcaScenarioId, managementPackId, nonconformityId) that a
   * fresh build populates as it goes — but a replay runs on a brand-new
   * LiveSeedPort instance (per DemoSeedPort's contract, seedBoardDemo never
   * assumes port state survives between calls), so verifyExistingFixture
   * must re-derive every one of them from what's actually persisted.
   */
  private async resolveExistingFixtureState(organisationId: string): Promise<void> {
    // createImprovementChain deliberately re-links some of these same
    // filenames onto separate control-check/nonconformity evidence records
    // with their own distinct bytes (e.g. "BOARD-1-inspection.txt" is
    // linked again via uploadEvidenceToControlCheck as inspection-checklist
    // evidence) — so filename alone doesn't uniquely identify the row
    // storeEvidence originally created. Matching by filename AND checksum
    // together does, since buildSyntheticEvidence()'s bytes are
    // deterministic and every collision above intentionally uses different
    // content.
    const evidenceRows = await prisma.evidenceObject.findMany({ where: { organisationId } });
    for (const file of buildSyntheticEvidence()) {
      const row = evidenceRows.find((r) => r.filename === file.name && r.checksumSha256 === file.sha256);
      if (row) this.evidenceIdByKey.set(file.key, row.id);
    }

    const baseline = await prisma.lcaAssessment.findFirst({ where: { organisationId, reference: "BOARD1-LCA-001" } });
    this.lcaAssessmentId = baseline?.id ?? null;
    const scenario = await prisma.lcaAssessment.findFirst({ where: { organisationId, reference: "BOARD1-LCA-001-S1" } });
    this.lcaScenarioId = scenario?.id ?? null;

    const pack = await prisma.managementReviewPack.findFirst({ where: { organisationId } });
    this.managementPackId = pack?.id ?? null;

    const boardPack = await prisma.boardManagementPack.findFirst({ where: { organisationId, reference: LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE } });
    this.boardManagementPackId = boardPack?.id ?? null;

    const invoiceDoc = await prisma.sourceDocument.findFirst({ where: { organisationId, filename: "BOARD-1-invoice.txt" } });
    this.invoiceSourceDocumentId = invoiceDoc?.id ?? null;
    const meterDoc = await prisma.sourceDocument.findFirst({ where: { organisationId, filename: "BOARD-1-meter-reading.txt" } });
    this.meterReadingSourceDocumentId = meterDoc?.id ?? null;

    // Deliberately the OLDEST matching row, ordered explicitly rather than
    // left to an unspecified default: a genuine post-freeze live transition
    // (e.g. a demonstration nonconformity created after the pack issues,
    // proving the frozen pack doesn't move) can create another row whose
    // reference also starts with "BOARD1-NC-" — the improvement chain's own
    // nonconformity is always the first one created for this organisation.
    const nc = await prisma.nonconformity.findFirst({
      where: { organisationId, reference: { startsWith: "BOARD1-NC-" } },
      orderBy: { createdAt: "asc" },
    });
    this.nonconformityId = nc?.id ?? null;
  }

  private async resolveExistingOrganisation(): Promise<void> {
    const org = await prisma.organisation.findUnique({ where: { slug: ORG_SLUG } });
    if (org) {
      this.organisationId = org.id;
      const entity = await prisma.entity.findFirst({ where: { organisationId: org.id } });
      this.entityId = entity?.id ?? null;
      this.sites = await prisma.site.findMany({ where: { organisationId: org.id }, orderBy: { name: "asc" } }).then((rows) =>
        rows.map((r) => ({ key: BOARD1.sites.find((s) => s.name === r.name)?.key ?? r.name, id: r.id, name: r.name })),
      );
    }
  }

  // -------------------------------------------------------------------
  // Organisation, entity, sites, personas
  // -------------------------------------------------------------------

  async createSyntheticOrganisationAndActors(): Promise<void> {
    trace("createSyntheticOrganisationAndActors start");
    const org = await prisma.organisation.create({ data: { name: BOARD1.organisation, slug: ORG_SLUG } });
    this.organisationId = org.id;

    const entity = await prisma.entity.create({ data: { organisationId: org.id, name: BOARD1.organisation } });
    this.entityId = entity.id;

    for (const site of BOARD1.sites) {
      const row = await prisma.site.create({ data: { organisationId: org.id, entityId: entity.id, name: site.name } });
      this.sites.push({ key: site.key, id: row.id, name: site.name });
    }

    // Checkpoint B fix 6: LCA permission codes exist in the catalogue but —
    // confirmed by inspection — no service or page anywhere in this
    // codebase currently calls requirePermission/hasPermission with any
    // "lca.*" code; LCA access today is gated only by tenant/entity scoping
    // (assertEntityAccess), not by a permission grant. Granting these codes
    // to the right personas is still correct persona hygiene (and is what
    // real enforcement, whenever added, will read), but it cannot today be
    // proven as an access boundary — recorded honestly rather than
    // implying a permission check exists where none does.
    const lcaGrants = ["lca.view", "lca.product.manage", "lca.assessment.edit", "lca.assessment.calculate", "lca.assessment.approve", "lca.version.issue", "lca.evidence.manage"];
    const grants = [
      "carbon.view",
      "carbon.entry.create",
      "carbon.entry.review",
      "carbon.report.generate",
      "carbon.report.export",
      "ems.view",
      "ems.aspect.edit",
      "ems.control.manage",
      "ems.nonconformity.manage",
      "ems.corrective_action.manage",
      "ems.corrective_action.effectiveness_review",
      "ems.objective.manage",
      "ems.management_review.manage",
      "ems.audit_programme.manage",
      "ems.audit.perform",
      "ems.audit_report.issue",
      "ems.legal_source.manage",
      "ems.applicability.assess",
      "ems.applicability.review",
      "ems.compliance_obligation.edit",
      "ems.compliance_obligation.approve",
      "ems.compliance_evaluation.perform",
      "carbon.entry.approve",
      ...lcaGrants,
    ];
    for (const code of grants) {
      await prisma.permissionDefinition.upsert({
        where: { code },
        create: { code, domain: code.split(".")[0], description: "BOARD-1 demonstration grant" },
        update: {},
      });
    }

    // Ephemeral synthetic credentials — a fresh random password per
    // persona, bcrypt-hashed exactly the way src/auth.ts verifies logins
    // (never the seed's own ad-hoc hash), so these personas can actually
    // sign in through the real auth path in a persistent environment.
    // Never a fixed/shared password, and never committed anywhere: the
    // plaintext is emitted once, only to this process's own stderr
    // (the same ephemeral, log-only channel trace() already uses), for
    // whoever is operating this seed run to copy down.
    const persona = async (name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE", status: "ACTIVE" | "SUSPENDED", permissionCodes: string[]) => {
      const email = `board-1-${name}-${randomUUID()}@example.invalid`;
      const plaintextPassword = randomBytes(18).toString("base64url");
      const passwordHash = await bcrypt.hash(plaintextPassword, 10);
      const user = await prisma.user.create({
        data: { name: `BOARD-1 ${name}`, email, passwordHash, role: "DATA_OWNER" },
      });
      if (status === "ACTIVE") {
        trace(`persona credential (ephemeral, log-only, never committed) — ${email} / ${plaintextPassword}`);
      }
      const membership = await prisma.organisationMembership.create({
        data: { organisationId: org.id, userId: user.id, status, accessMode },
      });
      const role = await prisma.roleDefinition.create({ data: { organisationId: org.id, name: `BOARD-1 ${name}` } });
      await prisma.rolePermission.createMany({
        data: permissionCodes.map((permissionCode) => ({ organisationId: org.id, roleId: role.id, permissionCode })),
      });
      await prisma.membershipRole.create({ data: { organisationId: org.id, roleId: role.id, membershipId: membership.id } });
      if (status !== "ACTIVE") return null;
      return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org.id });
    };

    // Contributor / site manager — the promised contribution journey needs
    // carbon.entry.create (submit activity data), not carbon.view alone.
    await persona("contributor", "ORGANISATION_WIDE", "ACTIVE", ["carbon.view", "carbon.entry.create"]);
    // Sustainability lead — owns the carbon/EMS/LCA chain and the management pack.
    this.sustainabilityLead = await persona("sustainability-lead", "ORGANISATION_WIDE", "ACTIVE", grants);
    // Independent reviewer — the separate four-eyes actor for effectiveness review, pack issuance oversight, and LCA review.
    this.independentReviewer = await persona("independent-reviewer", "ORGANISATION_WIDE", "ACTIVE", grants);
    // Read-only persona (contract) — view-only, including LCA.
    await persona("read-only", "ORGANISATION_WIDE", "ACTIVE", ["carbon.view", "ems.view", "lca.view"]);
    // Restricted-scope persona (contract) — RESTRICTED access mode, no site grants configured, proving denial by default.
    await persona("restricted", "RESTRICTED", "ACTIVE", ["carbon.view", "ems.view", "lca.view"]);
    // Suspended persona (contract) — membership exists but cannot authenticate.
    await persona("suspended", "ORGANISATION_WIDE", "SUSPENDED", ["carbon.view"]);

    this.owner = this.sustainabilityLead;
    if (!this.owner || !this.independentReviewer) throw new Error("BOARD-1 persona setup failed.");
    trace("createSyntheticOrganisationAndActors done");
  }

  // -------------------------------------------------------------------
  // Corporate carbon: 48 real calculated targets + 192 reviewed obligations
  // -------------------------------------------------------------------

  async createAndCalculateCarbon(targets: CarbonTarget[], obligations: ReturnType<typeof buildSubmissionObligations>): Promise<void> {
    trace("createAndCalculateCarbon start");
    if (!this.owner || !this.entityId) throw new Error("Organisation must be created before carbon.");
    const owner = this.owner;
    const ctx = toTenantRepositoryContext(owner);

    // A single organisation-owned factor set, clearly disclosed as
    // synthetic. Scope 1/electricity calculation is hard-coded by the
    // retained engine to resolve against the most recently effective
    // OFFICIAL_DEFRA_DESNZ set (entries-service.ts's findFactorSet) — that
    // enum tag is a required engine plumbing detail, not a claim of
    // official-ness; the human-readable name/notes are unambiguous. This
    // fixture only ever runs on a positively-verified, disposable,
    // single-tenant database (assertDemoTarget's ordinaryOrganisationCount
    // check), so it can never shadow another tenant's real factor set.
    const officialSet = await prisma.emissionFactorSet.create({
      data: {
        name: "BOARD-1 demo factors — not for reporting",
        publisher: "Synthetic demonstration fixture",
        sourceType: "OFFICIAL_DEFRA_DESNZ",
        vintageYear: 2026,
        // findFactorSet (entries-service.ts) is a global, non-tenant,
        // category-blind lookup: "the EmissionFactorSet with this
        // sourceType with the latest effectiveFrom <= asOfDate", with no
        // tiebreaker beyond that date. The disposable checkpoint-a-postgres
        // CI job runs multiple fixtures' worth of test files against one
        // shared database, and tests/checkpoint-a/postgres.test.ts creates
        // its own OFFICIAL_DEFRA_DESNZ set (the default sourceType) at the
        // same "2020-01-01" this used to use — an exact tie that let
        // Postgres's (undefined-order) tiebreak resolve to that sibling set
        // instead of this one for categories both happen to define (only
        // grid_electricity), and to FactorNotFoundError for every category
        // only this one defines (confirmed via CI: Scope 1/3 came back 100%
        // AWAITING_FACTOR, and Scope 2 calculated using that sibling test's
        // own later-mutated co2eFactor 0.9 instead of this set's 1/0.5).
        // Using a later date than any sibling fixture's — but still on or
        // before this fixture's own earliest entry (2025-01, the prior
        // comparable window) — resolves the tie in this set's favour.
        effectiveFrom: new Date("2024-12-31"),
        isPlaceholder: true,
        notes: `${BOARD1.disclosure}. These factors exist only to make the BOARD-1 fixture's headline reconcile; they must never be used for real reporting.`,
      },
    });
    this.officialFactorSetId = officialSet.id;

    const factorCategoryFor: Record<string, { scope: "SCOPE_1" | "SCOPE_2" | "SCOPE_3"; factorCategory: string; scope3Category?: string }> = {
      gas: { scope: "SCOPE_1", factorCategory: "stationary_combustion_natural_gas" },
      fleet: { scope: "SCOPE_1", factorCategory: "mobile_combustion_fuel" },
      electricity: { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      "electricity-a": { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      "electricity-b": { scope: "SCOPE_2", factorCategory: "grid_electricity" },
      substrate: { scope: "SCOPE_3", factorCategory: "board1_purchased_goods", scope3Category: "Cat 1 — Purchased goods & services" },
      services: { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      consumables: { scope: "SCOPE_3", factorCategory: "board1_purchased_consumables", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-a": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-b": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-c": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      "services-d": { scope: "SCOPE_3", factorCategory: "board1_purchased_services", scope3Category: "Cat 1 — Purchased goods & services" },
      travel: { scope: "SCOPE_3", factorCategory: "board1_business_travel", scope3Category: "Cat 6 — Business travel" },
      commuting: { scope: "SCOPE_3", factorCategory: "board1_employee_commuting", scope3Category: "Cat 7 — Employee commuting" },
    };

    // WTT/T&D-losses companion factors so the real Category 3 derivation
    // engine (scope3-derived.ts) has something to find — a small, plausible
    // rate that leaves room under the 15%/5% travel/commuting envelope.
    //
    // These MUST live in the same EmissionFactorSet as the Scope 1/2
    // factors below, not a second OFFICIAL_DEFRA_DESNZ set: findFactorSet
    // (entries-service.ts) is a global, non-tenant, category-blind lookup —
    // "most recent EmissionFactorSet with this sourceType effective by this
    // date" — so a second set with a later effectiveFrom would shadow this
    // one for every Scope 1/2 and Scope 3 board1_* lookup, not just the WTT
    // categories it was meant to add. (Confirmed via CI: with a separate,
    // later-dated WTT set, every Scope 1/2/3 entry silently resolved no
    // factor and the fixture's reconciled total came back as 0.)
    this.wttFactorSetId = officialSet.id;
    await prisma.emissionFactor.createMany({
      data: [
        // toCanonicalUnit (src/lib/units.ts) hardcodes natural gas as the one
        // category with more than one entry unit, and always converts it to
        // kWh — so this is the one factor row that must be stored in kWh,
        // not kg, or calculateEmission's exact-unit-match check throws.
        { factorSetId: officialSet.id, scope: "SCOPE_1", category: "stationary_combustion_natural_gas", basis: "STANDARD", unit: "kWh", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_1", category: "mobile_combustion_fuel", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        // calculateScope2Dual (calc-engine.ts) hardcodes "kWh" as the input
        // unit for every Scope 2 electricity calculation regardless of the
        // entry's own canonical unit, so these two rows must be kWh too.
        { factorSetId: officialSet.id, scope: "SCOPE_2", category: "grid_electricity", basis: "LOCATION_BASED", unit: "kWh", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_2", category: "grid_electricity", basis: "RESIDUAL_MIX", unit: "kWh", co2eFactor: "0.5" },
        // Each WTT/T&D companion factor is applied against its SOURCE
        // calculation's own inputUnit (deriveCategory3Calculations reuses
        // source.inputUnit), so these must match gas ("kWh") and
        // electricity ("kWh") — only fleet stays "kg".
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "wtt_natural_gas", basis: "STANDARD", unit: "kWh", co2eFactor: "0.05" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "wtt_road_fuel", basis: "STANDARD", unit: "kg", co2eFactor: "0.05" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "td_losses_electricity", basis: "STANDARD", unit: "kWh", co2eFactor: "0.05" },
      ],
    });
    // Scope 3 purchased-goods/travel/commuting factors, resolved via the
    // multi-source resolver — a plain organisation-visible library entry
    // (sourceType OFFICIAL_DEFRA_DESNZ is what resolveFactorMultiSource
    // also searches first; same disclosed, synthetic set).
    await prisma.emissionFactor.createMany({
      data: [
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_goods", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_services", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_purchased_consumables", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_business_travel", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
        { factorSetId: officialSet.id, scope: "SCOPE_3", category: "board1_employee_commuting", basis: "STANDARD", unit: "kg", co2eFactor: "1" },
      ],
    });

    const dataPointIdByCategory = new Map<string, string>();
    for (const [sourceKey, def] of Object.entries(factorCategoryFor)) {
      if (dataPointIdByCategory.has(def.factorCategory)) continue;
      const dp = await prisma.activityDataPoint.upsert({
        where: { code: `BOARD1-${def.factorCategory}` },
        create: {
          code: `BOARD1-${def.factorCategory}`,
          scope: def.scope,
          // A real, distinct display category per source — never the same
          // generic label across every data point regardless of scope,
          // which would collapse Scope 3 "screened category" coverage into
          // a single, meaningless bucket (Checkpoint B fix 2).
          category: def.factorCategory.replace(/_/g, " "),
          dataPointName: `BOARD-1 ${sourceKey}`,
          promptTemplate: "Synthetic BOARD-1 fixture input.",
          unitOptions: ["kg"],
          frequency: "Monthly",
          defaultTier: "TIER_3",
          formType: "QUANTITY",
          buildPriority: "BOARD-1",
          factorCategory: def.factorCategory,
          scope3Category: def.scope3Category ?? null,
        },
        update: {},
      });
      dataPointIdByCategory.set(def.factorCategory, dp.id);
    }

    const siteById = new Map(this.sites.map((s) => [s.key, s]));

    // Checkpoint B corrective handoff §1: the exact ActivityEntry id each
    // (site, month, source) submission actually produced, captured directly
    // from each createActivityEntryWithCalculations call's own return value
    // — never rediscovered later via a findFirst lookup that could match
    // the wrong row when several sources share one data-point category
    // (electricity-a/b, services-a/b/c/d). A duplicate key is a real bug
    // (two distinct submissions colliding on one identity), not something
    // to silently overwrite.
    const entryIdBySourcePeriod = new Map<string, string>();
    function recordSubmission(siteKey: string, month: string, source: string, entryId: string) {
      const key = `${siteKey}:${month}:${source}`;
      if (entryIdBySourcePeriod.has(key)) {
        throw new Error(`Duplicate BOARD-1 submission identity: ${key} already maps to an entry.`);
      }
      entryIdBySourcePeriod.set(key, entryId);
    }

    // Phase 1: real Scope 1/2 entries + calculations for 2026 only — the
    // year the derived Category 3 mechanism and the 192 obligations cover.
    // 2025 (prior comparable) only needs to reconcile its own total, so it
    // is seeded as Scope-1/2/3 lines directly without a derive pass.
    const targets2026 = targets.filter((t) => t.year === 2026);
    const targets2025 = targets.filter((t) => t.year === 2025);

    // Each site-month's entries touch disjoint ActivityEntry rows, so
    // building them concurrently across targets is safe (real-Postgres CI
    // proved the fully sequential version correct but far too slow —
    // ~300 sequential real-service round trips exceeded a 5-minute budget).
    await mapWithConcurrency(targets2026, 4, async (target) => {
        const site = siteById.get(target.siteKey)!;
        const periodStart = new Date(`${target.month}-01T00:00:00Z`);
        const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));

        if (target.scope1Kg > 0) {
          const [gasKg, fleetKg] = [round4(target.scope1Kg * 0.8), round4(target.scope1Kg * 0.2)];
          await Promise.all(
            ([["gas", gasKg], ["fleet", fleetKg]] as const).map(async ([source, kg]) => {
              if (kg <= 0) return;
              const result = await createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id,
                periodStart,
                periodEnd,
                rawValue: kg,
                // Natural gas is the one category toCanonicalUnit forces
                // through a kWh conversion (kWh or m3 only) — everything
                // else passes its raw unit straight through as canonical.
                rawUnit: source === "gas" ? "kWh" : "kg",
                enteredByUserId: owner.userId,
                dataQualityTier: "TIER_3",
              });
              recordSubmission(target.siteKey, target.month, source, result.entry.id);
            }),
          );
        }
        if (target.scope2LocationKg > 0) {
          const electricityKeys = target.siteKey === "central-digital" ? ["electricity-a", "electricity-b"] : ["electricity"];
          const share = target.scope2LocationKg / electricityKeys.length;
          await Promise.all(
            electricityKeys.map(async (source) => {
              const result = await createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id,
                periodStart,
                periodEnd,
                rawValue: round4(share),
                // calculateScope2Dual (calc-engine.ts) hardcodes "kWh" as
                // the input unit for every Scope 2 electricity calculation,
                // so the factor row and this entry must both be in kWh.
                rawUnit: "kWh",
                enteredByUserId: owner.userId,
                dataQualityTier: "TIER_3",
              });
              recordSubmission(target.siteKey, target.month, source, result.entry.id);
            }),
          );
        }
      });

    trace("carbon phase 1 done");

    // Checkpoint B fix 7: a real invoice and a real meter reading, each a
    // genuine SourceDocument linked to the exact ActivityEntry it
    // documents (never a floating evidence file with placeholder text
    // that admits its own quantity is unfilled).
    const invoiceEntry = await prisma.activityEntry.findFirstOrThrow({
      where: {
        organisationId: owner.organisationId,
        siteId: siteById.get("north-works")!.id,
        periodStart: new Date("2026-01-01T00:00:00Z"),
        activityDataPoint: { factorCategory: "grid_electricity" },
      },
    });
    const invoiceBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic energy invoice\n\nSite: North Works. Period: January 2026. Metered electricity: ${invoiceEntry.canonicalValue.toString()} ${invoiceEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    const invoiceDoc = await uploadDocument(owner, {
      filename: "BOARD-1-invoice.txt",
      mimeType: "text/plain",
      bytes: invoiceBytes.buffer.slice(invoiceBytes.byteOffset, invoiceBytes.byteOffset + invoiceBytes.byteLength),
      kind: "ELECTRICITY_INVOICE",
      siteId: invoiceEntry.siteId,
      uploadedByUserId: owner.userId,
      maxBytes: 1_000_000,
    });
    await prisma.activityEntry.update({ where: { id: invoiceEntry.id }, data: { sourceDocumentId: invoiceDoc.id } });
    this.invoiceSourceDocumentId = invoiceDoc.id;

    const meterEntry = await prisma.activityEntry.findFirstOrThrow({
      where: {
        organisationId: owner.organisationId,
        siteId: siteById.get("east-cards")!.id,
        periodStart: new Date("2026-02-01T00:00:00Z"),
        activityDataPoint: { factorCategory: "grid_electricity" },
      },
    });
    const meterBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic meter reading\n\nSite: East Cards. Period: February 2026. Observed electricity consumption: ${meterEntry.canonicalValue.toString()} ${meterEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    const meterDoc = await uploadDocument(owner, {
      filename: "BOARD-1-meter-reading.txt",
      mimeType: "text/plain",
      bytes: meterBytes.buffer.slice(meterBytes.byteOffset, meterBytes.byteOffset + meterBytes.byteLength),
      kind: "METER_STATEMENT",
      siteId: meterEntry.siteId,
      uploadedByUserId: owner.userId,
      maxBytes: 1_000_000,
    });
    await prisma.activityEntry.update({ where: { id: meterEntry.id }, data: { sourceDocumentId: meterDoc.id } });
    this.meterReadingSourceDocumentId = meterDoc.id;
    trace("carbon invoice/meter documents done");

    // Phase 2: run the real derived-Category-3 mechanism over the whole
    // 2026 window, then read its actual persisted result per site/month.
    await prepareReportingData(owner, new Date("2026-01-01"), new Date("2026-08-31"));
    trace("carbon phase 2 (prepareReportingData) done");

    const derivedRows = await prisma.calculation.findMany({
      where: { organisationId: owner.organisationId, scope3Category: "Cat 3 — Fuel- and energy-related activities" },
      include: { activityEntry: true },
    });
    const derivedCat3BySiteMonth = new Map<string, number>();
    for (const row of derivedRows) {
      const key = `${row.activityEntry.siteId}:${monthOf(row.activityEntry.periodStart)}`;
      derivedCat3BySiteMonth.set(key, (derivedCat3BySiteMonth.get(key) ?? 0) + Number(row.resultKgCo2e));
    }

    // Phase 3: Scope 3 category 1/6/7 entries — category1 is whatever
    // scope3Allocation says is left after the *actual* derived category 3,
    // never an independently invented number. Independent per site-month,
    // so built concurrently for the same reason as Phase 1.
    const { scope3Allocation } = await import("./board1");
    await mapWithConcurrency(
      targets2026.filter((t) => t.scope3Kg > 0),
      4,
      async (target) => {
          const site = siteById.get(target.siteKey)!;
          const periodStart = new Date(`${target.month}-01T00:00:00Z`);
          const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
          const derivedCat3Kg = derivedCat3BySiteMonth.get(`${site.id}:${target.month}`) ?? 0;
          const parts = scope3Allocation(target.scope3Kg, round4(derivedCat3Kg));

          const writes: Promise<void>[] = [];
          if (parts.category6Kg > 0) {
            writes.push(
              createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.travel.factorCategory)!,
                siteId: site.id, periodStart, periodEnd, rawValue: parts.category6Kg, rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
              }).then((result) => recordSubmission(target.siteKey, target.month, "travel", result.entry.id)),
            );
          }
          if (parts.category7Kg > 0) {
            writes.push(
              createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.commuting.factorCategory)!,
                siteId: site.id, periodStart, periodEnd, rawValue: parts.category7Kg, rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
              }).then((result) => recordSubmission(target.siteKey, target.month, "commuting", result.entry.id)),
            );
          }
          if (parts.category1Kg > 0) {
            const purchasedKeys = target.siteKey === "central-digital" ? ["services-a", "services-b", "services-c", "services-d"] : ["substrate", "services", "consumables"];
            const share = parts.category1Kg / purchasedKeys.length;
            for (const source of purchasedKeys) {
              writes.push(
                createActivityEntryWithCalculations(ctx, {
                  activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                  siteId: site.id, periodStart, periodEnd, rawValue: round4(share), rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
                }).then((result) => recordSubmission(target.siteKey, target.month, source, result.entry.id)),
              );
            }
          }
          await Promise.all(writes);
      },
    );

    trace("carbon phase 3 done");

    // 2025 comparable window: same construction, but scope3 is entered as a
    // single "board1_purchased_goods" line per site-month (only the total
    // needs to reconcile; the fine category split is a 2026-only claim).
    await mapWithConcurrency(targets2025, 4, async (target) => {
        const site = siteById.get(target.siteKey)!;
        const periodStart = new Date(`${target.month}-01T00:00:00Z`);
        const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
        const writes: Promise<void>[] = [];
        if (target.scope1Kg > 0) {
          const [gasKg, fleetKg] = [round4(target.scope1Kg * 0.8), round4(target.scope1Kg * 0.2)];
          for (const [source, kg] of [["gas", gasKg], ["fleet", fleetKg]] as const) {
            if (kg <= 0) continue;
            writes.push(
              createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id, periodStart, periodEnd, rawValue: kg, rawUnit: source === "gas" ? "kWh" : "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
              }).then((result) => recordSubmission(target.siteKey, target.month, source, result.entry.id)),
            );
          }
        }
        if (target.scope2LocationKg > 0) {
          const electricityKeys = target.siteKey === "central-digital" ? ["electricity-a", "electricity-b"] : ["electricity"];
          const share = target.scope2LocationKg / electricityKeys.length;
          for (const source of electricityKeys) {
            writes.push(
              createActivityEntryWithCalculations(ctx, {
                activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[source].factorCategory)!,
                siteId: site.id, periodStart, periodEnd, rawValue: round4(share), rawUnit: "kWh", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
              }).then((result) => recordSubmission(target.siteKey, target.month, source, result.entry.id)),
            );
          }
        }
        if (target.scope3Kg > 0) {
          writes.push(
            createActivityEntryWithCalculations(ctx, {
              activityDataPointId: dataPointIdByCategory.get(factorCategoryFor.substrate.factorCategory)!,
              siteId: site.id, periodStart, periodEnd, rawValue: round4(target.scope3Kg), rawUnit: "kg", enteredByUserId: owner.userId, dataQualityTier: "TIER_3",
            }).then((result) => recordSubmission(target.siteKey, target.month, "substrate", result.entry.id)),
          );
        }
        await Promise.all(writes);
      });

    trace("carbon 2025 window done");

    // Checkpoint B corrective handoff §1: 192 real, independently reviewable
    // source-period obligations for 2026, each genuinely bound
    // (submittedActivityEntryId) to the exact ActivityEntry its review
    // actually covers — never a dangling reference row the Overview's
    // coverage metric can't trace back to real submitted/reviewed data, and
    // never stamped REVIEWED merely because a submission exists. Every
    // obligation is created REVIEW_REQUIRED; the explicit
    // reviewSourcePeriodObligation service (below) is the only thing that
    // ever moves one to REVIEWED.
    async function boundObligationRow(row: { siteKey: string; month: string; source: string; externalKey: string }) {
      const site = siteById.get(row.siteKey)!;
      const entryId = entryIdBySourcePeriod.get(`${row.siteKey}:${row.month}:${row.source}`) ?? null;
      // Re-verify against the database (not just trust the in-memory map)
      // that a bound entry genuinely matches this obligation's own
      // organisation, site, full reporting period and source identity —
      // exactly what a foreign key alone cannot express.
      let submittedActivityEntryId: string | null = null;
      if (entryId) {
        const periodStart = new Date(`${row.month}-01T00:00:00Z`);
        const matched = await prisma.activityEntry.findFirst({
          where: {
            id: entryId,
            organisationId: owner.organisationId,
            siteId: site.id,
            periodStart,
            activityDataPointId: dataPointIdByCategory.get(factorCategoryFor[row.source].factorCategory),
          },
          select: { id: true },
        });
        if (!matched) {
          throw new Error(`BOARD-1 submission identity mismatch: entry ${entryId} for ${row.siteKey}:${row.month}:${row.source} does not match its own claimed org/site/period/source.`);
        }
        submittedActivityEntryId = matched.id;
      }
      return {
        organisationId: owner.organisationId,
        siteId: site.id,
        month: row.month,
        sourceKey: row.source,
        externalKey: row.externalKey,
        status: "REVIEW_REQUIRED" as const,
        submittedActivityEntryId,
      };
    }
    const currentObligationRows = await Promise.all(obligations.map(boundObligationRow));
    await prisma.carbonSourcePeriodObligation.createMany({ data: currentObligationRows });
    trace("carbon obligations createMany done");

    // A genuine prior-comparable (2025) obligation set, at the coarser
    // granularity 2025 was actually entered at (see the 2025 window above:
    // one aggregate Scope 3 line, not the fine 2026 category split) — never
    // invented at the 2026 granularity just to make two years look alike.
    const priorObligationSourceRows: { siteKey: string; month: string; source: string; externalKey: string }[] = [];
    for (const target of targets2025) {
      const sources: string[] = [];
      if (target.scope1Kg > 0) sources.push("gas", "fleet");
      if (target.scope2LocationKg > 0) sources.push(...(target.siteKey === "central-digital" ? ["electricity-a", "electricity-b"] : ["electricity"]));
      if (target.scope3Kg > 0) sources.push("substrate");
      for (const source of sources) {
        priorObligationSourceRows.push({ siteKey: target.siteKey, month: target.month, source, externalKey: `BOARD-1:2025:${target.siteKey}:${target.month}:${source}` });
      }
    }
    const priorObligationRows = await Promise.all(priorObligationSourceRows.map(boundObligationRow));
    await prisma.carbonSourcePeriodObligation.createMany({ data: priorObligationRows });
    trace("carbon prior-year obligations createMany done");

    // Explicitly review every obligation a real submission was bound to —
    // the seed's own synthetic reviewer persona, through the same
    // permission-checked, fingerprinted service a real reviewer would use.
    // An obligation with no bound submission stays REVIEW_REQUIRED: leaving
    // a gap unreviewed is honest; reviewing something that doesn't exist
    // would not be.
    if (!this.independentReviewer) throw new Error("Independent reviewer persona must exist before obligation review.");
    const reviewer = this.independentReviewer;
    const boundObligationIds = await prisma.carbonSourcePeriodObligation.findMany({
      where: { organisationId: owner.organisationId, status: "REVIEW_REQUIRED", submittedActivityEntryId: { not: null } },
      select: { id: true },
    });
    await mapWithConcurrency(boundObligationIds, 4, async ({ id }) => {
      await reviewSourcePeriodObligation(reviewer, id, { note: "BOARD-1 seed: reviewed against its genuine bound submission." });
    });
    trace("carbon obligation review done");
  }

  // -------------------------------------------------------------------
  // Evidence
  // -------------------------------------------------------------------

  async storeEvidence(files: ReturnType<typeof buildSyntheticEvidence>): Promise<void> {
    trace("storeEvidence start");
    if (!this.owner) throw new Error("Organisation must be created before evidence.");
    for (const file of files) {
      const evidence = await uploadEvidenceObject(this.owner, {
        fileName: file.name,
        mimeType: file.mime,
        bytes: file.bytes,
        uploadedByUserId: this.owner.userId,
      });
      if (evidence.checksumSha256 !== file.sha256) {
        throw new Error(`Evidence checksum mismatch for "${file.key}" after persistence.`);
      }
      this.evidenceIdByKey.set(file.key, evidence.id);
    }
  }

  // -------------------------------------------------------------------
  // EMS improvement chain (real state machines, per BD06's proven pattern)
  // -------------------------------------------------------------------

  async createImprovementChain(chain: typeof IMPROVEMENT_CHAIN): Promise<void> {
    trace("createImprovementChain start");
    void chain; // board1.ts's IMPROVEMENT_CHAIN is documentation of the intended story; the real chain below is built through live services, not iterated from this data.
    if (!this.owner || !this.independentReviewer || !this.sites.length) throw new Error("Organisation must be created before the EMS chain.");
    const owner = this.owner;
    const reviewer = this.independentReviewer;
    const northWorks = this.sites.find((s) => s.key === "north-works")!;

    const programme = await prisma.emsProgramme.create({
      data: { organisationId: owner.organisationId, name: "BOARD-1 demonstration programme", standardsProfile: "ISO14001", standardsProfileVersion: "2015", ownerMembershipId: owner.membershipId },
    });
    const process = await prisma.activityProcess.create({
      data: { organisationId: owner.organisationId, programmeId: programme.id, name: "North Works materials handling", siteId: northWorks.id },
    });

    const aspect = await createEnvironmentalAspect(owner, {
      processId: process.id,
      name: "Solvent storage and transfer",
      description: "Fictional materials-handling process with local water/soil impact under abnormal conditions.",
      controlRelationship: "DIRECT_CONTROL",
      operatingCondition: "ABNORMAL",
      effect: "ADVERSE",
      actorUserId: owner.userId,
    });
    this.aspectId = aspect.id;

    const otherSource = await createOtherRequirementSource(owner, {
      type: "VOLUNTARY_COMMITMENT",
      title: "Monthly containment inspection — internal requirement",
      issuingParty: "Northstar internal policy (fictional, not a statutory obligation)",
      ownerMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    this.otherRequirementSourceId = otherSource.id;

    const control = await createOperationalControl(owner, {
      controlKey: `BOARD1-CTL-${randomUUID().slice(0, 8)}`,
      title: "Containment inspection procedure",
      type: "PROCEDURAL",
      description: "Named checks and retained evidence, revision 2.",
      ownerMembershipId: owner.membershipId,
      reviewDueDate: new Date("2026-12-01"),
      aspectIds: [aspect.id],
      actorUserId: owner.userId,
    });
    this.controlId = control.id;

    const inspectionEvidenceId = this.evidenceIdByKey.get("inspection");
    const procedureEvidenceId = this.evidenceIdByKey.get("procedure");
    const check = await recordControlCheck(owner, {
      controlId: control.id,
      scheduledAt: new Date("2026-08-01"),
      result: "PASS",
      actorUserId: owner.userId,
    });
    // Checkpoint B fix 7: a real generated checklist reflecting this exact
    // persisted control check — never a five-byte "linked" placeholder —
    // and a mandatory-evidence failure that genuinely fails the seed rather
    // than being swallowed.
    if (!inspectionEvidenceId) throw new Error("Reconciliation failed: the inspection checklist evidence fixture is missing.");
    const generatedChecklistBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nContainment inspection checklist\n\nControl: ${control.title} (revision ${control.version}).\nCheck performed: ${check.scheduledAt.toISOString().slice(0, 10)}. Result: ${check.result}.\nItems checked: containment clear; condition recorded; inspection owner named.\n`,
      "utf8",
    );
    await uploadEvidenceToControlCheck(owner, { checkId: check.id, fileName: "BOARD-1-inspection-checklist.txt", mimeType: "text/plain", bytes: generatedChecklistBytes, purpose: "inspection-checklist", actorUserId: owner.userId });
    if (procedureEvidenceId) {
      await linkEvidence(owner, { evidenceId: procedureEvidenceId, resourceType: "control_check", resourceId: check.id, purpose: "procedure-revision", linkedByUserId: owner.userId });
    }

    await createEnvironmentalObjective(owner, {
      title: "Improve containment assurance",
      intent: "Reduce recurrence of unrecorded containment-inspection ownership across sites.",
      ownerMembershipId: owner.membershipId,
      baselineDescription: "Inspection ownership not consistently recorded (synthetic baseline).",
      targetDate: new Date("2027-01-01"),
      evaluationMethod: "Measured assurance coverage across scheduled inspections; action completion alone does not achieve it.",
      sourceLinks: [],
      actorUserId: owner.userId,
    }).catch(() => null); // objective lifecycle is out of this chain's critical path; never blocks the mandatory NC/CAPA chain below

    // Checkpoint B fix 7: a genuine internal requirement -> obligation
    // revision -> evaluation chain through the real domain services —
    // never just a bare OtherRequirementSource with an evidence file linked
    // straight onto it.
    const evaluationEvidenceId = this.evidenceIdByKey.get("evaluation");
    if (!evaluationEvidenceId) throw new Error("Reconciliation failed: the internal-requirement evaluation evidence fixture is missing.");

    const applicability = await createApplicabilityAssessment(owner, {
      otherRequirementSourceId: otherSource.id,
      decision: "APPLICABLE",
      rationale: "This internal policy applies to every site handling solvent storage and transfer; North Works is in scope.",
      scopes: [{ aspectId: aspect.id }],
      actorUserId: owner.userId,
    });
    await attachEvidenceToApplicabilityAssessment(owner, { assessmentId: applicability.id, evidenceId: evaluationEvidenceId, purpose: "applicability-rationale", actorUserId: owner.userId });
    await submitApplicabilityAssessmentForReview(owner, applicability.id, owner.userId);
    await decideApplicabilityAssessment(reviewer, applicability.id, {
      decision: "APPLICABLE",
      rationale: "Independent review confirms the policy applies; scope and rationale are sound.",
      nextReviewAt: new Date("2027-01-01"),
      actorUserId: reviewer.userId,
    });

    const { version: obligationVersion } = await createComplianceObligation(owner, {
      title: "Monthly containment inspection",
      requirementSummary: "Perform and record a monthly containment inspection at every in-scope site, with a named owner.",
      ownerMembershipId: owner.membershipId,
      frequency: "Monthly",
      scopes: [{ aspectId: aspect.id }],
      controlIds: [control.id],
      applicabilityAssessmentId: applicability.id,
      actorUserId: owner.userId,
    });
    await submitComplianceObligationVersionForReview(owner, obligationVersion.id, owner.userId);
    await approveComplianceObligationVersion(reviewer, obligationVersion.id, { actorUserId: reviewer.userId });

    const evaluationProgramme = await createComplianceEvaluationProgramme(owner, {
      name: "BOARD-1 compliance evaluation programme",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-12-31"),
      leadMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    const evaluation = await createComplianceEvaluation(owner, {
      programmeId: evaluationProgramme.id,
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-31"),
      leadMembershipId: owner.membershipId,
      scopes: [],
      actorUserId: owner.userId,
    });
    await startComplianceEvaluation(owner, evaluation.id, owner.userId);
    const evaluationItem = await prisma.complianceEvaluationItem.findFirstOrThrow({
      where: { organisationId: owner.organisationId, evaluationId: evaluation.id, obligationVersionId: obligationVersion.id },
    });
    await recordComplianceEvaluationItemResult(owner, evaluationItem.id, {
      status: "PARTIALLY_COMPLIANT",
      rationale: "Inspections are being performed but ownership is not consistently recorded — the exact gap this chain's corrective action addresses.",
      actorUserId: owner.userId,
    });
    await attachEvidenceToComplianceEvaluationItem(owner, { evaluationItemId: evaluationItem.id, evidenceId: evaluationEvidenceId, purpose: "internal-requirement-evaluation", actorUserId: owner.userId });
    await completeComplianceEvaluation(owner, evaluation.id, owner.userId);
    await issueComplianceEvaluation(owner, evaluation.id, owner.userId);

    // Checkpoint B fix 7: a real audit programme/audit/checklist/finding
    // lifecycle through the domain state machines — never a directly
    // stamped REPORT_ISSUED/CONFIRMED row.
    const auditProgramme = await createAuditProgramme(owner, {
      name: "BOARD-1 internal audit programme",
      riskBasis: "Synthetic, risk-based selection covering the containment-inspection control.",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-12-31"),
      ownerMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    await approveAuditProgramme(owner, auditProgramme.id, owner.userId);
    await activateAuditProgramme(owner, auditProgramme.id, owner.userId);

    const audit = await createEmsAudit(owner, {
      programmeId: auditProgramme.id,
      type: "INTERNAL",
      title: "BOARD-1 internal audit",
      criteriaSummary: "Containment inspection control operating as procedure revision 2 requires.",
      leadMembershipId: reviewer.membershipId,
      scheduledStart: new Date("2026-08-01"),
      scheduledEnd: new Date("2026-08-02"),
      scopes: [{ aspectId: aspect.id }],
      actorUserId: owner.userId,
    });
    await assignAuditTeamMember(owner, audit.id, {
      membershipId: reviewer.membershipId,
      role: "LEAD_AUDITOR",
      independenceDeclared: true,
      conflictDeclared: false,
      actorUserId: owner.userId,
    });
    await startAuditPreparation(owner, audit.id, owner.userId);

    const checklistVersion = await ensureDraftChecklistVersion(owner, audit.id, owner.userId);
    const checklistItem = await addChecklistItem(owner, checklistVersion.id, {
      question: "Is the monthly containment inspection consistently recorded with a named owner?",
      criteriaReference: "Containment inspection procedure revision 2.",
      expectedEvidence: "Retained inspection checklist showing owner and condition.",
      actorUserId: owner.userId,
    });
    await startAuditExecution(reviewer, audit.id, reviewer.userId); // freezes the checklist version
    const questionResponse = await recordQuestionResponse(reviewer, checklistItem.id, {
      result: "NONCONFORMANCE",
      notes: "Inspection ownership is not consistently recorded in the fictional sample.",
      auditorMembershipId: reviewer.membershipId,
      actorUserId: reviewer.userId,
    });

    const finding = await createAuditFinding(reviewer, audit.id, {
      classification: "MINOR_NONCONFORMITY",
      statement: "Inspection ownership is not consistently recorded in the fictional sample.",
      questionResponseId: questionResponse.id,
      ownerMembershipId: owner.membershipId,
      actorUserId: reviewer.userId,
    });
    await confirmAuditFinding(reviewer, finding.id, reviewer.userId);
    this.findingId = finding.id;
    const auditObservationEvidenceId = this.evidenceIdByKey.get("audit-observation");
    if (auditObservationEvidenceId) {
      await linkEvidence(owner, { evidenceId: auditObservationEvidenceId, resourceType: "audit_finding", resourceId: finding.id, purpose: "audit-observation", linkedByUserId: owner.userId });
    }

    await createAuditReportDraft(reviewer, audit.id, reviewer.userId);
    await recordReportReview(reviewer, audit.id, reviewer.userId);
    await issueAuditReport(owner, audit.id, owner.userId);

    const nc = await createNonconformityFromSource(owner, {
      reference: `BOARD1-NC-${randomUUID().slice(0, 8)}`,
      sourceType: "AUDIT_FINDING",
      sourceId: finding.id,
      statement: "Containment inspection gap: ownership not consistently recorded.",
      requirementReference: "Monthly containment inspection — internal requirement",
      operationalControlId: control.id,
      ownerMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    this.nonconformityId = nc.id;

    const containment = await recordContainment(owner, nc.id, { actionTaken: "Interim manual sign-off sheet introduced at North Works.", actionTakenAt: new Date("2026-08-05"), ownerMembershipId: owner.membershipId, actorUserId: owner.userId });
    await reviewContainmentAdequacy(owner, containment.id, { adequate: true, notes: "Interim sign-off sheet is adequate pending the named-owner corrective action.", actorUserId: owner.userId });
    const rootCause = await recordRootCauseAnalysis(owner, nc.id, { method: "FIVE_WHYS", analysisPayload: { note: "No single named owner for the monthly check." }, conclusion: "Inspection ownership was never assigned to a named role.", actorUserId: owner.userId });
    await approveRootCauseAnalysis(owner, rootCause.id, { actorUserId: owner.userId });

    const action = await createCorrectiveAction(owner, nc.id, { description: "Name a single inspection owner and record it in the procedure.", ownerMembershipId: owner.membershipId, dueDate: new Date("2026-09-01"), actorUserId: owner.userId });
    this.correctiveActionId = action.id;
    await completeCorrectiveAction(owner, action.id, { completionEvidenceNote: "Named owner recorded; inspection schedule confirmed.", actorUserId: owner.userId });

    const completionEvidenceId = this.evidenceIdByKey.get("completion");
    if (completionEvidenceId) {
      await linkEvidence(owner, { evidenceId: completionEvidenceId, resourceType: "corrective_action", resourceId: action.id, purpose: "completion-evidence", linkedByUserId: owner.userId });
    }

    const reviewable = await requestEffectivenessReview(owner, nc.id, { actorUserId: owner.userId });
    await performEffectivenessReview(reviewer, nc.id, {
      reviewCycle: reviewable.reviewCycle,
      criteria: "Repeat inspection has a named owner, a recorded condition and a retained checklist.",
      reviewDate: new Date("2026-09-05"),
      result: "EFFECTIVE",
      decision: "Independent review confirms the containment inspection gap is closed.",
      actorUserId: reviewer.userId,
    });
    const effectivenessEvidenceId = this.evidenceIdByKey.get("effectiveness");
    if (effectivenessEvidenceId) {
      await linkEvidence(owner, { evidenceId: effectivenessEvidenceId, resourceType: "corrective_action", resourceId: action.id, purpose: "effectiveness-review-evidence", linkedByUserId: owner.userId });
    }
    await closeNonconformity(owner, nc.id, owner.userId);
    trace("createImprovementChain done");
  }

  // -------------------------------------------------------------------
  // LCA — real engine, no corporate contamination
  // -------------------------------------------------------------------

  async createAndCalculateLca(plan: typeof BOARD1.lca): Promise<void> {
    trace("createAndCalculateLca start");
    if (!this.owner || !this.entityId) throw new Error("Organisation must be created before LCA.");
    const owner = this.owner;

    const product = await prisma.product.create({
      data: {
        entityId: this.entityId,
        organisationId: owner.organisationId,
        name: plan.product,
        sku: "BOARD1-CARD-V1",
        versions: { create: { versionLabel: "v1" } },
      },
      include: { versions: true },
    });

    const baseline = await createAssessment(owner, {
      entityId: this.entityId,
      productVersionId: product.versions[0].id,
      reference: "BOARD1-LCA-001",
      title: plan.product,
      boundary: "CRADLE_TO_GATE",
      // Explicit declared unit — cloneAssessment copies these fields
      // verbatim onto the scenario, so both sides genuinely share a unit
      // instead of relying on the schema's null default.
      functionalUnitDescription: plan.declaredUnit,
      functionalUnitQuantity: "1",
      functionalUnitUnit: "item",
      isDeclaredUnit: true,
      actorUserId: owner.userId,
    });
    this.lcaAssessmentId = baseline.id;

    await this.buildLcaProcessesAndItems(owner, baseline.id, plan.baseline);
    await runCalculation({ assessmentId: baseline.id, actorUserId: owner.userId });

    const scenario = await cloneAssessment(owner, {
      sourceAssessmentId: baseline.id,
      reference: "BOARD1-LCA-001-S1",
      title: `${plan.product} — lighter substrate scenario`,
      kind: "scenario",
      actorUserId: owner.userId,
    });
    this.lcaScenarioId = scenario.id;
    await this.replaceLcaMaterialsQuantity(owner, scenario.id, plan.scenario.materials);
    await runCalculation({ assessmentId: scenario.id, actorUserId: owner.userId });
    trace("createAndCalculateLca done");
  }

  private async buildLcaProcessesAndItems(context: OrganisationContext, assessmentId: string, contributions: typeof BOARD1.lca.baseline): Promise<void> {
    const stages: { key: keyof typeof contributions; stage: LcaLifecycleStage; name: string }[] = [
      { key: "materials", stage: LcaLifecycleStage.RAW_MATERIALS, name: "Card substrate" },
      { key: "manufacture", stage: LcaLifecycleStage.MANUFACTURING, name: "Card manufacture" },
      { key: "transport", stage: LcaLifecycleStage.INBOUND_TRANSPORT, name: "Inbound transport" },
    ];
    for (const s of stages) {
      // createAssessment already seeded one default (empty) process per
      // stage in the CRADLE_TO_GATE boundary — reuse it instead of creating
      // a duplicate, or the assessment ends up with two RAW_MATERIALS/etc.
      // processes and a later lookup-by-stage can non-deterministically
      // find the empty default rather than the one holding this item.
      const existing = await prisma.lcaProcess.findFirst({ where: { assessmentId, stage: s.stage } });
      const process = await upsertProcess(context, {
        id: existing?.id ?? null,
        assessmentId,
        stage: s.stage,
        name: s.name,
        isIncluded: true,
        allocationMethod: LcaAllocationMethod.NONE,
        actorUserId: context.userId,
      });
      const item = await upsertInventoryItem(context, {
        assessmentId,
        processId: process.id,
        itemType: LcaItemType.MATERIAL,
        name: s.name,
        quantity: String(contributions[s.key]),
        unit: "kg",
        dataType: LcaDataType.PRIMARY,
        classification: LcaEmissionClassification.FOSSIL,
        actorUserId: context.userId,
      });
      await assignFactor(context, {
        inventoryItemId: item.id,
        assessmentId,
        mode: LcaFactorSelectionMode.MANUAL,
        manualFactorValue: "1",
        manualFactorUnit: "kg",
        manualFactorSource: "BOARD-1 demonstration — not for reporting",
        manualFactorVersion: "2026",
        actorUserId: context.userId,
      });
    }
  }

  private async replaceLcaMaterialsQuantity(context: OrganisationContext, scenarioAssessmentId: string, materialsKg: number): Promise<void> {
    const materialsProcess = await prisma.lcaProcess.findFirstOrThrow({ where: { assessmentId: scenarioAssessmentId, stage: LcaLifecycleStage.RAW_MATERIALS } });
    const item = await prisma.lcaInventoryItem.findFirstOrThrow({ where: { assessmentId: scenarioAssessmentId, processId: materialsProcess.id } });
    await upsertInventoryItem(context, {
      id: item.id,
      assessmentId: scenarioAssessmentId,
      processId: materialsProcess.id,
      itemType: LcaItemType.MATERIAL,
      name: item.name,
      quantity: String(materialsKg),
      unit: "kg",
      dataType: LcaDataType.PRIMARY,
      classification: LcaEmissionClassification.FOSSIL,
      actorUserId: context.userId,
    });
  }

  // -------------------------------------------------------------------
  // Frozen management pack
  // -------------------------------------------------------------------

  async createFrozenManagementPack(): Promise<void> {
    trace("createFrozenManagementPack start");
    if (!this.owner) throw new Error("Organisation must be created before the management pack.");
    const owner = this.owner;

    const template = await prisma.managementReviewAgendaTemplate.create({
      data: { organisationId: owner.organisationId, templateKey: "board1-agenda", name: "BOARD-1 demonstration agenda" },
    });
    const version = await prisma.managementReviewAgendaTemplateVersion.create({
      data: { organisationId: owner.organisationId, templateId: template.id, version: 1, name: "v1", status: "APPROVED", preparedByUserId: owner.userId },
    });
    const review = await scheduleManagementReview(owner, {
      reference: "BOARD1-MR-2026-Q3",
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-08-31"),
      cutoffDate: new Date("2026-08-31"),
      scheduledDate: new Date("2026-09-08"),
      chairMembershipId: owner.membershipId,
      coordinatorMembershipId: owner.membershipId,
      agendaTemplateVersionId: version.id,
      actorUserId: owner.userId,
    });
    this.managementReviewId = review.id;
    await startManagementReviewInputCollection(owner, review.id, owner.userId);

    // Input links require a pre-existing active ManagementReviewInputDefinition
    // (organisation-configured input catalogue) — out of BD08's scope to add.
    // A pack with zero linked inputs is still a genuine, real snapshot (the
    // same shape the pack-service test suite already exercises), not a
    // partial/fake one.

    await generateManagementReviewPack(owner, review.id, owner.userId);
    const issued = await issueManagementReviewPack(owner, review.id, owner.userId);
    this.managementPackId = issued.id;

    // The board-sprint's own FrozenBoardPack (contracts.ts) — a real
    // Overview snapshot plus decisions/source revisions genuinely pinned to
    // this fixture's own EMS chain and LCA assessment, not the T73 pack's
    // (empty) input-link catalogue above.
    if (!this.nonconformityId || !this.correctiveActionId || !this.lcaAssessmentId || !this.lcaScenarioId) {
      throw new Error("EMS chain and LCA must be built before the frozen board pack.");
    }
    const [nonconformity, correctiveAction] = await Promise.all([
      prisma.nonconformity.findUniqueOrThrow({ where: { id: this.nonconformityId } }),
      prisma.correctiveAction.findUniqueOrThrow({ where: { id: this.correctiveActionId } }),
    ]);
    await generateBoardManagementPack(owner, {
      reference: LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE,
      overviewWindow: { from: "2026-01", to: "2026-08" },
      actorUserId: owner.userId,
      decisions: [
        {
          title: "Close the containment inspection gap",
          rationale: correctiveAction.completionEvidenceNote ?? correctiveAction.description,
          owner: BOARD1.organisation,
          dueDate: correctiveAction.dueDate.toISOString().slice(0, 10),
          status: correctiveAction.status === "VERIFIED" || correctiveAction.status === "COMPLETED" ? "approved" : "draft",
        },
      ],
      sourceRevisions: [
        { id: nonconformity.id, kind: "nonconformity", revision: nonconformity.updatedAt.toISOString(), label: nonconformity.reference, href: `/ems/nonconformities/${nonconformity.id}` },
        { id: correctiveAction.id, kind: "corrective_action", revision: (correctiveAction.verifiedAt ?? correctiveAction.completedAt ?? correctiveAction.dueDate).toISOString(), label: "Containment corrective action", href: `/ems/nonconformities/${nonconformity.id}` },
        { id: this.lcaAssessmentId, kind: "lca_assessment", revision: "baseline", label: "BOARD1-LCA-001 baseline", href: `/assessments/${this.lcaAssessmentId}` },
        { id: this.lcaScenarioId, kind: "lca_assessment", revision: "scenario", label: "BOARD1-LCA-001-S1 scenario", href: `/assessments/${this.lcaScenarioId}` },
      ],
    });
    const issuedBoardPack = await issueBoardManagementPack(owner, LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE, owner.userId);
    this.boardManagementPackId = issuedBoardPack.id;
  }

  // -------------------------------------------------------------------
  // Independent reconciliation
  // -------------------------------------------------------------------

  async verifyAllInvariants(): Promise<{ digest: string }> {
    trace("verifyAllInvariants start");
    if (!this.organisationId) throw new Error("Nothing to verify — organisation was never created.");
    const organisationId = this.organisationId;

    const primaryCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
      include: { activityEntry: true },
    });
    const derivedCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: { not: null }, activityEntry: { periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } },
    });

    const sum = (rows: { resultKgCo2e: unknown }[]) => rows.reduce((s, r) => s + Number(r.resultKgCo2e), 0);
    const currentTotal = round4(sum(primaryCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")) + sum(derivedCalcs));
    const marketCompanion = round4(sum(primaryCalcs.filter((c) => c.basis === "RESIDUAL_MIX" || c.basis === "MARKET_BASED")));

    if (Math.abs(currentTotal - BOARD1.currentKg) > 1) {
      // Diagnostic breakdown only — narrows down which scope/category/site
      // is short without guessing, before the hard failure below.
      const byScope = new Map<string, number>();
      const byCategory = new Map<string, number>();
      const bySite = new Map<string, number>();
      for (const c of primaryCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")) {
        byScope.set(c.scope, (byScope.get(c.scope) ?? 0) + Number(c.resultKgCo2e));
        byCategory.set(c.scope3Category ?? c.scope, (byCategory.get(c.scope3Category ?? c.scope) ?? 0) + Number(c.resultKgCo2e));
        bySite.set(c.activityEntry.siteId, (bySite.get(c.activityEntry.siteId) ?? 0) + Number(c.resultKgCo2e));
      }
      let derivedByCategory = 0;
      for (const c of derivedCalcs) derivedByCategory += Number(c.resultKgCo2e);
      const awaitingCount = await prisma.activityEntry.count({ where: { organisationId, status: "AWAITING_FACTOR" } });
      const totalEntryCount = await prisma.activityEntry.count({ where: { organisationId, periodStart: { gte: new Date("2026-01-01"), lte: new Date("2026-08-31") } } });
      trace(
        `reconciliation diagnostic: primaryCalcCount=${primaryCalcs.length} derivedCalcCount=${derivedCalcs.length} awaitingFactorEntries=${awaitingCount} totalEntries2026=${totalEntryCount} byScope=${JSON.stringify(Object.fromEntries(byScope))} byCategory=${JSON.stringify(Object.fromEntries(byCategory))} bySite=${JSON.stringify(Object.fromEntries(bySite))} derivedSum=${derivedByCategory}`,
      );
      throw new Error(`Reconciliation failed: current headline is ${currentTotal} kgCO2e, expected ${BOARD1.currentKg}.`);
    }
    if (Math.abs(marketCompanion - BOARD1.marketBasedScope2Kg) > 1) {
      throw new Error(`Reconciliation failed: Scope 2 market-based companion is ${marketCompanion} kgCO2e, expected ${BOARD1.marketBasedScope2Kg}.`);
    }

    const priorCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2025-01-01"), lte: new Date("2025-08-31") } } },
    });
    const priorTotal = round4(sum(priorCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")));
    if (Math.abs(priorTotal - BOARD1.previousKg) > 1) {
      throw new Error(`Reconciliation failed: prior headline is ${priorTotal} kgCO2e, expected ${BOARD1.previousKg}.`);
    }

    const obligationCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId, month: { startsWith: "2026" } } });
    const reviewedCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId, month: { startsWith: "2026" }, status: "REVIEWED" } });
    if (obligationCount !== 192 || reviewedCount !== 192) {
      throw new Error(`Reconciliation failed: ${reviewedCount}/${obligationCount} source-period obligations reviewed, expected 192/192.`);
    }
    // Checkpoint B fix 2: 192/192 is only truthful if every one of those
    // REVIEWED rows is genuinely bound to the real ActivityEntry it
    // reviews — never a REVIEWED status floating free of any submission.
    const linkedReviewedCount = await prisma.carbonSourcePeriodObligation.count({
      where: {
        organisationId,
        month: { startsWith: "2026" },
        status: "REVIEWED",
        submittedActivityEntryId: { not: null },
        reviewedByMembershipId: { not: null },
        reviewFingerprint: { not: null },
      },
    });
    if (linkedReviewedCount !== 192) {
      throw new Error(`Reconciliation failed: only ${linkedReviewedCount}/192 REVIEWED obligations are bound to a real submitted activity entry with a recorded reviewer and fingerprint.`);
    }

    // A genuine, comparable prior-year (2025) obligation set — never just
    // the current year's coverage with nothing to compare it against.
    const priorObligationCount = await prisma.carbonSourcePeriodObligation.count({ where: { organisationId, month: { startsWith: "2025" } } });
    const priorLinkedReviewedCount = await prisma.carbonSourcePeriodObligation.count({
      where: { organisationId, month: { startsWith: "2025" }, status: "REVIEWED", submittedActivityEntryId: { not: null } },
    });
    if (priorObligationCount === 0 || priorLinkedReviewedCount !== priorObligationCount) {
      throw new Error(`Reconciliation failed: prior-year comparable obligations are ${priorLinkedReviewedCount}/${priorObligationCount} reviewed and linked, expected a fully reviewed, non-empty comparable set.`);
    }

    for (const [key, expectedSha] of (await import("./evidence")).buildSyntheticEvidence().map((f) => [f.key, f.sha256] as const)) {
      const evidenceId = this.evidenceIdByKey.get(key);
      if (!evidenceId) throw new Error(`Reconciliation failed: evidence "${key}" was never stored.`);
      const row = await prisma.evidenceObject.findUniqueOrThrow({ where: { id: evidenceId } });
      if (row.checksumSha256 !== expectedSha) throw new Error(`Reconciliation failed: evidence "${key}" checksum does not match its generated bytes.`);
    }

    // Checkpoint B fix 7: the invoice/meter-reading SourceDocuments must
    // each be linked to a real ActivityEntry (never floating evidence) and
    // recomputing their expected bytes from that entry's *current* persisted
    // fields must match what was actually stored — never a placeholder.
    if (!this.invoiceSourceDocumentId) throw new Error("Reconciliation failed: the electricity invoice source document was never created.");
    const invoiceDoc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: this.invoiceSourceDocumentId } });
    const invoiceLinkedEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId, sourceDocumentId: invoiceDoc.id } });
    const expectedInvoiceBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic energy invoice\n\nSite: North Works. Period: January 2026. Metered electricity: ${invoiceLinkedEntry.canonicalValue.toString()} ${invoiceLinkedEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    if (invoiceDoc.sha256 !== createHash("sha256").update(expectedInvoiceBytes).digest("hex")) {
      throw new Error("Reconciliation failed: the electricity invoice's stored bytes no longer match its linked activity entry.");
    }

    if (!this.meterReadingSourceDocumentId) throw new Error("Reconciliation failed: the meter-reading source document was never created.");
    const meterDoc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: this.meterReadingSourceDocumentId } });
    const meterLinkedEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId, sourceDocumentId: meterDoc.id } });
    const expectedMeterBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic meter reading\n\nSite: East Cards. Period: February 2026. Observed electricity consumption: ${meterLinkedEntry.canonicalValue.toString()} ${meterLinkedEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    if (meterDoc.sha256 !== createHash("sha256").update(expectedMeterBytes).digest("hex")) {
      throw new Error("Reconciliation failed: the meter reading's stored bytes no longer match its linked activity entry.");
    }

    if (!this.lcaAssessmentId || !this.lcaScenarioId) throw new Error("Reconciliation failed: LCA assessment/scenario missing.");
    const [baselineRun, scenarioRun] = await Promise.all([getLatestRun(this.lcaAssessmentId), getLatestRun(this.lcaScenarioId)]);
    if (!baselineRun || !scenarioRun) throw new Error("Reconciliation failed: LCA baseline/scenario has no calculated run.");
    const baselinePerFu = runTotals(baselineRun).headlinePerFunctionalUnitKgCo2e;
    const scenarioPerFu = runTotals(scenarioRun).headlinePerFunctionalUnitKgCo2e;
    if (Math.abs(baselinePerFu - 0.12) > 0.0005 || Math.abs(scenarioPerFu - 0.102) > 0.0005) {
      throw new Error(`Reconciliation failed: LCA baseline/scenario is ${baselinePerFu}/${scenarioPerFu} kgCO2e/card, expected 0.120/0.102.`);
    }

    if (!this.managementPackId) throw new Error("Reconciliation failed: management pack was never issued.");
    const pack = await prisma.managementReviewPack.findUniqueOrThrow({ where: { id: this.managementPackId } });
    if (pack.status !== "ISSUED") throw new Error("Reconciliation failed: management pack is not issued.");

    if (!this.boardManagementPackId) throw new Error("Reconciliation failed: the board management pack (FrozenBoardPack) was never issued.");
    const boardPack = await prisma.boardManagementPack.findUniqueOrThrow({ where: { id: this.boardManagementPackId } });
    if (boardPack.status !== "ISSUED") throw new Error("Reconciliation failed: the board management pack is not issued.");
    const boardPackBody = boardPack.snapshot as unknown as { decisions: unknown[]; sourceRevisions: unknown[] };
    if (!Array.isArray(boardPackBody.decisions) || boardPackBody.decisions.length === 0) {
      throw new Error("Reconciliation failed: the board management pack has no linked decisions.");
    }
    if (!Array.isArray(boardPackBody.sourceRevisions) || boardPackBody.sourceRevisions.length === 0) {
      throw new Error("Reconciliation failed: the board management pack has no pinned source revisions.");
    }

    if (!this.nonconformityId) throw new Error("Reconciliation failed: EMS chain nonconformity is missing.");
    const nc = await prisma.nonconformity.findUniqueOrThrow({ where: { id: this.nonconformityId } });
    if (nc.status !== "CLOSED") throw new Error(`Reconciliation failed: EMS chain nonconformity should be CLOSED, is ${nc.status}.`);

    // Checkpoint B fix 7: the internal requirement genuinely carries an
    // obligation revision (ACTIVE, approved) and an issued evaluation
    // (with a recorded, evidenced item outcome) — never just a bare
    // OtherRequirementSource.
    const obligation = await prisma.complianceObligation.findFirstOrThrow({ where: { organisationId } });
    const obligationVersion = await prisma.complianceObligationVersion.findFirstOrThrow({ where: { organisationId, obligationId: obligation.id } });
    if (obligationVersion.status !== "ACTIVE") {
      throw new Error(`Reconciliation failed: the compliance obligation version should be ACTIVE, is ${obligationVersion.status}.`);
    }
    const evaluationItem = await prisma.complianceEvaluationItem.findFirstOrThrow({
      where: { organisationId, obligationVersionId: obligationVersion.id },
    });
    if (evaluationItem.status !== "PARTIALLY_COMPLIANT" || !evaluationItem.evaluatedAt) {
      throw new Error("Reconciliation failed: the compliance evaluation item has no genuine recorded outcome.");
    }
    const evaluation = await prisma.complianceEvaluation.findUniqueOrThrow({ where: { id: evaluationItem.evaluationId } });
    if (evaluation.status !== "ISSUED") {
      throw new Error(`Reconciliation failed: the compliance evaluation should be ISSUED, is ${evaluation.status}.`);
    }

    // Checkpoint B fix 7: the nonconformity's source finding genuinely
    // reached CONFIRMED through the real finding lifecycle, and the audit
    // that raised it genuinely reached REPORT_ISSUED through the real
    // report lifecycle — never a directly stamped terminal status.
    if (nc.sourceType !== "AUDIT_FINDING" || !nc.sourceId) {
      throw new Error("Reconciliation failed: the EMS chain nonconformity is not genuinely sourced from an audit finding.");
    }
    const finding = await prisma.auditFinding.findUniqueOrThrow({ where: { id: nc.sourceId } });
    if (finding.status !== "CONFIRMED") throw new Error(`Reconciliation failed: the audit finding should be CONFIRMED, is ${finding.status}.`);
    const audit = await prisma.emsAudit.findUniqueOrThrow({ where: { id: finding.auditId } });
    if (audit.status !== "REPORT_ISSUED") throw new Error(`Reconciliation failed: the audit should be REPORT_ISSUED, is ${audit.status}.`);

    const summary = {
      organisationId,
      currentKg: currentTotal,
      previousKg: priorTotal,
      marketBasedScope2Kg: marketCompanion,
      obligationsReviewed: `${reviewedCount}/${obligationCount}`,
      lcaBaselinePerFunctionalUnitKgCo2e: baselinePerFu,
      lcaScenarioPerFunctionalUnitKgCo2e: scenarioPerFu,
      managementPackId: pack.id,
      managementPackChecksum: pack.checksumSha256,
      boardManagementPackId: boardPack.id,
      boardManagementPackChecksum: boardPack.payloadSha256,
      nonconformityStatus: nc.status,
    };
    const digest = createHash("sha256").update(JSON.stringify(summary)).digest("hex");
    return { digest };
  }

  /** CAS from BUILDING only — never overwrites an already-READY or somehow-reverted-to-NONE row. */
  async markFixtureReady(version: string, digest: string): Promise<void> {
    trace("markFixtureReady start");
    const { count } = await prisma.demoFixtureLease.updateMany({
      where: { fixtureKey: version, status: "BUILDING" },
      data: { status: "READY", digest },
    });
    if (count === 0) {
      throw new Error(`Fixture "${version}" was not BUILDING when marking READY — refusing to overwrite an unexpected state.`);
    }
  }
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 * The disposable CI Postgres caps DATABASE_URL at connection_limit=6 (see
 * .github/workflows/checkpoint-a-postgres.yml), and withExclusiveFixtureLease
 * holds one of those for the whole seed — firing all 48 carbon targets at
 * once starved the pool and made the "parallel" version no faster than
 * sequential. A small bounded concurrency gets the real speedup without
 * exhausting the pool.
 */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function monthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
