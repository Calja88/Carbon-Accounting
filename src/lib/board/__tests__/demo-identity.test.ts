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

it("fails closed instead of crashing the app shell when synthetic mode points at a database without the fixture tables", async () => {
  vi.stubEnv("APP_DATA_MODE", "synthetic");
  vi.stubEnv("BOARD_DEMO_PROVISIONING_TOKEN", randomUUID());
  // The real P2021 this guards: APP_DATA_MODE=synthetic against an ordinary database.
  const db = {
    demoDatabaseManifest: { findUnique: async () => { throw new Error("The table `public.DemoDatabaseManifest` does not exist in the current database."); } },
  } as unknown as Prisma.TransactionClient;
  await expect(isVerifiedSyntheticOrganisation("any-org", db)).resolves.toBe(false);
});

it("never reads the database at all for an ordinary deployment", async () => {
  vi.stubEnv("APP_DATA_MODE", "");
  const findUnique = vi.fn();
  const db = { demoDatabaseManifest: { findUnique }, demoFixtureLease: { findUnique } } as unknown as Prisma.TransactionClient;
  expect(await isVerifiedSyntheticOrganisation("ordinary-org", db)).toBe(false);
  expect(findUnique).not.toHaveBeenCalled();
});
