/**
 * Checkpoint B required fixes 4 (trustworthy seed identity) and 5 (partial
 * build state / replay integrity), against real PostgreSQL.
 *
 * Runs after bd08-board1-seed.test.ts in the include order, so the real
 * BOARD-1 fixture already exists at READY — used here only to prove the
 * digest-mismatch rejection (immediately restored afterward), never
 * otherwise mutated.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { LiveSeedPort } from "../../scripts/board-demo/live-seed-port";
import { BOARD1 } from "../../scripts/board-demo/board1";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

describe("Checkpoint B fix 4 — trustworthy seed identity", () => {
  it("a manifest row with no matching BOARD_DEMO_PROVISIONING_TOKEN is never trusted as synthetic/disposable", async () => {
    const databaseId = `cb-guard-db-${randomUUID()}`;
    const environmentId = `cb-guard-env-${randomUUID()}`;
    const realToken = `cb-real-token-${randomUUID()}`;
    await prisma.demoDatabaseManifest.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", databaseId, environmentId, provisioningToken: realToken },
      update: { databaseId, environmentId, provisioningToken: realToken },
    });
    const savedAppDataMode = process.env.APP_DATA_MODE;
    const savedToken = process.env.BOARD_DEMO_PROVISIONING_TOKEN;
    try {
      process.env.APP_DATA_MODE = "synthetic";
      process.env.BOARD_DEMO_PROVISIONING_TOKEN = "a-completely-different-token";
      const identity = await new LiveSeedPort().readConnectedIdentity();
      expect(identity.dataClass).toBe("OTHER");
      expect(identity.disposable).toBe(false);
    } finally {
      if (savedAppDataMode === undefined) delete process.env.APP_DATA_MODE; else process.env.APP_DATA_MODE = savedAppDataMode;
      if (savedToken === undefined) delete process.env.BOARD_DEMO_PROVISIONING_TOKEN; else process.env.BOARD_DEMO_PROVISIONING_TOKEN = savedToken;
    }
  });

  it("a correctly matching manifest/token is trusted only when APP_DATA_MODE=synthetic is also explicitly set", async () => {
    const databaseId = `cb-guard-db-${randomUUID()}`;
    const environmentId = `cb-guard-env-${randomUUID()}`;
    const token = `cb-real-token-${randomUUID()}`;
    // Checkpoint B corrective handoff §4: the manifest must also record the
    // ACTUAL connection's own current_database()/current_user for
    // readConnectedIdentity's connection-identity check to pass.
    const [{ db, usr }] = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
    await prisma.demoDatabaseManifest.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", databaseId, environmentId, provisioningToken: token, approvedDatabaseName: db, approvedRole: usr },
      update: { databaseId, environmentId, provisioningToken: token, approvedDatabaseName: db, approvedRole: usr },
    });
    const savedAppDataMode = process.env.APP_DATA_MODE;
    const savedToken = process.env.BOARD_DEMO_PROVISIONING_TOKEN;
    try {
      delete process.env.APP_DATA_MODE; // not "synthetic" — must fail closed even with a matching token
      process.env.BOARD_DEMO_PROVISIONING_TOKEN = token;
      const withoutAppDataMode = await new LiveSeedPort().readConnectedIdentity();
      expect(withoutAppDataMode.dataClass).toBe("OTHER");

      process.env.APP_DATA_MODE = "synthetic";
      const withBoth = await new LiveSeedPort().readConnectedIdentity();
      expect(withBoth.dataClass).toBe("SYNTHETIC");
      expect(withBoth.disposable).toBe(true);
      expect(withBoth.actualDatabaseId).toBe(databaseId);
    } finally {
      if (savedAppDataMode === undefined) delete process.env.APP_DATA_MODE; else process.env.APP_DATA_MODE = savedAppDataMode;
      if (savedToken === undefined) delete process.env.BOARD_DEMO_PROVISIONING_TOKEN; else process.env.BOARD_DEMO_PROVISIONING_TOKEN = savedToken;
    }
  });

  it("a manifest whose approved database name/role does not match the actual live connection is never trusted as disposable — current_database() alone is not enough", async () => {
    const databaseId = `cb-guard-db-${randomUUID()}`;
    const environmentId = `cb-guard-env-${randomUUID()}`;
    const token = `cb-real-token-${randomUUID()}`;
    await prisma.demoDatabaseManifest.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", databaseId, environmentId, provisioningToken: token, approvedDatabaseName: "not-the-real-database", approvedRole: "not-the-real-role" },
      update: { databaseId, environmentId, provisioningToken: token, approvedDatabaseName: "not-the-real-database", approvedRole: "not-the-real-role" },
    });
    const savedAppDataMode = process.env.APP_DATA_MODE;
    const savedToken = process.env.BOARD_DEMO_PROVISIONING_TOKEN;
    try {
      process.env.APP_DATA_MODE = "synthetic";
      process.env.BOARD_DEMO_PROVISIONING_TOKEN = token;
      const identity = await new LiveSeedPort().readConnectedIdentity();
      expect(identity.dataClass).toBe("OTHER");
      expect(identity.disposable).toBe(false);
    } finally {
      if (savedAppDataMode === undefined) delete process.env.APP_DATA_MODE; else process.env.APP_DATA_MODE = savedAppDataMode;
      if (savedToken === undefined) delete process.env.BOARD_DEMO_PROVISIONING_TOKEN; else process.env.BOARD_DEMO_PROVISIONING_TOKEN = savedToken;
    }
  });

  it("a 'Synthetic ...'-named organisation only escapes the ordinary-organisation count when the environment independently proves disposable CI, never on name alone", async () => {
    // Each half below takes its own before/after pair under ONE fixed flag
    // value — never comparing counts taken under different flag values to
    // each other. The shared disposable CI database already carries several
    // other "Synthetic ..." orgs from sibling test files, and flipping
    // CHECKPOINT_A_DISPOSABLE mid-comparison would reveal all of THEIR
    // leniency at once, not just this one probe's — the exact mistake this
    // test previously made (CI-discovered: "expected 8 to be 1").
    const savedFlag = process.env.CHECKPOINT_A_DISPOSABLE;
    const probeName = `Synthetic Checkpoint B Guard Probe ${randomUUID()}`;
    try {
      process.env.CHECKPOINT_A_DISPOSABLE = "1"; // the true, verified state throughout this CI job
      const beforeDisposableProven = await new LiveSeedPort().readConnectedIdentity();
      const probeUnderDisposableProven = await prisma.organisation.create({ data: { name: probeName, slug: `cb-guard-probe-${randomUUID()}` } });
      try {
        const withProbeDisposableProven = await new LiveSeedPort().readConnectedIdentity();
        // Genuinely disposable CI: the naming leniency exempts this "Synthetic ..." org — count unchanged.
        expect(withProbeDisposableProven.ordinaryOrganisationCount).toBe(beforeDisposableProven.ordinaryOrganisationCount);
      } finally {
        await prisma.organisation.delete({ where: { id: probeUnderDisposableProven.id } });
      }

      process.env.CHECKPOINT_A_DISPOSABLE = "0"; // simulate "not proven disposable" — the flag alone must never be enough either way
      const beforeNotProven = await new LiveSeedPort().readConnectedIdentity();
      const probeUnderNotProven = await prisma.organisation.create({ data: { name: probeName, slug: `cb-guard-probe-${randomUUID()}` } });
      try {
        const withProbeNotProven = await new LiveSeedPort().readConnectedIdentity();
        // Not independently proven disposable: naming leniency withdrawn — this same-named org now counts as ordinary.
        expect(withProbeNotProven.ordinaryOrganisationCount).toBe(beforeNotProven.ordinaryOrganisationCount + 1);
      } finally {
        await prisma.organisation.delete({ where: { id: probeUnderNotProven.id } });
      }
    } finally {
      if (savedFlag === undefined) delete process.env.CHECKPOINT_A_DISPOSABLE; else process.env.CHECKPOINT_A_DISPOSABLE = savedFlag;
    }
  });

  it("a foreign organisation carrying the fixture's own 'board-1-' slug prefix is never treated as fixture-owned — a name/prefix is not proof of ownership", async () => {
    // Runs after bd08-board1-seed.test.ts, so the real fixture's exact
    // fixtureOrganisationId is already recorded on the lease. A foreign
    // tenant imitating the slug prefix must still count as ordinary.
    const before = await new LiveSeedPort().readConnectedIdentity();
    const impostor = await prisma.organisation.create({ data: { name: "Impostor", slug: `board-1-impostor-${randomUUID()}` } });
    try {
      const withImpostor = await new LiveSeedPort().readConnectedIdentity();
      expect(withImpostor.ordinaryOrganisationCount).toBe(before.ordinaryOrganisationCount + 1);
    } finally {
      await prisma.organisation.delete({ where: { id: impostor.id } });
    }
  });

  it("beginFixture never binds a fixture organisation for a synthetic (non-BOARD-1) lease key — organisation binding is scoped to the real fixture only", async () => {
    // The empty-target requirement (a real persistent target must have no
    // tenant organisations before its very first build) is exercised
    // implicitly every real CI run of bd08-board1-seed.test.ts's own
    // beginFixture(FIXTURE_KEY) call, gated off inside the proven-disposable
    // suite the same way readConnectedIdentity's naming leniency is — it
    // cannot be independently re-tested here without a second, genuinely
    // fresh database this sandbox doesn't have. What IS provable here: a
    // synthetic key (as the CAS-durability tests above use) never triggers
    // organisation creation at all, so those tests never pollute the
    // organisation table as a side effect.
    const key = `checkpoint-b-no-org-binding-${randomUUID()}`;
    await prisma.demoFixtureLease.create({ data: { fixtureKey: key } });
    const port = new LiveSeedPort();
    await port.beginFixture(key);
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: key } });
    expect(lease.fixtureOrganisationId).toBeNull();
  });
});

describe("Checkpoint B fix 5 — partial build state / replay integrity", () => {
  it("beginFixture's CAS is durable and refuses a concurrent/duplicate transition", async () => {
    const key = `checkpoint-b-partial-build-${randomUUID()}`;
    const port = new LiveSeedPort();
    await prisma.demoFixtureLease.create({ data: { fixtureKey: key } }); // status: NONE
    await port.beginFixture(key);
    const afterBegin = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: key } });
    expect(afterBegin.status).toBe("BUILDING");

    // Simulates a domain-write failure partway through a build: nothing
    // ever calls markFixtureReady, and BUILDING must remain durably
    // persisted (not silently reverted to NONE) — detectable and unavailable.
    const stillBuilding = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: key } });
    expect(stillBuilding.status).toBe("BUILDING");

    // A concurrent/duplicate beginFixture on the same key is refused, not raced.
    await expect(port.beginFixture(key)).rejects.toThrow(/already BUILDING or READY/);
  });

  it("markFixtureReady only transitions from BUILDING, never overwriting an unexpected state", async () => {
    const key = `checkpoint-b-mark-ready-${randomUUID()}`;
    const port = new LiveSeedPort();
    await prisma.demoFixtureLease.create({ data: { fixtureKey: key } }); // status: NONE
    // Cannot go straight to READY from NONE.
    await expect(port.markFixtureReady(key, "a".repeat(64))).rejects.toThrow(/was not BUILDING/);

    await port.beginFixture(key);
    await port.markFixtureReady(key, "a".repeat(64));
    const ready = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: key } });
    expect(ready.status).toBe("READY");

    // Cannot mark READY a second time (already READY, not BUILDING).
    await expect(port.markFixtureReady(key, "b".repeat(64))).rejects.toThrow(/was not BUILDING/);
    const unchanged = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: key } });
    expect(unchanged.digest).toBe("a".repeat(64)); // the second, refused call never overwrote it
  });

  it("replay refuses an altered fixture whose recomputed digest no longer matches the saved one", async () => {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
    expect(lease.status).toBe("READY"); // built by bd08-board1-seed.test.ts, which must run before this file
    const realDigest = lease.digest;
    await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { digest: "0".repeat(64) } });
    try {
      await expect(new LiveSeedPort().verifyExistingFixture()).rejects.toThrow(/digest mismatch/);
    } finally {
      await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { digest: realDigest } });
    }
    // Restored correctly — a genuine replay still verifies cleanly afterward.
    await expect(new LiveSeedPort().verifyExistingFixture()).resolves.toBeUndefined();
  });
});

describe("Checkpoint B corrective handoff §5 — durable identity map / actual-byte integrity", () => {
  it("existingFixture reports a fixture recorded under a different implementation revision as invalid, never silently reinterpreting it", async () => {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
    expect(lease.status).toBe("READY");
    const realRevision = lease.implementationRevision;
    await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { implementationRevision: realRevision + 1 } });
    try {
      const existing = await new LiveSeedPort().existingFixture();
      // Not null (still READY) but an invalid digest — seedBoardDemo's own
      // fixed orchestrator contract turns this into "Fixture identity
      // differs; provision a fresh empty demo database" without any
      // reset/repair happening in this file.
      expect(existing).not.toBeNull();
      expect(existing?.digest).toBe("");
    } finally {
      await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { implementationRevision: realRevision } });
    }
    // Restored correctly — a genuine replay still reports the real digest afterward.
    const restored = await new LiveSeedPort().existingFixture();
    expect(restored?.digest).toBe(lease.digest);
  });

  it("replay refuses a fixture whose persisted identity map has been tampered with to point at a foreign row", async () => {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
    const realMap = lease.identityMap as Record<string, unknown>;
    expect(realMap).toBeTruthy();
    const tamperedMap = { ...realMap, nonconformityId: "not-a-real-id" };
    await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { identityMap: tamperedMap as unknown as Prisma.InputJsonValue } });
    try {
      await expect(new LiveSeedPort().verifyExistingFixture()).rejects.toThrow();
    } finally {
      await prisma.demoFixtureLease.update({ where: { fixtureKey: BOARD1.fixtureVersion }, data: { identityMap: realMap as unknown as Prisma.InputJsonValue } });
    }
    await expect(new LiveSeedPort().verifyExistingFixture()).resolves.toBeUndefined();
  });

  it("replay refuses evidence whose stored bytes have been altered, even when its checksum/size columns still claim to match", async () => {
    const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
    const map = lease.identityMap as { evidenceIds: Record<string, string> };
    const evidenceId = Object.values(map.evidenceIds)[0];
    const before = await prisma.evidenceObject.findUniqueOrThrow({ where: { id: evidenceId } });
    // A genuine replay reads bytes back through the real storage-backed
    // path, not just the EvidenceObject row's own recorded metadata — so
    // proving this requires actually corrupting the underlying blob table,
    // never just the EvidenceObject row's own checksum/size columns (which
    // the fix now cross-checks against a fresh read, not merely trusts).
    const originalBlob = await prisma.evidenceObjectBlob.findUniqueOrThrow({ where: { evidenceObjectId: before.storageKey! } });
    await prisma.evidenceObjectBlob.update({
      where: { evidenceObjectId: before.storageKey! },
      data: { data: Uint8Array.from(Buffer.from("tampered bytes, not the real fixture content")) },
    });
    try {
      await expect(new LiveSeedPort().verifyExistingFixture()).rejects.toThrow(/stored bytes do not match/);
    } finally {
      await prisma.evidenceObjectBlob.update({ where: { evidenceObjectId: before.storageKey! }, data: { data: originalBlob.data } });
    }
    await expect(new LiveSeedPort().verifyExistingFixture()).resolves.toBeUndefined();
  });
});
