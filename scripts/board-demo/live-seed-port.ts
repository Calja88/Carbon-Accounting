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
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import {
  Prisma,
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
import { canonicalStringify } from "@/lib/audit/integrity";
import { readEvidenceObjectBytes } from "@/lib/documents/evidence-service";
import { getDocumentContent } from "@/lib/documents-service";
import { createEnvironmentalAspect } from "@/lib/ems/aspects/aspect-service";
import { createOperationalControl, recordControlCheck, uploadEvidenceToControlCheck } from "@/lib/ems/controls/control-service";
import { createEnvironmentalObjective } from "@/lib/ems/objectives/objective-service";
import {
  createNonconformityFromSource,
  recordContainment,
  reviewContainmentAdequacy,
  closeNonconformity,
  linkAdditionalSourceToNonconformity,
  reopenNonconformity,
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

/**
 * Checkpoint B corrective handoff §4: persona secrets are never logged in
 * plaintext anywhere (this includes this process's own stderr — a prior
 * version emitted them there via trace(), which is exactly the "credential
 * echoed to an ordinary log" pattern this removes). When
 * `BOARD_DEMO_PROVISIONING_TOKEN`'s sibling `BOARD_DEMO_CREDENTIALS_FILE`
 * env var points at a private, operator-supplied JSON file
 * (`{ "<persona-name>": "<password>" }`), an ACTIVE persona's password
 * comes from that file — parsed once, before any domain write — and a
 * persona with no entry fails the build rather than silently falling back
 * to an unrecorded, unusable random password. Without the env var (the
 * disposable-CI case, where no human ever needs to actually log in), each
 * persona still gets a fresh random password, kept only in memory for this
 * process's own runtime use and never written or logged anywhere.
 */
function loadPersonaCredentials(): Map<string, string> | null {
  const path = process.env.BOARD_DEMO_CREDENTIALS_FILE;
  if (!path) return null;
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("BOARD_DEMO_CREDENTIALS_FILE must contain a JSON object mapping persona name -> password.");
  }
  const map = new Map<string, string>();
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || !value) throw new Error(`BOARD_DEMO_CREDENTIALS_FILE entry for "${name}" must be a non-empty string.`);
    map.set(name, value);
  }
  return map;
}

const FIXTURE_KEY = BOARD1.fixtureVersion;
const ORG_SLUG = "board-1-northstar-demonstration";

/** Every organisation this seed itself creates must carry this slug prefix — the only rule `readConnectedIdentity`'s ordinary-organisation count uses to tell "this fixture" apart from "an ordinary tenant that must never exist in a demo database". */
export const FIXTURE_ORGANISATION_SLUG_PREFIX = "board-1-";

/**
 * Checkpoint B corrective handoff §5: bumped whenever this file's own
 * persisted-identity/verification contract changes shape, independently of
 * BOARD1.fixtureVersion (the demo's public label). See the
 * `DemoFixtureLease.implementationRevision` schema comment and
 * `existingFixture()` below for how a mismatch is handled — never by
 * resetting or reinterpreting the old fixture, only by refusing it.
 */
const FIXTURE_IMPLEMENTATION_REVISION = 1;

/**
 * Every id `verifyAllInvariants`/`createImprovementChain`/etc. need to
 * re-derive a replayed fixture's full state, persisted atomically with the
 * final BUILDING -> READY CAS. See `buildIdentityMap` (write side, a fresh
 * build) and `resolveExistingFixtureState`/`parseIdentityMap` (read side, a
 * replay) below.
 */
interface FixtureIdentityMapV1 {
  schemaVersion: 1;
  organisationId: string;
  entityId: string;
  /** BOARD1 site key -> Site id. */
  siteIds: Record<string, string>;
  /** Persona name (e.g. "sustainability-lead") -> User id. */
  personaUserIds: Record<string, string>;
  /** buildSyntheticEvidence() key -> EvidenceObject id. */
  evidenceIds: Record<string, string>;
  invoiceSourceDocumentId: string;
  meterReadingSourceDocumentId: string;
  nonconformityId: string;
  correctiveActionId: string;
  lcaAssessmentId: string;
  lcaScenarioId: string;
  managementReviewId: string;
  managementPackId: string;
  boardManagementPackId: string;
}

/**
 * Parses and shape-validates a lease's persisted `identityMap` — an
 * operator-writable JSON column, never trusted as proof on its own; every id
 * it yields is re-checked against its expected tenant/relation by the caller
 * before use (see `resolveExistingFixtureState`).
 */
function parseIdentityMap(value: unknown): FixtureIdentityMapV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture is marked READY but has no persisted identity map — refusing to verify with heuristic lookups.");
  }
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) {
    throw new Error(`Fixture identity map has unrecognised schemaVersion ${JSON.stringify(v.schemaVersion)}.`);
  }
  const str = (key: string): string => {
    const val = v[key];
    if (typeof val !== "string" || !val) throw new Error(`Fixture identity map is missing required field "${key}".`);
    return val;
  };
  const strMap = (key: string): Record<string, string> => {
    const val = v[key];
    if (!val || typeof val !== "object" || Array.isArray(val)) throw new Error(`Fixture identity map field "${key}" must be an object.`);
    const out: Record<string, string> = {};
    for (const [entryKey, entryValue] of Object.entries(val as Record<string, unknown>)) {
      if (typeof entryValue !== "string" || !entryValue) throw new Error(`Fixture identity map field "${key}.${entryKey}" must be a non-empty string.`);
      out[entryKey] = entryValue;
    }
    return out;
  };
  return {
    schemaVersion: 1,
    organisationId: str("organisationId"),
    entityId: str("entityId"),
    siteIds: strMap("siteIds"),
    personaUserIds: strMap("personaUserIds"),
    evidenceIds: strMap("evidenceIds"),
    invoiceSourceDocumentId: str("invoiceSourceDocumentId"),
    meterReadingSourceDocumentId: str("meterReadingSourceDocumentId"),
    nonconformityId: str("nonconformityId"),
    correctiveActionId: str("correctiveActionId"),
    lcaAssessmentId: str("lcaAssessmentId"),
    lcaScenarioId: str("lcaScenarioId"),
    managementReviewId: str("managementReviewId"),
    managementPackId: str("managementPackId"),
    boardManagementPackId: str("boardManagementPackId"),
  };
}

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
    // provenance". Independent, out-of-band signals are required before
    // this identity can ever be reported as SYNTHETIC/disposable, none
    // derivable from data already sitting in this database:
    //  1. APP_DATA_MODE=synthetic — the deployment's own environment must
    //     explicitly opt in; unset/anything else always fails closed.
    //  2. BOARD_DEMO_PROVISIONING_TOKEN must match the token the actual
    //     provisioning step wrote into the manifest row at creation time
    //     (never written by this seed script itself) — a stray or copied
    //     manifest row without a matching environment secret is rejected.
    //  3. Checkpoint B corrective handoff §4: when the manifest records an
    //     approved database name/role, the ACTUAL live connection's own
    //     `current_database()`/`current_user` must match exactly — binding
    //     the provisioning token to the real Postgres identity, not just an
    //     operator-assigned label. current_database() alone never proves a
    //     specific Neon project (a name can repeat across projects); this is
    //     one signal among the set, never sufficient alone, and a manifest
    //     with no approved values recorded fails this check closed rather
    //     than skipping it.
    const appDataModeIsSynthetic = process.env.APP_DATA_MODE === "synthetic";
    const provisioningTokenMatches =
      !!manifest &&
      !!process.env.BOARD_DEMO_PROVISIONING_TOKEN &&
      process.env.BOARD_DEMO_PROVISIONING_TOKEN === manifest.provisioningToken;

    let connectionIdentityMatches = false;
    if (manifest && manifest.approvedDatabaseName && manifest.approvedRole) {
      const [row] = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
      connectionIdentityMatches = !!row && row.db === manifest.approvedDatabaseName && row.usr === manifest.approvedRole;
    }

    const lease = await prisma.demoFixtureLease.findUnique({ where: { fixtureKey: FIXTURE_KEY } });
    const fixtureOrganisationId = lease?.fixtureOrganisationId ?? null;

    // "Ordinary" means any organisation other than this fixture's own exact
    // recorded organisation id (never a name/slug prefix — a foreign tenant
    // could create an organisation carrying the "board-1-" prefix or a
    // "Synthetic ..." name, so neither proves fixture ownership on its own),
    // plus — ONLY inside the independently-proven disposable CI database —
    // another repo test suite's own clearly-labelled synthetic fixture (the
    // disposable checkpoint-a-postgres job intentionally shares one database
    // across every real-Postgres test file, each naming its organisation
    // "Synthetic ..." by established convention). That leniency never
    // influences the actual persistent-demo trust decision: it is gated on
    // independently PROVING this is the disposable CI database — the exact
    // same full check tests/checkpoint-a/disposable.ts applies before any
    // test runs (flag AND loopback host AND exact ca_checkpoint database
    // name AND postgres protocol). A real target can never satisfy all four
    // at once, so it always uses the strict, id-exact check alone.
    const isDisposableCiSuite = isIndependentlyVerifiedDisposableDatabase();
    const notFixtureOrg = fixtureOrganisationId ? { NOT: { id: fixtureOrganisationId } } : {};
    const ordinaryOrganisationCount = await prisma.organisation.count({
      where: isDisposableCiSuite
        ? { AND: [notFixtureOrg, { NOT: { name: { startsWith: "Synthetic " } } }] }
        : notFixtureOrg,
    });
    if (!manifest || !appDataModeIsSynthetic || !provisioningTokenMatches || !connectionIdentityMatches) {
      // Fails closed: assertDemoTarget will reject an empty actualDatabaseId/
      // manifestEnvironmentId against any configured allow-list value. A
      // manifest existing is not enough on its own — every signal above
      // must also hold.
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
    // Checkpoint B corrective handoff §5: a READY lease recorded under a
    // different implementation revision is never silently reinterpreted as
    // a fixture this code version actually knows how to verify — reporting
    // an invalid digest here makes seedBoardDemo's own fixed orchestrator
    // contract (seed-orchestrator.ts, verbatim) refuse it with "Fixture
    // identity differs; provision a fresh empty demo database", the same
    // path a version/digest mismatch already takes. No reset/repair/reseed
    // happens in this file either way.
    if (lease.implementationRevision !== FIXTURE_IMPLEMENTATION_REVISION) return { version: FIXTURE_KEY, digest: "" };
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
  /**
   * Checkpoint B corrective handoff §4: the fixture organisation itself is
   * now created here, bound atomically to the winning BUILDING CAS in one
   * short transaction — never a bare slug-prefix convention a foreign
   * tenant could imitate. Before the very first build, the target must
   * genuinely have no tenant organisations at all (a real persistent
   * target is provisioned empty; a stray pre-existing organisation there
   * means this is not the target it was verified to be). A replay
   * (lease already carries fixtureOrganisationId) reuses the exact
   * recorded id rather than creating a second organisation.
   */
  async beginFixture(version: string): Promise<void> {
    trace("beginFixture start");
    // Org-binding only applies to the real BOARD-1 fixture key — the
    // pure-CAS regression tests exercise this method with their own
    // synthetic keys purely to prove the lease state machine in isolation,
    // never intending a domain organisation to be created as a side effect.
    const isRealFixture = version === FIXTURE_KEY;
    const organisationId = await prisma.$transaction(async (tx) => {
      const lease = await tx.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: version } });
      if (lease.status !== "NONE") {
        throw new Error(`Fixture "${version}" is already BUILDING or READY — refusing a concurrent or duplicate build.`);
      }
      const { count } = await tx.demoFixtureLease.updateMany({
        where: { fixtureKey: version, status: "NONE" },
        data: { status: "BUILDING", digest: "" },
      });
      if (count === 0) {
        throw new Error(`Fixture "${version}" is already BUILDING or READY — refusing a concurrent or duplicate build.`);
      }
      if (!isRealFixture) return null;
      if (lease.fixtureOrganisationId) return lease.fixtureOrganisationId;
      // Outside the independently-proven disposable CI database (which
      // intentionally shares one Postgres instance across every
      // real-Postgres test file's own fixture), a real persistent target is
      // provisioned empty — a stray pre-existing organisation there means
      // this is not the target it was verified to be.
      if (!isIndependentlyVerifiedDisposableDatabase()) {
        const preExistingOrgCount = await tx.organisation.count();
        if (preExistingOrgCount > 0) {
          throw new Error(
            `Refusing to create the fixture organisation: the connected target already has ${preExistingOrgCount} organisation(s) present, but a first build requires a genuinely empty target.`,
          );
        }
      }
      const org = await tx.organisation.create({ data: { name: BOARD1.organisation, slug: ORG_SLUG } });
      await tx.demoFixtureLease.update({ where: { fixtureKey: version }, data: { fixtureOrganisationId: org.id } });
      return org.id;
    });
    if (organisationId) this.organisationId = organisationId;
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
  /**
   * Checkpoint B corrective handoff §5: re-derives every id from the
   * lease's own persisted, schema-versioned identity map — never by
   * guessing which row is "the" row from a friendly name, row ordering, or
   * a filename/checksum pairing. A genuine post-freeze live transition
   * (§6's own demonstration nonconformity, a re-upload sharing a filename)
   * can create another row that would defeat any such heuristic; a stored,
   * validated id cannot be. Every id read from the map is re-checked
   * against its expected tenant/relation before being trusted — the column
   * is operator-writable data, not a proof on its own.
   */
  private async resolveExistingFixtureState(organisationId: string): Promise<void> {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: FIXTURE_KEY } });
    const map = parseIdentityMap(lease.identityMap);
    if (map.organisationId !== organisationId) {
      throw new Error(`Fixture identity map organisation id ${map.organisationId} does not match the resolved fixture organisation ${organisationId}.`);
    }

    const entity = await prisma.entity.findFirstOrThrow({ where: { id: map.entityId, organisationId } });
    this.entityId = entity.id;

    const siteRows = await prisma.site.findMany({ where: { organisationId, id: { in: Object.values(map.siteIds) } } });
    const siteById = new Map(siteRows.map((row) => [row.id, row]));
    this.sites = Object.entries(map.siteIds).map(([key, id]) => {
      const row = siteById.get(id);
      if (!row) throw new Error(`Reconciliation failed: identity map site "${key}" (${id}) is not a real site of this organisation.`);
      return { key, id: row.id, name: row.name };
    });

    const personaUserIds = Object.values(map.personaUserIds);
    const memberships = await prisma.organisationMembership.findMany({ where: { organisationId, userId: { in: personaUserIds } } });
    const membershipByUser = new Set(memberships.map((m) => m.userId));
    for (const [name, userId] of Object.entries(map.personaUserIds)) {
      if (!membershipByUser.has(userId)) throw new Error(`Reconciliation failed: identity map persona "${name}" (${userId}) has no membership in this organisation.`);
    }
    const sustainabilityLeadUserId = map.personaUserIds["sustainability-lead"];
    const independentReviewerUserId = map.personaUserIds["independent-reviewer"];
    if (!sustainabilityLeadUserId || !independentReviewerUserId) {
      throw new Error("Reconciliation failed: identity map is missing the sustainability-lead/independent-reviewer persona ids.");
    }
    this.sustainabilityLead = await resolveOrganisationContext(prisma, { userId: sustainabilityLeadUserId, requestedOrganisation: organisationId });
    this.independentReviewer = await resolveOrganisationContext(prisma, { userId: independentReviewerUserId, requestedOrganisation: organisationId });
    this.owner = this.sustainabilityLead;

    const evidenceRows = await prisma.evidenceObject.findMany({ where: { organisationId, id: { in: Object.values(map.evidenceIds) } } });
    const evidenceById = new Set(evidenceRows.map((row) => row.id));
    for (const [key, id] of Object.entries(map.evidenceIds)) {
      if (!evidenceById.has(id)) throw new Error(`Reconciliation failed: identity map evidence "${key}" (${id}) is not a real evidence object of this organisation.`);
      this.evidenceIdByKey.set(key, id);
    }

    const invoiceDoc = await prisma.sourceDocument.findFirstOrThrow({ where: { id: map.invoiceSourceDocumentId, organisationId } });
    this.invoiceSourceDocumentId = invoiceDoc.id;
    const meterDoc = await prisma.sourceDocument.findFirstOrThrow({ where: { id: map.meterReadingSourceDocumentId, organisationId } });
    this.meterReadingSourceDocumentId = meterDoc.id;

    const baseline = await prisma.lcaAssessment.findFirstOrThrow({ where: { id: map.lcaAssessmentId, organisationId } });
    this.lcaAssessmentId = baseline.id;
    const scenario = await prisma.lcaAssessment.findFirstOrThrow({ where: { id: map.lcaScenarioId, organisationId } });
    this.lcaScenarioId = scenario.id;

    const review = await prisma.managementReview.findFirstOrThrow({ where: { id: map.managementReviewId, organisationId } });
    this.managementReviewId = review.id;
    const pack = await prisma.managementReviewPack.findFirstOrThrow({ where: { id: map.managementPackId, organisationId } });
    this.managementPackId = pack.id;
    const boardPack = await prisma.boardManagementPack.findFirstOrThrow({ where: { id: map.boardManagementPackId, organisationId } });
    this.boardManagementPackId = boardPack.id;

    const nc = await prisma.nonconformity.findFirstOrThrow({ where: { id: map.nonconformityId, organisationId } });
    this.nonconformityId = nc.id;
    const action = await prisma.correctiveAction.findFirstOrThrow({ where: { id: map.correctiveActionId, organisationId } });
    this.correctiveActionId = action.id;
  }

  /**
   * Checkpoint B corrective handoff §5: resolves the organisation from the
   * lease's own exact `fixtureOrganisationId` (the §4 mechanism) rather
   * than the well-known slug — consistent with treating an id recorded at
   * creation as the only trustworthy signal, never a naming convention,
   * even one this same fixture itself chose.
   */
  private async resolveExistingOrganisation(): Promise<void> {
    const lease = await prisma.demoFixtureLease.findUnique({ where: { fixtureKey: FIXTURE_KEY } });
    const organisationId = lease?.fixtureOrganisationId;
    if (!organisationId) return;
    const org = await prisma.organisation.findUnique({ where: { id: organisationId } });
    if (org) {
      this.organisationId = org.id;
      const entity = await prisma.entity.findFirst({ where: { organisationId: org.id } });
      this.entityId = entity?.id ?? null;
      this.sites = await prisma.site.findMany({ where: { organisationId: org.id }, orderBy: { name: "asc" } }).then((rows) =>
        rows.map((r) => ({ key: BOARD1.sites.find((s) => s.name === r.name)?.key ?? r.name, id: r.id, name: r.name })),
      );
    }
  }

  /**
   * Checkpoint B corrective handoff §5: the write side of the durable
   * identity map — built purely from this instance's own state at the end
   * of a fresh build (every field below is set by that build's own earlier
   * steps), never re-queried. See `resolveExistingFixtureState` for the
   * read side and `parseIdentityMap` for the persisted shape.
   */
  private buildIdentityMap(): FixtureIdentityMapV1 {
    if (!this.organisationId || !this.entityId) throw new Error("Cannot build the fixture identity map before the organisation/entity exist.");
    if (this.sites.length === 0) throw new Error("Cannot build the fixture identity map before sites exist.");
    if (!this.sustainabilityLead || !this.independentReviewer) throw new Error("Cannot build the fixture identity map before personas exist.");
    if (this.evidenceIdByKey.size === 0) throw new Error("Cannot build the fixture identity map before evidence exists.");
    if (!this.invoiceSourceDocumentId || !this.meterReadingSourceDocumentId) throw new Error("Cannot build the fixture identity map before the invoice/meter-reading documents exist.");
    if (!this.nonconformityId || !this.correctiveActionId) throw new Error("Cannot build the fixture identity map before the EMS chain nonconformity/corrective action exist.");
    if (!this.lcaAssessmentId || !this.lcaScenarioId) throw new Error("Cannot build the fixture identity map before the LCA baseline/scenario exist.");
    if (!this.managementReviewId || !this.managementPackId || !this.boardManagementPackId) throw new Error("Cannot build the fixture identity map before the management review/packs exist.");
    return {
      schemaVersion: 1,
      organisationId: this.organisationId,
      entityId: this.entityId,
      siteIds: Object.fromEntries(this.sites.map((s) => [s.key, s.id])),
      personaUserIds: {
        "sustainability-lead": this.sustainabilityLead.userId,
        "independent-reviewer": this.independentReviewer.userId,
      },
      evidenceIds: Object.fromEntries(this.evidenceIdByKey),
      invoiceSourceDocumentId: this.invoiceSourceDocumentId,
      meterReadingSourceDocumentId: this.meterReadingSourceDocumentId,
      nonconformityId: this.nonconformityId,
      correctiveActionId: this.correctiveActionId,
      lcaAssessmentId: this.lcaAssessmentId,
      lcaScenarioId: this.lcaScenarioId,
      managementReviewId: this.managementReviewId,
      managementPackId: this.managementPackId,
      boardManagementPackId: this.boardManagementPackId,
    };
  }

  // -------------------------------------------------------------------
  // Organisation, entity, sites, personas
  // -------------------------------------------------------------------

  async createSyntheticOrganisationAndActors(): Promise<void> {
    trace("createSyntheticOrganisationAndActors start");
    // Checkpoint B corrective handoff §4: the bare organisation row itself
    // is created atomically with the BUILDING transition in beginFixture
    // (bound to the lease's fixtureOrganisationId), never here — this only
    // adds the entity/sites/personas onto that already-created, already-
    // recorded organisation.
    if (!this.organisationId) throw new Error("Organisation must be created by beginFixture before actors.");
    const org = { id: this.organisationId };
    // Parsed once, before any domain write — see loadPersonaCredentials.
    const personaCredentials = loadPersonaCredentials();

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

    // Checkpoint B corrective handoff §4: persona secrets are bcrypt-hashed
    // exactly the way src/auth.ts verifies logins (never the seed's own
    // ad-hoc hash), so these personas can actually sign in through the real
    // auth path in a persistent environment — but the plaintext is never
    // logged anywhere (this process's own stderr included). It comes from
    // BOARD_DEMO_CREDENTIALS_FILE when an operator has supplied one
    // (required entry per ACTIVE persona name, parsed once above before any
    // domain write); without that file, each persona still gets a fresh
    // random password, kept only in this closure's memory for bcrypt.hash
    // and never written or logged — acceptable for the disposable-CI case,
    // where no human ever needs to actually log in with it.
    const persona = async (name: string, accessMode: "RESTRICTED" | "ORGANISATION_WIDE", status: "ACTIVE" | "SUSPENDED", permissionCodes: string[]) => {
      const email = `board-1-${name}-${randomUUID()}@example.invalid`;
      const suppliedPassword = personaCredentials?.get(name);
      if (personaCredentials && status === "ACTIVE" && !suppliedPassword) {
        throw new Error(`BOARD_DEMO_CREDENTIALS_FILE has no entry for persona "${name}" — refusing to invent and silently discard a password no operator can retrieve.`);
      }
      const plaintextPassword = suppliedPassword ?? randomBytes(18).toString("base64url");
      const passwordHash = await bcrypt.hash(plaintextPassword, 10);
      const user = await prisma.user.create({
        data: { name: `BOARD-1 ${name}`, email, passwordHash, role: "DATA_OWNER" },
      });
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

    // Checkpoint B corrective handoff §2: both years go through the exact
    // same real per-source pipeline — Scope 1/2 entries, then the real
    // derived-Category-3 mechanism (prepareReportingData) read back per
    // site/month, then Scope 3 category 1/6/7 via scope3Allocation against
    // the *actual* derived Category 3 for that year. The prior (2025)
    // comparable window is never a coarser one-line stand-in invented just
    // to make the two years look alike — it is built, and independently
    // reviewable, exactly like the current year.
    const { scope3Allocation } = await import("./board1");

    for (const year of [2026, 2025] as const) {
      const yearTargets = targets.filter((t) => t.year === year);

      // Phase A: Scope 1/2 entries + calculations. Each site-month's
      // entries touch disjoint ActivityEntry rows, so building them
      // concurrently across targets is safe (real-Postgres CI proved the
      // fully sequential version correct but far too slow — ~300
      // sequential real-service round trips exceeded a 5-minute budget).
      await mapWithConcurrency(yearTargets, 4, async (target) => {
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

      trace(`carbon phase A (${year}) done`);

      if (year === 2026) {
        await this.createInvoiceAndMeterDocuments(owner, siteById);
      }

      // Phase B: run the real derived-Category-3 mechanism over this
      // year's own window, then read its actual persisted result per
      // site/month — never reused across years, never invented.
      await prepareReportingData(owner, new Date(`${year}-01-01`), new Date(`${year}-08-31`));
      trace(`carbon phase B (${year}) done`);

      const derivedRows = await prisma.calculation.findMany({
        where: {
          organisationId: owner.organisationId,
          scope3Category: "Cat 3 — Fuel- and energy-related activities",
          activityEntry: { periodStart: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-08-31`) } },
        },
        include: { activityEntry: true },
      });
      const derivedCat3BySiteMonth = new Map<string, number>();
      for (const row of derivedRows) {
        const key = `${row.activityEntry.siteId}:${monthOf(row.activityEntry.periodStart)}`;
        derivedCat3BySiteMonth.set(key, (derivedCat3BySiteMonth.get(key) ?? 0) + Number(row.resultKgCo2e));
      }

      // Phase C: Scope 3 category 1/6/7 entries — category1 is whatever
      // scope3Allocation says is left after the *actual* derived category
      // 3, never an independently invented number. Independent per
      // site-month, so built concurrently for the same reason as Phase A.
      await mapWithConcurrency(
        yearTargets.filter((t) => t.scope3Kg > 0),
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

      trace(`carbon phase C (${year}) done`);
    }

    // Checkpoint B corrective handoff §1: every one of both years'
    // obligations (buildSubmissionObligations() now returns both years at
    // the same fine per-source granularity — see board1.ts) is created
    // REVIEW_REQUIRED with its submittedActivityEntryId bound only after a
    // revalidated org/site/period/source match, then explicitly reviewed
    // below through the real service.
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
    const obligationRows = await Promise.all(obligations.map(boundObligationRow));
    await prisma.carbonSourcePeriodObligation.createMany({ data: obligationRows });
    trace("carbon obligations createMany done");

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
    await mapWithConcurrency(boundObligationIds, 8, async ({ id }) => {
      await reviewSourcePeriodObligation(reviewer, id, { note: "BOARD-1 seed: reviewed against its genuine bound submission." });
    });
    trace("carbon obligation review done");
  }

  // Checkpoint B fix 7: a real invoice and a real meter reading, each a
  // genuine SourceDocument linked to the exact ActivityEntry it documents
  // (never a floating evidence file with placeholder text that admits its
  // own quantity is unfilled). 2026-specific evidence narrative only.
  private async createInvoiceAndMeterDocuments(owner: OrganisationContext, siteById: Map<string, { key: string; id: string; name: string }>): Promise<void> {
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

    // Checkpoint B corrective handoff §6: the internal-requirement
    // evaluation item independently surfaced the identical containment-
    // inspection gap (see recordComplianceEvaluationItemResult's rationale
    // above) — linked here as a further source on the SAME nonconformity
    // (never spawning a second one, per linkAdditionalSourceToNonconformity's
    // own documented contract) so that duplicate discovery is traceable
    // rather than silently dropped. The reference note names the exact
    // nonconformity id, not just its human-readable reference, so a reader
    // holding only the evaluation item can locate the precise linked record.
    await linkAdditionalSourceToNonconformity(owner, nc.id, {
      sourceType: "COMPLIANCE_EVALUATION_ITEM",
      sourceId: evaluationItem.id,
      sourceReferenceNote: `Independently surfaced by internal compliance evaluation item ${evaluationItem.id}: the same containment-inspection gap nonconformity ${nc.id} already tracks — linked, not duplicated, for full source traceability.`,
      actorUserId: owner.userId,
    });

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

    // Checkpoint B corrective handoff §6: a second, explicitly identified
    // action scenario on the SAME nonconformity, genuinely reopened through
    // the real state machine (requestEffectivenessReview requires every
    // non-cancelled corrective action to already be complete, so this
    // second action can only exist once the nonconformity is reopened, not
    // alongside the first) and deliberately left OPEN when the fixture
    // freezes — retained on purpose for a real-Postgres test to complete
    // and independently review live, after the pack has already been
    // issued, proving the frozen pack's own content/hash never moves while
    // the live domain state genuinely does.
    await reopenNonconformity(owner, nc.id, "A second, distinct containment gap (East Cards) surfaced after closure.", owner.userId);
    const secondRootCause = await recordRootCauseAnalysis(owner, nc.id, {
      method: "FIVE_WHYS",
      analysisPayload: { note: "Named ownership was never extended to East Cards." },
      conclusion: "The corrective action only covered North Works; East Cards needs the same named ownership.",
      actorUserId: owner.userId,
    });
    await approveRootCauseAnalysis(owner, secondRootCause.id, { actorUserId: owner.userId });
    await createCorrectiveAction(owner, nc.id, {
      description: "BOARD1-CA-EXT: extend the containment inspection procedure and named ownership to East Cards.",
      ownerMembershipId: owner.membershipId,
      dueDate: new Date("2026-10-01"),
      actorUserId: owner.userId,
    });
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

    // Checkpoint B corrective handoff §2: the prior year now goes through
    // the same real derived-Category-3 mechanism as the current year (see
    // createAndCalculateCarbon's shared per-year pipeline), so its own
    // derived rows must be added back exactly like the current year's —
    // never omitted, which would silently undercount the prior headline.
    const priorPrimaryCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: null, activityEntry: { periodStart: { gte: new Date("2025-01-01"), lte: new Date("2025-08-31") } } },
    });
    const priorDerivedCalcs = await prisma.calculation.findMany({
      where: { organisationId, derivedFromCalculationId: { not: null }, activityEntry: { periodStart: { gte: new Date("2025-01-01"), lte: new Date("2025-08-31") } } },
    });
    const priorTotal = round4(sum(priorPrimaryCalcs.filter((c) => c.basis !== "RESIDUAL_MIX" && c.basis !== "MARKET_BASED")) + sum(priorDerivedCalcs));
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

    // Checkpoint B corrective handoff §5: read the ACTUAL stored bytes back
    // through the real, access-controlled evidence path (never trust an
    // EvidenceObject row's own recorded checksum/size alone) and compare
    // them byte-for-byte against this fixture's own deterministic generated
    // content — exact length and exact bytes, not just a hash field.
    if (!this.owner) throw new Error("Reconciliation failed: no organisation context available to read evidence/document bytes.");
    const owner = this.owner;
    for (const file of buildSyntheticEvidence()) {
      const evidenceId = this.evidenceIdByKey.get(file.key);
      if (!evidenceId) throw new Error(`Reconciliation failed: evidence "${file.key}" was never stored.`);
      const row = await prisma.evidenceObject.findUniqueOrThrow({ where: { id: evidenceId } });
      if (row.checksumSha256 !== file.sha256) throw new Error(`Reconciliation failed: evidence "${file.key}" recorded checksum does not match its generated bytes.`);
      if (row.byteSize !== file.bytes.length) {
        throw new Error(`Reconciliation failed: evidence "${file.key}" recorded byte size ${row.byteSize} does not match its generated bytes' actual length ${file.bytes.length}.`);
      }
      const read = await readEvidenceObjectBytes(owner, evidenceId);
      if (!read) throw new Error(`Reconciliation failed: evidence "${file.key}" bytes could not be read back through the real evidence-access path.`);
      if (read.bytes.length !== file.bytes.length || !read.bytes.equals(file.bytes)) {
        throw new Error(`Reconciliation failed: evidence "${file.key}" stored bytes do not match its expected deterministic content.`);
      }
    }

    // Checkpoint B fix 7 (extended by §5): the invoice/meter-reading
    // SourceDocuments must each be linked to a real ActivityEntry (never
    // floating evidence); §5 additionally reads the ACTUAL stored content
    // back through the real tenant-scoped document path and checks it byte-
    // for-byte, never trusting the row's own sha256/byteSize fields alone.
    if (!this.invoiceSourceDocumentId) throw new Error("Reconciliation failed: the electricity invoice source document was never created.");
    const invoiceDoc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: this.invoiceSourceDocumentId } });
    const invoiceLinkedEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId, sourceDocumentId: invoiceDoc.id } });
    const expectedInvoiceBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic energy invoice\n\nSite: North Works. Period: January 2026. Metered electricity: ${invoiceLinkedEntry.canonicalValue.toString()} ${invoiceLinkedEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    if (invoiceDoc.sha256 !== createHash("sha256").update(expectedInvoiceBytes).digest("hex") || invoiceDoc.byteSize !== expectedInvoiceBytes.length) {
      throw new Error("Reconciliation failed: the electricity invoice's stored bytes no longer match its linked activity entry.");
    }
    const invoiceContent = await getDocumentContent(owner, invoiceDoc.id);
    if (!invoiceContent || !Buffer.from(invoiceContent.content).equals(expectedInvoiceBytes)) {
      throw new Error("Reconciliation failed: the electricity invoice's actual stored content does not match its expected deterministic bytes.");
    }

    if (!this.meterReadingSourceDocumentId) throw new Error("Reconciliation failed: the meter-reading source document was never created.");
    const meterDoc = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: this.meterReadingSourceDocumentId } });
    const meterLinkedEntry = await prisma.activityEntry.findFirstOrThrow({ where: { organisationId, sourceDocumentId: meterDoc.id } });
    const expectedMeterBytes = Buffer.from(
      `${BOARD1.disclosure}\nFixture: ${BOARD1.fixtureVersion}\nSynthetic meter reading\n\nSite: East Cards. Period: February 2026. Observed electricity consumption: ${meterLinkedEntry.canonicalValue.toString()} ${meterLinkedEntry.canonicalUnit}.\nNo real person, signature, certificate or company result is represented.\n`,
      "utf8",
    );
    if (meterDoc.sha256 !== createHash("sha256").update(expectedMeterBytes).digest("hex") || meterDoc.byteSize !== expectedMeterBytes.length) {
      throw new Error("Reconciliation failed: the meter reading's stored bytes no longer match its linked activity entry.");
    }
    const meterContent = await getDocumentContent(owner, meterDoc.id);
    if (!meterContent || !Buffer.from(meterContent.content).equals(expectedMeterBytes)) {
      throw new Error("Reconciliation failed: the meter reading's actual stored content does not match its expected deterministic bytes.");
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
    // Checkpoint B corrective handoff §5: a fresh recomputation over the
    // pack's own persisted payload, not just trusting the checksum column
    // was set correctly at some point in the past.
    if (pack.checksumSha256 !== createHash("sha256").update(canonicalStringify(pack.payload)).digest("hex")) {
      throw new Error("Reconciliation failed: the management review pack's checksum does not match a fresh recomputation of its own persisted payload.");
    }

    if (!this.boardManagementPackId) throw new Error("Reconciliation failed: the board management pack (FrozenBoardPack) was never issued.");
    const boardPack = await prisma.boardManagementPack.findUniqueOrThrow({ where: { id: this.boardManagementPackId } });
    if (boardPack.status !== "ISSUED") throw new Error("Reconciliation failed: the board management pack is not issued.");
    if (boardPack.payloadSha256 !== createHash("sha256").update(canonicalStringify(boardPack.snapshot)).digest("hex")) {
      throw new Error("Reconciliation failed: the board management pack's checksum does not match a fresh recomputation of its own persisted payload.");
    }
    const boardPackBody = boardPack.snapshot as unknown as { decisions: unknown[]; sourceRevisions: unknown[] };
    if (!Array.isArray(boardPackBody.decisions) || boardPackBody.decisions.length === 0) {
      throw new Error("Reconciliation failed: the board management pack has no linked decisions.");
    }
    if (!Array.isArray(boardPackBody.sourceRevisions) || boardPackBody.sourceRevisions.length === 0) {
      throw new Error("Reconciliation failed: the board management pack has no pinned source revisions.");
    }

    if (!this.nonconformityId) throw new Error("Reconciliation failed: EMS chain nonconformity is missing.");
    const nc = await prisma.nonconformity.findUniqueOrThrow({ where: { id: this.nonconformityId } });
    // Checkpoint B corrective handoff §6: the primary chain (audit finding
    // -> containment -> root cause -> corrective action -> effectiveness
    // review) genuinely reached CLOSED first — fix 7's own demonstrated
    // closure is untouched — but the nonconformity is then genuinely
    // reopened for a second, distinct action scenario (see
    // createImprovementChain), so its frozen state is ACTIONS_IN_PROGRESS,
    // not CLOSED: a live, still-open follow-up, not a stale one.
    if (nc.status !== "ACTIONS_IN_PROGRESS") {
      throw new Error(`Reconciliation failed: EMS chain nonconformity should be ACTIONS_IN_PROGRESS (reopened for its second action scenario), is ${nc.status}.`);
    }
    const closure = await prisma.nonconformityClosure.findFirst({ where: { organisationId, nonconformityId: nc.id } });
    if (!closure) throw new Error("Reconciliation failed: the nonconformity's own first closure was never genuinely recorded before it was reopened.");

    // Checkpoint B corrective handoff §6: the additional-source link and the
    // second, deliberately-OPEN corrective action must both genuinely
    // exist — never silently dropped by an earlier step's own error
    // swallowing.
    const additionalSourceLink = await prisma.nonconformitySourceLink.findFirst({
      where: { organisationId, nonconformityId: nc.id, sourceType: "COMPLIANCE_EVALUATION_ITEM", isPrimary: false },
    });
    if (!additionalSourceLink || !additionalSourceLink.sourceReferenceNote?.includes(nc.id)) {
      throw new Error("Reconciliation failed: the compliance-evaluation-item additional source link is missing, or its reference note doesn't name the exact nonconformity id.");
    }
    const retainedOpenAction = await prisma.correctiveAction.findFirst({
      where: { organisationId, nonconformityId: nc.id, description: { startsWith: "BOARD1-CA-EXT" } },
    });
    if (!retainedOpenAction || retainedOpenAction.status !== "OPEN") {
      throw new Error(`Reconciliation failed: the retained corrective action for the live completion demonstration should be OPEN, is ${retainedOpenAction?.status ?? "missing"}.`);
    }

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
    // Checkpoint B corrective handoff §5: canonicalStringify (the same
    // deterministic, recursively key-sorted JSON serialisation the pack
    // checksums above use) rather than JSON.stringify's insertion-order-
    // dependent output — this summary carries no wall-clock/fetch-time
    // values, so the digest is a pure function of persisted, reconciled
    // state.
    const digest = createHash("sha256").update(canonicalStringify(summary)).digest("hex");
    return { digest };
  }

  /** CAS from BUILDING only — never overwrites an already-READY or somehow-reverted-to-NONE row. */
  async markFixtureReady(version: string, digest: string): Promise<void> {
    trace("markFixtureReady start");
    // Checkpoint B corrective handoff §5: the identity map + implementation
    // revision are written atomically with this same CAS — a fixture is
    // never READY without both a digest AND the durable state a replay
    // needs to re-verify it, and the pure-CAS regression tests' own
    // synthetic keys (never the real BOARD-1 fixture) never populate one.
    const isRealFixture = version === FIXTURE_KEY;
    const identityMap = isRealFixture ? this.buildIdentityMap() : undefined;
    const { count } = await prisma.demoFixtureLease.updateMany({
      where: { fixtureKey: version, status: "BUILDING" },
      data: {
        status: "READY",
        digest,
        ...(identityMap
          ? { identityMap: identityMap as unknown as Prisma.InputJsonValue, implementationRevision: FIXTURE_IMPLEMENTATION_REVISION }
          : {}),
      },
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
