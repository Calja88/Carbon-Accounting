import { describe, expect, it } from "vitest";
import { assertValidDatabaseUrl, prisma } from "@/lib/prisma";
import { deriveDirectUrl } from "../../../prisma.config";

/**
 * Neon pooled/direct configuration (T02): a malformed DATABASE_URL fails
 * safely without leaking the value, a missing one is left to PrismaClient's
 * own lazy handling (so importing this module in a test/build context that
 * never queries the database still works, as it always has), and the
 * pooled -> direct URL derivation used by prisma.config.ts is deterministic.
 * All URLs here are synthetic fixtures, not real credentials.
 */

describe("assertValidDatabaseUrl", () => {
  it("returns undefined when DATABASE_URL is missing, without throwing", () => {
    expect(assertValidDatabaseUrl(undefined)).toBeUndefined();
    expect(assertValidDatabaseUrl("")).toBeUndefined();
  });

  it("throws a safe error when DATABASE_URL is not a valid connection string", () => {
    expect(() => assertValidDatabaseUrl("not-a-url")).toThrow("DATABASE_URL is not a valid connection string");
  });

  it("does not include the raw malformed value in the thrown message", () => {
    const malformed = "not-a-url-with-secret-token";
    try {
      assertValidDatabaseUrl(malformed);
      throw new Error("expected assertValidDatabaseUrl to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(malformed);
    }
  });

  it("returns the URL unchanged when it is a valid connection string", () => {
    const url = "postgresql://user:pass@fake-pooler.example.neon.tech/db?sslmode=require";
    expect(assertValidDatabaseUrl(url)).toBe(url);
  });
});

describe("prisma singleton", () => {
  it("constructs without a live database connection (importable in tests/builds with no DATABASE_URL)", () => {
    expect(prisma).toBeDefined();
  });
});

describe("deriveDirectUrl", () => {
  it("removes the -pooler suffix from a Neon pooled hostname", () => {
    const pooled = "postgresql://user:pass@ep-fake-branch-pooler.eu-west-2.aws.neon.tech/db?sslmode=require";
    const direct = deriveDirectUrl(pooled);
    expect(direct).toContain("ep-fake-branch.eu-west-2.aws.neon.tech");
    expect(direct).not.toContain("-pooler");
  });

  it("leaves a non-pooled hostname unchanged", () => {
    const url = "postgresql://user:pass@localhost:5432/paragon_carbon?schema=public";
    expect(deriveDirectUrl(url)).toBe(url);
  });

  it("returns an empty string unchanged", () => {
    expect(deriveDirectUrl("")).toBe("");
  });

  it("hands back an unparsable value untouched rather than throwing", () => {
    expect(deriveDirectUrl("not-a-url")).toBe("not-a-url");
  });
});
