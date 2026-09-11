import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import { isVerifiedSyntheticOrganisation } from "../demo-identity";

afterEach(() => vi.unstubAllEnvs());

it("requires connected identity, deployment proof, exact fixture ownership and no ordinary organisations", async () => {
  const proof = randomUUID();
  for (const [key, value] of Object.entries({ APP_DATA_MODE: "synthetic", BOARD_DEMO_PROVISIONING_TOKEN: proof, BOARD_DEMO_DATA_MODE: "synthetic", BOARD_DEMO_DEPLOYMENT_CLASS: "private-demo", BOARD_DEMO_DATABASE_ID: "disposable-id", BOARD_DEMO_ALLOWED_DATABASE_ID: "disposable-id", BOARD_DEMO_ENVIRONMENT_ID: "environment-id" })) vi.stubEnv(key, value);
  const lease = { fixtureOrganisationId: "fixture-org", status: "READY" };
  const connected = { db: "expected-db", usr: "expected-role" };
  const ordinary = vi.fn(async () => 0);
  const db = {
    demoDatabaseManifest: { findUnique: async () => ({ databaseId: "disposable-id", environmentId: "environment-id", provisioningToken: proof, approvedDatabaseName: "expected-db", approvedRole: "expected-role" }) },
    demoFixtureLease: { findUnique: async () => lease },
    organisation: { count: ordinary },
    $queryRaw: async () => [connected],
  } as unknown as Prisma.TransactionClient;
  expect(await isVerifiedSyntheticOrganisation("fixture-org", db)).toBe(true);
  expect(await isVerifiedSyntheticOrganisation("impostor-org", db)).toBe(false);
  connected.usr = "another-role";
  expect(await isVerifiedSyntheticOrganisation("fixture-org", db)).toBe(false);
  connected.usr = "expected-role";
  ordinary.mockResolvedValueOnce(1);
  expect(await isVerifiedSyntheticOrganisation("fixture-org", db)).toBe(false);
  vi.stubEnv("BOARD_DEMO_PROVISIONING_TOKEN", randomUUID());
  expect(await isVerifiedSyntheticOrganisation("fixture-org", db)).toBe(false);
});
