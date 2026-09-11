import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { prisma } from "../../src/lib/prisma";
import { seedBoardDemo } from "./seed-orchestrator";
import { LiveSeedPort } from "./live-seed-port";
import { assertDemoTarget } from "./guard";

async function main() {
  const env = {
    dataMode: process.env.BOARD_DEMO_DATA_MODE,
    deploymentClass: process.env.BOARD_DEMO_DEPLOYMENT_CLASS,
    configuredDatabaseId: process.env.BOARD_DEMO_DATABASE_ID,
    allowedDatabaseId: process.env.BOARD_DEMO_ALLOWED_DATABASE_ID,
    configuredEnvironmentId: process.env.BOARD_DEMO_ENVIRONMENT_ID,
  };
  const port = new LiveSeedPort();
  assertDemoTarget(env, await port.readConnectedIdentity());
  if (process.argv.includes("--seed")) console.log(await seedBoardDemo(port, env));
  // A new adapter independently resolves every saved ID, byte and checksum.
  await new LiveSeedPort().verifyExistingFixture();
  const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: "BOARD-1" } });
  if (lease.status !== "READY" || !lease.fixtureOrganisationId) throw new Error("Fixture is not READY");
  const ids = lease.identityMap as Record<string, string>;
  const org = lease.fixtureOrganisationId;
  const pack = await prisma.managementReviewPack.findFirstOrThrow({ where: { id: ids.managementPackId, organisationId: org, status: "ISSUED" } });
  const nc = await prisma.nonconformity.findFirstOrThrow({ where: { id: ids.nonconformityId, organisationId: org }, include: { sourceLinks: true, correctiveActions: true } });
  const links = await prisma.managementReviewInputSnapshot.findMany({ where: { packId: pack.id } });
  const manifest = {
    fixture: "BOARD-1", environmentId: env.configuredEnvironmentId, databaseId: env.configuredDatabaseId,
    applicationCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    generatedAt: new Date().toISOString(), status: "READY", digest: lease.digest, ids: lease.identityMap,
    routes: { overview: "/?from=2026-01&to=2026-08", carbon: "/carbon?from=2026-01&to=2026-08", attention: "/attention?from=2026-01&to=2026-08", nonconformity: `/ems/nonconformities/${nc.id}`, lca: `/assessments/${ids.lcaAssessmentId}/scenarios`, pack: `/ems/management-reviews/${ids.managementReviewId}/pack`, download: `/ems/management-reviews/${ids.managementReviewId}/pack/download` },
    sources: nc.sourceLinks.map((s) => ({ type: s.sourceType, id: s.sourceId })),
    reviewInputs: links.map((s) => ({ definition: s.inputDefinitionKey, type: s.sourceType, id: s.sourceRecordId, revision: s.sourceVersionLabel })),
    frozenChecksum: pack.checksumSha256, cutoffDate: pack.cutoffDate,
    liveTransition: { nonconformityStatus: nc.status, reviewCycle: nc.reviewCycle, actions: nc.correctiveActions.map((a) => ({ id: a.id, description: a.description, status: a.status })) },
  };
  writeFileSync("Docs/board-sprint/rehearsal-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log("BOARD-1 READY: independent reconciliation and replay verified; rehearsal manifest written.");
}

main().catch((error: unknown) => {
  // Avoid dumping Prisma errors/connection details; private operator diagnostics only.
  console.error("BOARD-1 verification failed.", error instanceof Error ? error.name : "Unknown error");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
