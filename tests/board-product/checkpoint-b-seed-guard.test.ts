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
    await prisma.demoDatabaseManifest.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", databaseId, environmentId, provisioningToken: token },
      update: { databaseId, environmentId, provisioningToken: token },
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

  it("a 'Synthetic ...'-named organisation only escapes the ordinary-organisation count when the environment independently proves disposable CI, never on name alone", async () => {
    // Isolate the effect of THIS ONE probe org's own name, not an absolute
    // count — the shared disposable CI database already carries several
    // other "Synthetic ..." orgs from sibling test files, and flipping
    // CHECKPOINT_A_DISPOSABLE would swing the leniency for all of them at
    // once, not just this one. Compare before/after creating the probe org
    // under each setting instead.
    const savedFlag = process.env.CHECKPOINT_A_DISPOSABLE;
    try {
      process.env.CHECKPOINT_A_DISPOSABLE = "1"; // the true, verified state throughout this CI job
      const before = await new LiveSeedPort().readConnectedIdentity();

      const org = await prisma.organisation.create({ data: { name: `Synthetic Checkpoint B Guard Probe ${randomUUID()}`, slug: `cb-guard-probe-${randomUUID()}` } });
      try {
        const withProbeDisposableProven = await new LiveSeedPort().readConnectedIdentity();
        // Genuinely disposable CI: the naming leniency exempts this "Synthetic ..." org — count unchanged.
        expect(withProbeDisposableProven.ordinaryOrganisationCount).toBe(before.ordinaryOrganisationCount);

        process.env.CHECKPOINT_A_DISPOSABLE = "0"; // simulate "not proven disposable" — the flag alone must never be enough either way
        const withProbeNotProven = await new LiveSeedPort().readConnectedIdentity();
        // Not independently proven disposable: naming leniency withdrawn — this org now counts as ordinary.
        expect(withProbeNotProven.ordinaryOrganisationCount).toBe(withProbeDisposableProven.ordinaryOrganisationCount + 1);
      } finally {
        await prisma.organisation.delete({ where: { id: org.id } });
      }
    } finally {
      if (savedFlag === undefined) delete process.env.CHECKPOINT_A_DISPOSABLE; else process.env.CHECKPOINT_A_DISPOSABLE = savedFlag;
    }
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
