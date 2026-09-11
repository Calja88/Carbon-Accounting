import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "../local-database-url";

describe("localDatabaseUrl", () => {
  it("returns a local URL so the live integration tests can run", () => {
    expect(localDatabaseUrl({ DATABASE_URL: "postgresql://paragon:paragon@localhost:5432/paragon_carbon" })).toContain("localhost");
  });

  it("refuses a hosted database — a set DATABASE_URL is not consent to write to it", () => {
    expect(localDatabaseUrl({ DATABASE_URL: "postgresql://u:p@ep-synthetic-example-pooler.eu-west-2.aws.neon.tech/appdb" })).toBeUndefined();
    expect(localDatabaseUrl({ DIRECT_URL: "postgresql://u:p@db.example.com:5432/app", DATABASE_URL: "postgresql://u:p@localhost:5432/app" })).toBeUndefined();
  });

  it("is undefined when nothing is configured, or when the URL cannot be parsed", () => {
    expect(localDatabaseUrl({})).toBeUndefined();
    expect(localDatabaseUrl({ DATABASE_URL: "not a url" })).toBeUndefined();
  });
});
