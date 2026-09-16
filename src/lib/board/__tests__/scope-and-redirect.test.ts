import { describe, expect, it } from "vitest";
import { resolveScopeSelection } from "../live-overview-helpers";
import { carbonRedirectTarget } from "../navigation";

const defaults = { from: "2026-01", to: "2026-09" };

describe("dashboard scope selection", () => {
  it("uses the organisation default period when the URL names none", () => {
    expect(resolveScopeSelection({}, defaults)).toEqual({ from: "2026-01", to: "2026-09" });
  });

  it("honours a period given in the URL", () => {
    expect(resolveScopeSelection({ from: "2025-04", to: "2026-03" }, defaults)).toEqual({ from: "2025-04", to: "2026-03" });
  });

  it("honours a site on its own, defaulting only the period", () => {
    expect(resolveScopeSelection({ siteId: "site-a" }, defaults)).toEqual({ from: "2026-01", to: "2026-09", siteId: "site-a" });
  });

  it("keeps a site alongside an explicit period", () => {
    expect(resolveScopeSelection({ from: "2025-01", to: "2025-12", siteId: "site-a" }, defaults))
      .toEqual({ from: "2025-01", to: "2025-12", siteId: "site-a" });
  });

  it("rejects half a period rather than silently completing it from the default", () => {
    expect(() => resolveScopeSelection({ from: "2026-03" }, defaults)).toThrow();
    expect(() => resolveScopeSelection({ to: "2026-03" }, defaults)).toThrow();
  });

  it("rejects a malformed, reversed or over-long period", () => {
    expect(() => resolveScopeSelection({ from: "2026-13", to: "2026-14" }, defaults)).toThrow();
    expect(() => resolveScopeSelection({ from: "not-a-month", to: "2026-03" }, defaults)).toThrow();
    expect(() => resolveScopeSelection({ from: "2026-09", to: "2026-01" }, defaults)).toThrow();
    expect(() => resolveScopeSelection({ from: "2020-01", to: "2026-01" }, defaults)).toThrow();
  });
});

describe("/carbon redirect", () => {
  it("carries a month period across to the dashboard", () => {
    expect(carbonRedirectTarget({ from: "2026-01", to: "2026-09" })).toBe("/?from=2026-01&to=2026-09");
  });

  it("accepts the full-date form the old links used", () => {
    expect(carbonRedirectTarget({ from: "2026-01-01", to: "2026-09-30" })).toBe("/?from=2026-01&to=2026-09");
  });

  it("carries a site on its own", () => {
    expect(carbonRedirectTarget({ siteId: "abc" })).toBe("/?siteId=abc");
  });

  it("carries period and site together", () => {
    expect(carbonRedirectTarget({ from: "2026-01", to: "2026-09", siteId: "abc" })).toBe("/?from=2026-01&to=2026-09&siteId=abc");
  });

  it("falls back to the bare dashboard rather than guessing at an unusable period", () => {
    expect(carbonRedirectTarget({})).toBe("/");
    expect(carbonRedirectTarget({ from: "junk", to: "2026-09" })).toBe("/");
    expect(carbonRedirectTarget({ from: "2026-13", to: "2026-09" })).toBe("/");
  });

  it("takes the first value of a repeated parameter and never leaves the app", () => {
    expect(carbonRedirectTarget({ from: ["2026-01", "1999-01"], to: "2026-09" })).toBe("/?from=2026-01&to=2026-09");
    expect(carbonRedirectTarget({ siteId: "../../evil" })).toBe("/?siteId=..%2F..%2Fevil");
  });
});
