import { describe, expect, it } from "vitest";
import { localDatabaseUrl } from "../local-database-url";

// URLs carry no credentials: the guard decides on hostname alone, and a
// credential-shaped literal here would (correctly) trip handoff:secret-audit.
const at = (host: string) => `postgresql://${host}/appdb`;

describe("localDatabaseUrl", () => {
  it("returns a local URL so the live integration tests can run", () => {
    expect(localDatabaseUrl({ DATABASE_URL: at("localhost:5432") })).toContain("localhost");
    expect(localDatabaseUrl({ DATABASE_URL: at("127.0.0.1:5432") })).toContain("127.0.0.1");
  });

  it("refuses a hosted database — a set DATABASE_URL is not consent to write to it", () => {
    expect(localDatabaseUrl({ DATABASE_URL: at("ep-synthetic-example-pooler.eu-west-2.aws.neon.tech") })).toBeUndefined();
    // DIRECT_URL wins, so a hosted DIRECT_URL is refused even beside a local DATABASE_URL.
    expect(localDatabaseUrl({ DIRECT_URL: at("db.example.com:5432"), DATABASE_URL: at("localhost:5432") })).toBeUndefined();
  });

  it("is undefined when nothing is configured, or when the URL cannot be parsed", () => {
    expect(localDatabaseUrl({})).toBeUndefined();
    expect(localDatabaseUrl({ DATABASE_URL: "not a url" })).toBeUndefined();
  });
});
