import { describe, expect, it, vi } from "vitest";
import type { CarbonMetric, Coverage } from "../contracts";
import { assertCoverage, compareCarbon, dateOnly, formatTonnes, isOverdue } from "../metrics";
import { actionAttention, actionCounts, dedupeActions, mergeAttention } from "../attention";
import type { AuthorizedAction } from "../attention";
import { activeNavId, BOARD_NAV, carbonHref, localHref } from "../navigation";
import { boardPeriodSchema, boardTransitionSchema } from "../schemas";
import { loadOverview } from "../overview-service";
import type { OverviewPorts } from "../overview-service";
import { executeCalculation } from "../calculation-orchestration";
const coverage: Coverage = { expected: 192, received: 192, reviewed: 192, excluded: 0, awaitingFactor: 0, flagged: 0 };
function metric(kgCO2e: number | null, patch: Partial<CarbonMetric> = {}): CarbonMetric { return { kgCO2e, state: "complete", comparisonKey: "same-covered-boundary", coverage: { ...coverage }, source: { label: "Inventory", href: "/carbon" }, ...patch }; }
function action(patch: Partial<AuthorizedAction> = {}): AuthorizedAction { return { id: "a1", canonicalActionId: "canonical-1", title: "Containment check", state: "OPEN", requiresVerification: true, dueDate: "2026-09-07", owner: "Demo Owner", site: "North Works", source: { id: "a1", kind: "action", revision: "1", label: "Containment check", href: "/ems/actions/a1" }, blocker: null, ...patch }; }

describe("honest carbon metrics", () => {
  it("reconciles BOARD-1 without kg/tonne inflation", () => { expect(compareCarbon(metric(1248000), metric(1560000)).percent).toBe(-20); expect(formatTonnes(1248000)).toBe("1,248"); });
  it("never calls missing current data a 100% reduction", () => expect(compareCarbon(metric(null, { state: "missing" }), metric(100)).percent).toBeNull());
  it("permits a real reviewed zero with complete coverage", () => expect(compareCarbon(metric(0), metric(100)).percent).toBe(-100));
  it("does not compare unreviewed coverage", () => expect(compareCarbon(metric(80, { coverage: { ...coverage, reviewed: 191 } }), metric(100)).percent).toBeNull());
  it("does not compare unknown expected coverage", () => expect(compareCarbon(metric(80, { coverage: { ...coverage, expected: null } }), metric(100)).percent).toBeNull());
  it("does not compare zero expected obligations", () => expect(compareCarbon(metric(0, { coverage: { ...coverage, expected: 0, received: 0, reviewed: 0 } }), metric(100)).percent).toBeNull());
  it.each(["flagged", "awaitingFactor", "excluded"] as const)("does not hide %s rows", key => expect(compareCarbon(metric(80, { coverage: { ...coverage, [key]: 1 } }), metric(100)).percent).toBeNull());
  it("rejects unlike boundaries", () => expect(compareCarbon(metric(80), metric(100, { comparisonKey: "other" })).percent).toBeNull());
  it("rejects zero prior baseline", () => expect(compareCarbon(metric(80), metric(0)).percent).toBeNull());
  it("rejects NaN", () => expect(compareCarbon(metric(NaN), metric(100)).percent).toBeNull());
  it("rejects impossible denominators", () => expect(() => assertCoverage({ ...coverage, reviewed: 193 })).toThrow());
});
describe("date and route boundaries", () => {
  it("due today is not overdue", () => expect(isOverdue("2026-09-08", "2026-09-08")).toBe(false));
  it("yesterday is overdue", () => expect(isOverdue("2026-09-07", "2026-09-08")).toBe(true));
  it("rejects impossible dates", () => expect(() => dateOnly("2026-02-30")).toThrow());
  it.each(["//evil.test", "/\\evil.test", "javascript:alert(1)", "/\n/evil.test"])("rejects unsafe URL %s", href => expect(() => localHref(href)).toThrow());
  it("avoids partial route prefix collisions", () => expect(activeNavId(BOARD_NAV, "/entry-other")).toBeNull());
  it("uses the correct carbon destination", () => expect(activeNavId(BOARD_NAV, "/calculations/abc")).toBe("carbon"));
  it("preserves exact source filters", () => expect(carbonHref("/entry?status=missing", { from: "2026-01", to: "2026-08", siteId: "a b" })).toBe("/entry?status=missing&from=2026-01&to=2026-08&siteId=a+b"));
  it("validates period order", () => expect(boardPeriodSchema.safeParse({ from: "2026-08", to: "2026-01" }).success).toBe(false));
  it("rejects actor/policy injection", () => expect(boardTransitionSchema.safeParse({ recordId: "x", expectedRevision: "1", decision: "effective", rationale: "Review evidence meets the stated criteria", evidenceIds: [], effectiveDate: "2026-09-08", fourEyesEnabled: false }).success).toBe(false));
});
describe("canonical action attention", () => {
  it("completion moves work to verification rather than vanishing", () => { const rows = [action({ state: "COMPLETED" })]; expect(actionCounts(rows)).toEqual({ open: 0, awaitingVerification: 1 }); expect(actionAttention(rows, "2026-09-08")[0].reason).toBe("verification"); });
  it("verification removes resolved work", () => expect(actionAttention([action({ state: "VERIFIED" })], "2026-09-08")).toEqual([]));
  it("does not invent verification when domain policy does not require it", () => expect(actionAttention([action({ state: "COMPLETED", requiresVerification: false })], "2026-09-08")).toEqual([]));
  it("does not count linked CAPA twice", () => expect(actionCounts([action(), action({ id: "capa1" })]).open).toBe(1));
  it("surfaces a divergent canonical state", () => expect(() => dedupeActions([action(), action({ id: "capa1", state: "COMPLETED" })])).toThrow());
  it("puts blockers before ordinary open work", () => { const items = actionAttention([action(), action({ id: "b", canonicalActionId: "b", state: "BLOCKED" })], "2026-09-08"); expect(mergeAttention([items])[0].reason).toBe("blocked"); });
});
describe("read-model composition", () => {
  function ports(): OverviewPorts<string> { return {
    authorizeScope: vi.fn(async () => {}), header: async () => ({ organisationName: "Synthetic", periodLabel: "Jan–Aug 2026", previousPeriodLabel: "Jan–Aug 2025", synthetic: true, managementPack: null }),
    carbon: async () => ({ state: "unavailable", message: "Not available" }), attention: async () => ({ state: "ready", data: { items: [], total: 0, openActions: 0, awaitingVerification: 0 }, asOf: "2026-09-08" }), priorities: async () => ({ state: "ready", data: [], asOf: "2026-09-08" }), sectionFailure: vi.fn(),
  }; }
  const scope = { organisationId: "demo", siteIds: ["s1"], from: "2026-01", to: "2026-08", asOfDate: "2026-09-08" };
  it("authorizes before reading anything", async () => { const p = ports(); p.authorizeScope = async () => { throw Error("Denied"); }; p.carbon = vi.fn(); await expect(loadOverview(p, "ctx", scope)).rejects.toThrow("Denied"); expect(p.carbon).not.toHaveBeenCalled(); });
  it("does not turn a provider error into zero", async () => { const p = ports(); p.carbon = async () => { throw Error("Provider failed"); }; const result = await loadOverview(p, "ctx", scope); expect(result.carbon.state).toBe("unavailable"); expect(result.attention.state).toBe("ready"); expect(p.sectionFailure).toHaveBeenCalledWith("carbon"); });
});
describe("calculation orchestration contract", () => {
  const request = { organisationId: "o", entryId: "e", inputRevision: "r1", idempotencyKey: "k", inputDigest: "d" };
  it("locks, authorizes, checks replay, calculates and saves in order", async () => { const order: string[] = [];
    const result = await executeCalculation<number, number>({ transaction: async op => op({ lockEntryAndPeriod: async () => { order.push("lock"); }, authorizeAndLoad: async () => { order.push("authorize"); return 5; }, findRun: async () => { order.push("find"); return null; }, saveRun: async (_, result) => { order.push("save"); return { id: "run", inputDigest: "d", result }; } }), calculate: input => { order.push("calculate"); return input * 2; } }, request);
    expect(order).toEqual(["lock", "authorize", "find", "calculate", "save"]); expect(result.result).toBe(10);
  });
  it("reuses existing run without calculating again", async () => { const calculate = vi.fn(); const run = { id: "run", inputDigest: "d", result: 10 };
    const result = await executeCalculation({ transaction: async op => op({ lockEntryAndPeriod: async () => {}, authorizeAndLoad: async () => 5, findRun: async () => run, saveRun: vi.fn() }), calculate }, request);
    expect(result).toBe(run); expect(calculate).not.toHaveBeenCalled();
  });
  it("rejects key reuse with another input digest", async () => { await expect(executeCalculation({ transaction: async op => op({ lockEntryAndPeriod: async () => {}, authorizeAndLoad: async () => 5, findRun: async () => ({ id: "run", inputDigest: "other", result: 10 }), saveRun: vi.fn() }), calculate: n => n }, request)).rejects.toThrow("different inputs"); });
});
