/**
 * Checkpoint B required fix 8 (frozen management pack / concurrency),
 * against real PostgreSQL. Runs after bd08-board1-seed.test.ts, so the
 * real BOARD-1 board management pack already exists at ISSUED.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext } from "@/lib/organisation/context";
import {
  generateBoardManagementPack,
  issueBoardManagementPack,
  getBoardManagementPack,
  BoardManagementPackError,
} from "@/lib/board/live-management-pack";
import { LiveSeedPort } from "../../scripts/board-demo/live-seed-port";
import { createNonconformityFromSource, recordContainment } from "@/lib/ems/nonconformity/nonconformity-service";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const tag = randomUUID();
const grants = ["carbon.view", "ems.view", "ems.management_review.manage"];

async function membership(org: string, name: string) {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: grants.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

describe("Checkpoint B fix 8 — the board management pack (FrozenBoardPack) is real and non-empty", () => {
  it("the issued BOARD-1 board pack has real linked decisions and pinned source revisions, not an empty snapshot", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const row = await prisma.boardManagementPack.findFirstOrThrow({ where: { organisationId: org.id, reference: LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE } });
    expect(row.status).toBe("ISSUED");
    const body = row.snapshot as { decisions: unknown[]; sourceRevisions: unknown[]; snapshot: { carbon: { state: string } } };
    expect(body.decisions.length).toBeGreaterThan(0);
    expect(body.sourceRevisions.length).toBeGreaterThan(0);
    expect(body.snapshot.carbon.state).toBe("ready"); // a real Overview carbon snapshot, not a stub
  });

  it("a genuine live transition after freeze does not change the issued board pack's payload or checksum", async () => {
    const org = await prisma.organisation.findUniqueOrThrow({ where: { slug: "board-1-northstar-demonstration" } });
    const owner = await resolveOrganisationContext(prisma, {
      userId: (await prisma.user.findFirstOrThrow({ where: { name: "BOARD-1 sustainability-lead" } })).id,
      requestedOrganisation: org.id,
    });
    const before = await getBoardManagementPack(owner, LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE);
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

    const after = await getBoardManagementPack(owner, LiveSeedPort.BOARD_MANAGEMENT_PACK_REFERENCE);
    expect(after?.payloadSha256).toBe(before?.payloadSha256);
    expect(after?.snapshot).toEqual(before?.snapshot);
  });
});

describe("Checkpoint B fix 8 — generate/issue concurrency", () => {
  it("a delayed generate can never overwrite an already-issued pack", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic Pack Race Org", slug: `pack-race-${tag}` } });
    const owner = await membership(org.id, "owner");
    const reference = `RACE-${tag}`;
    const input = { reference, overviewWindow: { from: "2026-01", to: "2026-01" }, sourceRevisions: [{ id: "x", kind: "probe", revision: "1", label: "Probe", href: "/probe" as const }], decisions: [{ title: "t", rationale: "r", owner: "o", dueDate: null, status: "draft" as const }], actorUserId: owner.userId };

    await generateBoardManagementPack(owner, input);
    const issued = await issueBoardManagementPack(owner, reference, owner.userId);
    expect(issued.status).toBe("ISSUED");

    // Simulates a generate call that started before the issue but completes
    // after it — must be refused, never silently overwrite the issued row.
    await expect(generateBoardManagementPack(owner, input)).rejects.toThrow(BoardManagementPackError);
    const row = await prisma.boardManagementPack.findFirstOrThrow({ where: { organisationId: org.id, reference } });
    expect(row.status).toBe("ISSUED");
    expect(row.payloadSha256).toBe(issued.payloadSha256);
  });

  it("two concurrent issue attempts on the same pack — exactly one succeeds", async () => {
    const org = await prisma.organisation.create({ data: { name: "Synthetic Pack Issue Race Org", slug: `pack-issue-race-${tag}` } });
    const owner = await membership(org.id, "owner");
    const reference = `ISSUE-RACE-${tag}`;
    await generateBoardManagementPack(owner, { reference, overviewWindow: { from: "2026-01", to: "2026-01" }, sourceRevisions: [{ id: "x", kind: "probe", revision: "1", label: "Probe", href: "/probe" as const }], decisions: [{ title: "t", rationale: "r", owner: "o", dueDate: null, status: "draft" as const }], actorUserId: owner.userId });

    const results = await Promise.allSettled([
      issueBoardManagementPack(owner, reference, owner.userId),
      issueBoardManagementPack(owner, reference, owner.userId),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
