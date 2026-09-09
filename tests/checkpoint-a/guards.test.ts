import { describe, it, expect } from "vitest";
import { assertCompletePrimaryCalculations as check, CalculationIntegrityError } from "@/lib/calculation-integrity";
import { requireCarbonView, requireFrozenReportAccess } from "@/lib/rbac/carbon-access";
import { requireUnscopedEmsAccess } from "@/lib/rbac/ems-access";
import { makeOrganisationContext, ORG_A } from "@/lib/__tests__/tenant-fixtures";
import { POST } from "@/app/api/ai/chat/route";
import { GET } from "@/app/api/ai/status/route";
const scope = "SCOPE_2";
const row = (basis: string) => ({ basis, scope, derivedFromCalculationId: null });
describe("Checkpoint A primary integrity", () => {
  it("permits a first calculation and both valid Scope 2 pairs", () => {
    check([], scope, "grid_electricity");
    for (const companion of ["MARKET_BASED", "RESIDUAL_MIX"]) check([row("LOCATION_BASED"), row(companion)], scope, "grid_electricity");
  });
  it.each([[row("LOCATION_BASED")], [row("RESIDUAL_MIX")], [row("LOCATION_BASED"), row("LOCATION_BASED")], [row("MARKET_BASED"), row("RESIDUAL_MIX")]])("rejects partial or duplicate pairs", (...rows) => {
    expect(() => check(rows, scope, "grid_electricity")).toThrow(CalculationIntegrityError);
  });
  it("rejects derived/wrong-scope rows and duplicate STANDARD history", () => {
    expect(() => check([{ ...row("STANDARD"), derivedFromCalculationId: "primary" }], scope, "other")).toThrow(CalculationIntegrityError);
    expect(() => check([row("STANDARD")], "SCOPE_1", "other")).toThrow(CalculationIntegrityError);
    expect(() => check([row("STANDARD"), row("STANDARD")], scope, "other")).toThrow(CalculationIntegrityError);
  });
});
describe("Checkpoint A permission boundaries", () => {
  const context = makeOrganisationContext(ORG_A, { permissions: new Set(["carbon.view", "carbon.report.export", "ems.view", "ems.aspect.edit"]) });
  it("requires carbon.view independently of export permission", () => {
    expect(() => requireCarbonView({ ...context, permissions: new Set(["carbon.report.export"]) })).toThrow();
  });
  it("requires export grant independently of carbon.view", () => {
    expect(() => requireFrozenReportAccess({ ...context, permissions: new Set(["carbon.view"]) }, true)).toThrow();
  });
  it("denies restricted frozen reports and unscoped aspects even with explicit site grants", () => {
    const restricted = { ...context, access: { mode: "RESTRICTED" as const, siteIds: new Set(["site-a"]), entityIds: new Set(["entity-a"]) } };
    expect(() => requireFrozenReportAccess(restricted)).toThrow();
    expect(() => requireUnscopedEmsAccess(restricted, "ems.aspect.edit")).toThrow();
    expect(() => requireFrozenReportAccess(context, true)).not.toThrow();
  });
  it("disables chat and advertises the same unavailable state", async () => {
    const chat = await POST(); const status = await GET();
    expect(chat.status).toBe(503); expect(await chat.json()).toEqual({ error: { reason: "DISABLED", message: expect.any(String) } });
    expect((await status.json()).available).toBe(false);
  });
});
