import { describe, expect, it } from "vitest";
import { assertValidDatabaseUrl, prisma } from "@/lib/prisma";
import { deriveDirectUrl, resolveDirectUrl } from "../../../prisma.config";

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
