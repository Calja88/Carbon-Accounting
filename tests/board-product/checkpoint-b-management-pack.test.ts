/**
 * Checkpoint B required fix 8 (frozen management pack / concurrency),
 * against real PostgreSQL. Runs after bd08-board1-seed.test.ts, so the
 * real BOARD-1 management pack (with its board section) already exists at
 * ISSUED.
 *
 * Checkpoint B corrective handoff §7: the board-sprint's own frozen pack is
 * no longer a standalone `BoardManagementPack` row — it is a validated
 * `board` section of the SAME `ManagementReviewPack` this file already
 * exercised for fix 8, sharing its one issue/status/audit lifecycle and one
 * canonical checksum. generateBoardManagementPack/issueBoardManagementPack
 * now take a real `reviewId`, not a bare `reference`.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import {
  generateBoardManagementPack,
  issueBoardManagementPack,
  getBoardManagementPack,
  type GenerateBoardManagementPackInput,
} from "@/lib/board/live-management-pack";
import { ManagementReviewPackError, generateManagementReviewPack, issueManagementReviewPack } from "@/lib/ems/review/pack-service";
import { scheduleManagementReview, startManagementReviewInputCollection } from "@/lib/ems/review/review-service";
import { createNonconformityFromSource, recordContainment } from "@/lib/ems/nonconformity/nonconformity-service";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const tag = randomUUID();
const grants = ["carbon.view", "ems.view", "ems.management_review.manage"];

async function membership(org: string, name: string) {
  // Each call must get its own email — this helper is called once per test
  // (not once per file), and a shared `${tag}-${name}` would collide across
  // the two "owner" memberships created by the two race tests below (CI-
  // discovered: unique constraint failed on `email`).
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}-${randomUUID()}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: grants.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

/** A real ManagementReview in INPUT_COLLECTION, the only state a pack can be generated/issued against. */
async function reviewInInputCollection(owner: OrganisationContext, reference: string): Promise<string> {
  const template = await prisma.managementReviewAgendaTemplate.create({
    data: { organisationId: owner.organisationId, templateKey: `${reference}-agenda`, name: `${reference} agenda` },
  });
  const version = await prisma.managementReviewAgendaTemplateVersion.create({
    data: { organisationId: owner.organisationId, templateId: template.id, version: 1, name: "v1", status: "APPROVED", preparedByUserId: owner.userId },
  });
  const review = await scheduleManagementReview(owner, {
    reference,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-01-31"),
    cutoffDate: new Date("2026-01-31"),
    scheduledDate: new Date("2026-02-01"),
    chairMembershipId: owner.membershipId,
    coordinatorMembershipId: owner.membershipId,
    agendaTemplateVersionId: version.id,
    actorUserId: owner.userId,
  });
  await startManagementReviewInputCollection(owner, review.id, owner.userId);
  return review.id;
}

function boardInput(reviewId: string, actorUserId: string): GenerateBoardManagementPackInput {
  return {
    reviewId,
    reference: `RACE-${randomUUID()}`,
    overviewWindow: { from: "2026-01", to: "2026-01" },
    sourceRevisions: [{ id: "x", kind: "probe", revision: "1", label: "Probe", href: "/probe" as const }],
    decisions: [{ title: "t", rationale: "r", owner: "o", dueDate: null, status: "draft" as const }],
    actorUserId,
  };
}

describe("Checkpoint B fix 8 — the board management pack (FrozenBoardPack) is real and non-empty", () => {
  it("the issued BOARD-1 pack's board section has real linked decisions and pinned source revisions, not an empty snapshot", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const review = await prisma.managementReview.findFirstOrThrow({ where: { organisationId: org.id } });
    const owner = await resolveOrganisationContext(prisma, {
      userId: (await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } })).id,
      requestedOrganisation: org.id,
    });
    const pack = await getBoardManagementPack(owner, review.id);
    expect(pack).not.toBeNull();
    expect(pack!.status).toBe("issued");
    expect(pack!.decisions.length).toBeGreaterThan(0);
    expect(pack!.sourceRevisions.length).toBeGreaterThan(0);
    expect(pack!.snapshot.carbon.state).toBe("ready"); // a real Overview carbon snapshot, not a stub
    expect(pack!.inputs).toHaveLength(3);
    expect(pack!.inputs!.every((input) => input.revision && input.sourceRecordId)).toBe(true);
    expect(pack!.lca?.comparable).toBe(true);
    expect(pack!.lca?.baseline.kgPerUnit).toBeCloseTo(0.120, 6);
    expect(pack!.lca?.scenario.kgPerUnit).toBeCloseTo(0.102, 6);
    const snapshots = await prisma.managementReviewInputSnapshot.findMany({ where: { packId: pack!.id } });
    for (const snapshot of snapshots) {
      const definition = await prisma.managementReviewInputDefinition.findFirstOrThrow({ where: { organisationId: org.id, key: snapshot.inputDefinitionKey } });
      expect(snapshot.sourceType).toBe(definition.sourceType);
    }

    // The one management pack — never a second standalone BoardManagementPack row.
    const legacyRows = await prisma.boardManagementPack.count({ where: { organisationId: org.id } });
    expect(legacyRows).toBe(0);
  });

  it("a genuine live transition after freeze does not change the issued pack's payload or checksum", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const review = await prisma.managementReview.findFirstOrThrow({ where: { organisationId: org.id } });
    const owner = await resolveOrganisationContext(prisma, {
      userId: (await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } })).id,
      requestedOrganisation: org.id,
    });
    const before = await getBoardManagementPack(owner, review.id);
    expect(before).not.toBeNull();

    const newNc = await createNonconformityFromSource(owner, {
      reference: `BOARD1-NC-PACKPROBE-${randomUUID().slice(0, 8)}`,
      sourceType: "MANUAL",
      sourceReferenceNote: "Checkpoint B fix 8 probe.",
      statement: "Synthetic post-freeze nonconformity to prove the frozen board pack does not move.",
      requirementReference: "Monthly containment inspection — internal requirement",
      ownerMembershipId: owner.membershipId,
      actorUserId: owner.userId,
    });
    await recordContainment(owner, newNc.id, { actionTaken: "Probe containment.", actionTakenAt: new Date(), ownerMembershipId: owner.membershipId, actorUserId: owner.userId });

    const after = await getBoardManagementPack(owner, review.id);
    expect(after?.payloadSha256).toBe(before?.payloadSha256);
    expect(after?.snapshot).toEqual(before?.snapshot);
  });
});

describe("Checkpoint B fix 8 — generate/issue concurrency", () => {
  it("a delayed generate can never overwrite an already-issued pack", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic Pack Race Org", slug: `pack-race-${tag}` } });
    const owner = await membership(org.id, "owner");
    const reviewId = await reviewInInputCollection(owner, `RACE-REVIEW-${tag}`);
    const input = boardInput(reviewId, owner.userId);

    await generateBoardManagementPack(owner, input);
    const issued = await issueBoardManagementPack(owner, input);
    expect(issued.status).toBe("ISSUED");

    // Simulates a generate call that started before the issue but completes
    // after it — must be refused, never silently overwrite the issued row.
    await expect(generateBoardManagementPack(owner, input)).rejects.toThrow(ManagementReviewPackError);
    const row = await prisma.managementReviewPack.findFirstOrThrow({ where: { organisationId: org.id, reviewId } });
    expect(row.status).toBe("ISSUED");
    expect(row.checksumSha256).toBe(issued.checksumSha256);
  });

  it("two concurrent issue attempts on the same pack — exactly one succeeds", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic Pack Issue Race Org", slug: `pack-issue-race-${tag}` } });
    const owner = await membership(org.id, "owner");
    const reviewId = await reviewInInputCollection(owner, `ISSUE-RACE-REVIEW-${tag}`);
    const input = boardInput(reviewId, owner.userId);
    await generateBoardManagementPack(owner, input);

    const results = await Promise.allSettled([issueBoardManagementPack(owner, input), issueBoardManagementPack(owner, input)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const row = await prisma.managementReviewPack.findFirstOrThrow({ where: { reviewId } });
    expect(await prisma.auditEvent.count({ where: { resourceId: row.id, eventType: "management_review_pack.issued" } })).toBe(1);
  });

  it("overlapping generate and issue serialize, with no losing generation artefact", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic overlapping pack", slug: `overlap-${randomUUID()}` } });
    const owner = await membership(org.id, "owner");
    const reviewId = await reviewInInputCollection(owner, `OVERLAP-${randomUUID()}`);
    const draft = await generateManagementReviewPack(owner, reviewId, owner.userId);
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const issue = issueManagementReviewPack(owner, reviewId, owner.userId, async () => {
      entered(); await paused;
      return { reference: "overlap", overviewWindow: {}, snapshot: {}, sourceRevisions: [], decisions: [] };
    });
    await started;
    const generate = generateManagementReviewPack(owner, reviewId, owner.userId);
    // Attach rejection handling before releasing the winner.
    const settled = Promise.allSettled([issue, generate]);
    release();
    const results = await settled;
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(await prisma.auditEvent.count({ where: { resourceId: draft.id, eventType: "management_review_pack.generated" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { resourceId: draft.id, eventType: "management_review_pack.issued" } })).toBe(1);
  });

  it("an input commit during issue cannot mix board reads, input payload and frozen input rows", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic consistent snapshot", slug: `snapshot-${randomUUID()}` } });
    const owner = await membership(org.id, "owner");
    const reviewId = await reviewInInputCollection(owner, `SNAPSHOT-${randomUUID()}`);
    const link = await prisma.managementReviewInputLink.create({ data: { organisationId: org.id, reviewId, inputDefinitionKey: "probe", sourceType: "OTHER", sourceRecordId: "probe", sourceVersionLabel: "before", summary: { value: "before" }, linkedByMembershipId: owner.membershipId } });
    await generateManagementReviewPack(owner, reviewId, owner.userId);
    const issued = await issueManagementReviewPack(owner, reviewId, owner.userId, async (tx) => {
      const before = await tx.managementReviewInputLink.findUniqueOrThrow({ where: { id: link.id } });
      // Independent committed writer, after this transaction has read its snapshot.
      await prisma.managementReviewInputLink.update({ where: { id: link.id }, data: { sourceVersionLabel: "after", summary: { value: "after" } } });
      const after = await tx.managementReviewInputLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(after.summary).toEqual(before.summary);
      return { reference: "snapshot", overviewWindow: {}, snapshot: before.summary, sourceRevisions: [], decisions: [] };
    });
    const payload = issued.payload as { inputs: { sourceVersionLabel: string }[]; board: { snapshot: { value: string } } };
    const frozen = await prisma.managementReviewInputSnapshot.findFirstOrThrow({ where: { packId: issued.id } });
    expect(payload.board.snapshot.value).toBe("before");
    expect(payload.inputs[0].sourceVersionLabel).toBe("before");
    expect(frozen.sourceVersionLabel).toBe("before");
    expect(frozen.summary).toEqual({ value: "before" });
  });
});
