import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isVerifiedDemoEnvironment } from "../live-environment";

const ENV_KEYS = [
  "BOARD_DEMO_DATA_MODE",
  "BOARD_DEMO_DEPLOYMENT_CLASS",
  "BOARD_DEMO_DATABASE_ID",
  "BOARD_DEMO_ALLOWED_DATABASE_ID",
  "BOARD_DEMO_ENVIRONMENT_ID",
] as const;

const validIdentity = {
  actualDatabaseId: "db-1",
  manifestEnvironmentId: "env-1",
  dataClass: "SYNTHETIC" as const,
  disposable: true,
  ordinaryOrganisationCount: 0,
};

function setValidManifest() {
  process.env.BOARD_DEMO_DATA_MODE = "synthetic";
  process.env.BOARD_DEMO_DEPLOYMENT_CLASS = "private-demo";
  process.env.BOARD_DEMO_DATABASE_ID = "db-1";
  process.env.BOARD_DEMO_ALLOWED_DATABASE_ID = "db-1";
  process.env.BOARD_DEMO_ENVIRONMENT_ID = "env-1";
}

describe("isVerifiedDemoEnvironment", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("is false with no database identity — the state every environment this branch has run in is in", () => {
    expect(isVerifiedDemoEnvironment(null)).toBe(false);
  });

  it("is false with a database identity but no environment manifest set", () => {
    expect(isVerifiedDemoEnvironment(validIdentity)).toBe(false);
  });

  it("is true only when the manifest and database identity fully agree", () => {
    setValidManifest();
    expect(isVerifiedDemoEnvironment(validIdentity)).toBe(true);
  });

  it("fails closed on a database id mismatch, never widening to trust it anyway", () => {
    setValidManifest();
    expect(isVerifiedDemoEnvironment({ ...validIdentity, actualDatabaseId: "some-other-db" })).toBe(false);
  });

  it("fails closed when the database reports even one ordinary organisation", () => {
    setValidManifest();
    expect(isVerifiedDemoEnvironment({ ...validIdentity, ordinaryOrganisationCount: 1 })).toBe(false);
  });

  it("never infers synthetic status from a URL substring, branch name, or Vercel preview status — only from the explicit manifest", () => {
    // No BOARD_DEMO_* vars set — simulating an ordinary preview/dev deploy
    // whose DATABASE_URL might happen to contain "dev" or "demo".
    expect(isVerifiedDemoEnvironment(validIdentity)).toBe(false);
  });
});
