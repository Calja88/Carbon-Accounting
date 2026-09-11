import { BOARD1, buildCarbonTargets, buildSubmissionObligations, IMPROVEMENT_CHAIN } from "./board1";
import { buildSyntheticEvidence } from "./evidence";
import { assertDemoTarget } from "./guard";
import type { DemoDatabaseIdentity, DemoEnvironment } from "./guard";

export interface DemoSeedPort {
  readConnectedIdentity(): Promise<DemoDatabaseIdentity>;
  /** Lease spans all writes. Refuse concurrent seed/reset and keep preview closed until success. */
  withExclusiveFixtureLease<T>(key: string, operation: () => Promise<T>): Promise<T>;
  existingFixture(): Promise<{ version: string; digest: string } | null>;
  /** Persist BUILDING with an empty digest before any domain writes. A failed seed remains unavailable. */
  beginFixture(version: string): Promise<void>;
  verifyExistingFixture(): Promise<void>;
  createSyntheticOrganisationAndActors(): Promise<void>;
  createAndCalculateCarbon(targets: ReturnType<typeof buildCarbonTargets>, obligations: ReturnType<typeof buildSubmissionObligations>): Promise<void>;
  storeEvidence(files: ReturnType<typeof buildSyntheticEvidence>): Promise<void>;
  createImprovementChain(chain: typeof IMPROVEMENT_CHAIN): Promise<void>;
  createAndCalculateLca(plan: typeof BOARD1.lca): Promise<void>;
  createFrozenManagementPack(): Promise<void>;
  /** Reads actual persisted results/bytes/relations; fails on any reconciliation or integrity mismatch. */
  verifyAllInvariants(): Promise<{ digest: string }>;
  markFixtureReady(version: string, digest: string): Promise<void>;
}
/** Complete orchestration; adapter deliberately absent because only Claude can validate live schema and environment. No reset/delete operation supplied. */
export async function seedBoardDemo(port: DemoSeedPort, env: DemoEnvironment): Promise<"created" | "verified-existing"> {
  assertDemoTarget(env, await port.readConnectedIdentity());
  return port.withExclusiveFixtureLease(BOARD1.fixtureVersion, async () => {
    assertDemoTarget(env, await port.readConnectedIdentity());
    const existing = await port.existingFixture();
    if (existing) {
      if (existing.version !== BOARD1.fixtureVersion || !/^[a-f0-9]{64}$/.test(existing.digest)) throw new Error("Fixture identity differs; provision a fresh empty demo database");
      await port.verifyExistingFixture(); return "verified-existing";
    }
    await port.beginFixture(BOARD1.fixtureVersion);
    await port.createSyntheticOrganisationAndActors();
    await port.createAndCalculateCarbon(buildCarbonTargets(), buildSubmissionObligations());
    await port.storeEvidence(buildSyntheticEvidence());
    await port.createImprovementChain(IMPROVEMENT_CHAIN);
    await port.createAndCalculateLca(BOARD1.lca);
    await port.createFrozenManagementPack();
    const { digest } = await port.verifyAllInvariants();
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid fixture digest");
    await port.markFixtureReady(BOARD1.fixtureVersion, digest);
    return "created";
  });
}
