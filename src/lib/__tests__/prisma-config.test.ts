import { describe, expect, it } from "vitest";
import { assertValidDatabaseUrl, prisma } from "@/lib/prisma";
import { assertConsistentMigrationTarget, deriveDirectUrl, resolveDirectUrl } from "../../../prisma.config";

/** T02 Neon configuration tests. Every URL is synthetic. */
describe("assertValidDatabaseUrl", () => {
  it("allows a missing URL so builds and tests stay database-free", () => {
    expect(assertValidDatabaseUrl(undefined)).toBeUndefined();
    expect(assertValidDatabaseUrl("")).toBeUndefined();
  });

  it("accepts PostgreSQL connection strings", () => {
    const url = "postgresql://synthetic:synthetic@fake-pooler.example.neon.tech/example";
    expect(assertValidDatabaseUrl(url)).toBe(url);
  });

  it("rejects malformed and non-PostgreSQL URLs without exposing their values", () => {
    for (const value of ["not-a-url-with-secret-token", "https://secret@example.test/database"]) {
      expect(() => assertValidDatabaseUrl(value)).toThrow("DATABASE_URL is not a valid PostgreSQL connection string");
      try {
        assertValidDatabaseUrl(value);
      } catch (error) {
        expect((error as Error).message).not.toContain(value);
      }
    }
  });
});

describe("Prisma singleton", () => {
  it("constructs without making a live database connection", () => {
    expect(prisma).toBeDefined();
  });
});

describe("direct migration URL selection", () => {
  const pooled = "postgresql://synthetic:synthetic@ep-example-pooler.eu-west-2.aws.neon.tech/example";

  it("derives a direct Neon hostname from the pooled hostname", () => {
    expect(deriveDirectUrl(pooled)).toBe(
      "postgresql://synthetic:synthetic@ep-example.eu-west-2.aws.neon.tech/example",
    );
  });

  it("leaves local and invalid values unchanged for Prisma to diagnose", () => {
    const local = "postgresql://synthetic:synthetic@localhost:5432/example";
    expect(deriveDirectUrl(local)).toBe(local);
    expect(deriveDirectUrl("not-a-url")).toBe("not-a-url");
    expect(deriveDirectUrl("")).toBe("");
  });

  it("prefers DIRECT_URL, then Neon's unpooled variable, then the legacy alias", () => {
    expect(resolveDirectUrl({ DATABASE_URL: pooled, DIRECT_URL: "postgresql://synthetic@direct.test/example" })).toContain("direct.test");
    expect(resolveDirectUrl({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: "postgresql://synthetic@unpooled.test/example" })).toContain("unpooled.test");
    expect(resolveDirectUrl({ DATABASE_URL: pooled, DIRECT_DATABASE_URL: "postgresql://synthetic@legacy.test/example" })).toContain("legacy.test");
  });
});

/**
 * The migration-target guard. Every URL below is synthetic.
 *
 * This encodes two real incidents: T81/T83 tests writing into a hosted
 * database picked up from the shell, and `prisma migrate status` resolving to
 * production because an inline `DATABASE_URL=` was empty while an ambient
 * DIRECT_URL was not. Both are partial configurations.
 */
describe("migration target guard", () => {
  const POOLED = "postgresql://u:p@ep-synthetic-one-pooler.example.neon.tech/db";
  const DIRECT = "postgresql://u:p@ep-synthetic-one.example.neon.tech/db";
  const OTHER = "postgresql://u:p@ep-synthetic-two.example.neon.tech/db";

  it("allows a database-free environment so prisma generate still runs", () => {
    expect(() => assertConsistentMigrationTarget({})).not.toThrow();
    expect(() => assertConsistentMigrationTarget({ DATABASE_URL: "" })).not.toThrow();
  });

  it("allows DATABASE_URL alone, deriving the direct host from it", () => {
    expect(() => assertConsistentMigrationTarget({ DATABASE_URL: POOLED })).not.toThrow();
    expect(resolveDirectUrl({ DATABASE_URL: POOLED })).toBe(DIRECT);
  });

  it("allows a pooled/direct pair naming the same database", () => {
    expect(() => assertConsistentMigrationTarget({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT })).not.toThrow();
  });

  it("refuses a direct override when DATABASE_URL is empty — the exact ambient-shell incident", () => {
    for (const name of ["DIRECT_URL", "DATABASE_URL_UNPOOLED", "DIRECT_DATABASE_URL"]) {
      expect(() => assertConsistentMigrationTarget({ DATABASE_URL: "", [name]: DIRECT }))
        .toThrow(`${name} is set but DATABASE_URL is empty`);
    }
  });

  it("still allows an explicit direct override naming another host — the documented escape hatch", () => {
    expect(() => assertConsistentMigrationTarget({ DATABASE_URL: POOLED, DIRECT_URL: OTHER })).not.toThrow();
  });

  it("never puts a connection string in the error message", () => {
    try {
      assertConsistentMigrationTarget({ DATABASE_URL: "", DIRECT_URL: DIRECT });
      throw new Error("expected a refusal");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("postgresql://");
      expect(message).not.toContain("u:p@");
    }
  });
});
