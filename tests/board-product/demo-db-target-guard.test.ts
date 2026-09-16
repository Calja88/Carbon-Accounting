/**
 * The BOARD-demo database target guard.
 *
 * Pure configuration tests: nothing here opens a connection, so the
 * production case is exercised without ever touching production.
 */
import { describe, expect, it } from "vitest";
import {
  DemoTargetError,
  EXPECTED_DEMO_DATABASE_NAME,
  KNOWN_PRODUCTION,
  assertDemoDatabaseTarget,
  buildDemoEnv,
  describeTarget,
} from "../../scripts/board-demo/db-target-guard";

const DEMO_HOST = "ep-crimson-recipe-ar34k6xu.c-4.us-west-2.aws.neon.tech";
const demoUrl = (host = DEMO_HOST, database = EXPECTED_DEMO_DATABASE_NAME) =>
  `postgresql://board_demo_owner:pw@${host}/${database}?sslmode=require`;

/** The approved configuration, exactly as .env.board-demo supplies it. */
const APPROVED: Record<string, string> = {
  APP_DATA_MODE: "synthetic",
  BOARD_DEMO_DATA_MODE: "synthetic",
  BOARD_DEMO_DEPLOYMENT_CLASS: "private-demo",
  BOARD_DEMO_DATABASE_ID: "cool-cake-20837205",
  BOARD_DEMO_ALLOWED_DATABASE_ID: "cool-cake-20837205",
  BOARD_DEMO_ENVIRONMENT_ID: "board-demo-local-2026-09-11",
  DATABASE_URL: demoUrl(),
  DIRECT_URL: demoUrl(),
};

/** The production target this repository was accidentally pointed at. */
const PRODUCTION_URL = `postgresql://neondb_owner:pw@ep-production-endpoint.example.neon.tech/${KNOWN_PRODUCTION.databaseName}?sslmode=require`;

const withEnv = (patch: Record<string, string | undefined>) => ({ ...APPROVED, ...patch });

describe("assertDemoDatabaseTarget", () => {
  it("accepts the approved demo configuration", () => {
    expect(() => assertDemoDatabaseTarget(APPROVED)).not.toThrow();
  });

  it("accepts the pooled/direct host pair Neon actually serves", () => {
    const pooled = demoUrl(DEMO_HOST.replace("ar34k6xu", "ar34k6xu-pooler"));
    expect(() => assertDemoDatabaseTarget(withEnv({ DATABASE_URL: pooled }))).not.toThrow();
  });

  it("refuses the known production database", () => {
    expect(() =>
      assertDemoDatabaseTarget(withEnv({ DATABASE_URL: PRODUCTION_URL, DIRECT_URL: PRODUCTION_URL })),
    ).toThrow(/known production database/);
  });

  it("refuses the known production Neon project even if the database name were right", () => {
    expect(() =>
      assertDemoDatabaseTarget(
        withEnv({
          BOARD_DEMO_DATABASE_ID: KNOWN_PRODUCTION.projectId,
          BOARD_DEMO_ALLOWED_DATABASE_ID: KNOWN_PRODUCTION.projectId,
        }),
      ),
    ).toThrow(/known production project/);
  });

  it("refuses any other database name", () => {
    const other = demoUrl(DEMO_HOST, "carbon_staging");
    expect(() => assertDemoDatabaseTarget(withEnv({ DATABASE_URL: other, DIRECT_URL: other }))).toThrow(
      /targets database 'carbon_staging'/,
    );
  });

  it("refuses a project id that does not match the allowed one", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ BOARD_DEMO_DATABASE_ID: "some-other-project-123" }))).toThrow(
      /does not match BOARD_DEMO_ALLOWED_DATABASE_ID/,
    );
  });

  it.each([
    ["BOARD_DEMO_DATABASE_ID", /must both be set/],
    ["BOARD_DEMO_ALLOWED_DATABASE_ID", /must both be set/],
    ["BOARD_DEMO_ENVIRONMENT_ID", /BOARD_DEMO_ENVIRONMENT_ID must be set/],
  ])("refuses a missing manifest value: %s", (name, message) => {
    expect(() => assertDemoDatabaseTarget(withEnv({ [name]: undefined }))).toThrow(message);
  });

  it("refuses a non-synthetic data mode", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ APP_DATA_MODE: "live" }))).toThrow(/APP_DATA_MODE/);
    expect(() => assertDemoDatabaseTarget(withEnv({ BOARD_DEMO_DATA_MODE: "live" }))).toThrow(/BOARD_DEMO_DATA_MODE/);
  });

  it("refuses a deployment class that is not private-demo", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ BOARD_DEMO_DEPLOYMENT_CLASS: "production" }))).toThrow(
      /BOARD_DEMO_DEPLOYMENT_CLASS/,
    );
  });

  it.each(["DATABASE_URL", "DIRECT_URL"])("refuses a partial configuration missing %s", (name) => {
    expect(() => assertDemoDatabaseTarget(withEnv({ [name]: undefined }))).toThrow(/both DATABASE_URL and DIRECT_URL/);
  });

  it("refuses DATABASE_URL and DIRECT_URL pointing at different environments", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ DIRECT_URL: PRODUCTION_URL }))).toThrow(
      /known production database/,
    );
    // Same database name, genuinely different host - still ambiguous.
    const elsewhere = demoUrl("ep-somewhere-else-xxxx.c-4.us-west-2.aws.neon.tech");
    expect(() => assertDemoDatabaseTarget(withEnv({ DIRECT_URL: elsewhere }))).toThrow(/different hosts/);
  });

  it("refuses DATABASE_URL and DIRECT_URL connecting as different roles", () => {
    const otherRole = demoUrl().replace("board_demo_owner", "someone_else");
    expect(() => assertDemoDatabaseTarget(withEnv({ DIRECT_URL: otherRole }))).toThrow(/different roles/);
  });

  it("refuses a redundant direct-url override that would make the target ambiguous", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ DATABASE_URL_UNPOOLED: PRODUCTION_URL }))).toThrow(/ambiguous/);
    expect(() => assertDemoDatabaseTarget(withEnv({ DIRECT_DATABASE_URL: PRODUCTION_URL }))).toThrow(/ambiguous/);
  });

  it("refuses a target it cannot parse at all", () => {
    expect(() => assertDemoDatabaseTarget(withEnv({ DATABASE_URL: "not-a-url" }))).toThrow(DemoTargetError);
    expect(() => assertDemoDatabaseTarget(withEnv({ DATABASE_URL: "mysql://u:p@host/board_demo" }))).toThrow(
      /not a postgres/,
    );
  });

  it("never echoes a connection string or password in a refusal", () => {
    const secret = "sUp3r-s3cret-pw";
    const url = `postgresql://neondb_owner:${secret}@host.neon.tech/neondb`;
    try {
      assertDemoDatabaseTarget(withEnv({ DATABASE_URL: url, DIRECT_URL: url }));
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(url);
    }
  });
});

describe("buildDemoEnv", () => {
  /**
   * The actual incident: `node --env-file` leaves an already-set variable
   * alone, so an ambient production DATABASE_URL survived into every demo
   * command. The file's value must win, and the guard must see the file's.
   */
  it("discards an ambient production DATABASE_URL in favour of the demo file", () => {
    const ambient = { DATABASE_URL: PRODUCTION_URL, DIRECT_URL: PRODUCTION_URL, PATH: "/usr/bin" };
    const { env, overridden } = buildDemoEnv(ambient, APPROVED);

    expect(describeTarget("DATABASE_URL", env.DATABASE_URL).database).toBe(EXPECTED_DEMO_DATABASE_NAME);
    expect(overridden).toEqual(["DATABASE_URL", "DIRECT_URL"]);
    expect(env.PATH).toBe("/usr/bin");
    expect(() => assertDemoDatabaseTarget(env)).not.toThrow();
  });

  it("unsets an ambient variable the demo file does not define, rather than inheriting it", () => {
    const ambient = { DATABASE_URL_UNPOOLED: PRODUCTION_URL, DIRECT_DATABASE_URL: PRODUCTION_URL };
    const { env } = buildDemoEnv(ambient, APPROVED);

    expect(env.DATABASE_URL_UNPOOLED).toBeUndefined();
    expect(env.DIRECT_DATABASE_URL).toBeUndefined();
    expect(() => assertDemoDatabaseTarget(env)).not.toThrow();
  });

  it("fails closed when the demo file itself is incomplete", () => {
    const incomplete = { ...APPROVED };
    delete incomplete.DIRECT_URL;
    const { env } = buildDemoEnv({ DATABASE_URL: PRODUCTION_URL, DIRECT_URL: PRODUCTION_URL }, incomplete);
    expect(() => assertDemoDatabaseTarget(env)).toThrow(/both DATABASE_URL and DIRECT_URL/);
  });
});
