import { describe, expect, it } from "vitest";
import { carbonGapAttention, mapCanonicalActionRows } from "../live-overview-helpers";
import { actionAttention, dedupeActions } from "../attention";
import type { WindowCoverage } from "../carbon-adapter";
import type { AuthorizedAnalyticsWindow } from "../carbon-adapter";

const site = (id: string, name: string): AuthorizedAnalyticsWindow["sites"][number] => ({
  siteId: id, siteName: name, entityName: "Entity", totals: { scope1: 0, scope2Location: 0, scope2Market: 0, scope3: 0, total: 0 },
});

const zeroCoverage = () => ({ expected: null, received: 0, reviewed: 0, excluded: 0, awaitingFactor: 0, flagged: 0 });

describe("carbonGapAttention", () => {
  it("flags a site with zero received entries as missing, not a false zero result", () => {
    const coverage: WindowCoverage = { group: zeroCoverage(), sites: { s1: zeroCoverage() }, months: {} };
    const items = carbonGapAttention(coverage, [site("s1", "Site One")]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ reason: "missing", key: "carbon:s1:missing" });
  });

  it("flags flagged and awaiting-factor entries as separate review items, not as missing", () => {
    const coverage: WindowCoverage = {
      group: zeroCoverage(),
      sites: { s1: { ...zeroCoverage(), received: 5, flagged: 2, awaitingFactor: 1 } },
      months: {},
    };
    const items = carbonGapAttention(coverage, [site("s1", "Site One")]);
    const reasons = items.map((i) => i.key).sort();
    expect(reasons).toEqual(["carbon:s1:awaiting-factor", "carbon:s1:flagged"]);
    expect(items.every((i) => i.reason === "review")).toBe(true);
  });

  it("raises nothing for a fully clean site (real submitted data, no issues)", () => {
    const coverage: WindowCoverage = { group: zeroCoverage(), sites: { s1: { ...zeroCoverage(), received: 3, reviewed: 3 } }, months: {} };
    expect(carbonGapAttention(coverage, [site("s1", "Site One")])).toHaveLength(0);
  });
});

describe("mapCanonicalActionRows + dedupe (duplicate CAPA source state)", () => {
  const owner = { user: { name: "Alex Owner" } };

  it("merges a CorrectiveAction into its shared ActionItem as one canonical row when states agree", () => {
    const rows = mapCanonicalActionRows(
      [{ id: "ai-1", title: "Fix the thing", status: "COMPLETED", dueDate: new Date("2026-01-01"), owner, programme: { title: "Programme A" } }],
      [{ id: "ca-1", description: "Fix the thing (CAPA)", status: "COMPLETED", dueDate: new Date("2026-01-01"), sharedActionItemId: "ai-1", nonconformityId: "nc-1", owner }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].canonicalActionId).toBe("ai-1");
    // Both rows canonicalize to the same key and agree on state/dueDate/requiresVerification — dedupeActions collapses them to one,
    // and the merged row surfaces exactly once as "awaiting verification", never twice.
    expect(dedupeActions(rows)).toHaveLength(1);
    const items = actionAttention(rows, "2026-06-01");
    expect(items).toHaveLength(1);
    expect(items[0].reason).toBe("verification");
  });

  it("surfaces a conflict rather than silently picking one status when ActionItem and CorrectiveAction disagree", () => {
    const rows = mapCanonicalActionRows(
      [{ id: "ai-1", title: "Fix the thing", status: "OPEN", dueDate: new Date("2026-01-01"), owner, programme: { title: "Programme A" } }],
      [{ id: "ca-1", description: "Fix the thing (CAPA)", status: "COMPLETED", dueDate: new Date("2026-01-01"), sharedActionItemId: "ai-1", nonconformityId: "nc-1", owner }],
    );
    expect(() => dedupeActions(rows)).toThrow("Conflicting canonical action projection");
  });

  it("completed-with-verification is distinct from open — never counted as open work", () => {
    const rows = mapCanonicalActionRows(
      [
        { id: "ai-open", title: "Open one", status: "OPEN", dueDate: new Date("2026-01-01"), owner, programme: { title: "P" } },
        { id: "ai-done", title: "Done one", status: "COMPLETED", dueDate: new Date("2026-01-01"), owner, programme: { title: "P" } },
      ],
      [],
    );
    expect(rows.find((r) => r.id === "ai-open")?.requiresVerification).toBe(false);
    expect(rows.find((r) => r.id === "ai-done")?.requiresVerification).toBe(true);
  });

  it("a BLOCKED action item carries a real blocker note, not a fabricated one", () => {
    const rows = mapCanonicalActionRows(
      [{ id: "ai-1", title: "Blocked one", status: "BLOCKED", dueDate: new Date("2026-01-01"), owner, programme: { title: "P" } }],
      [],
    );
    expect(rows[0].blocker).not.toBeNull();
  });

  it("falls back to Unassigned rather than a null owner name", () => {
    const rows = mapCanonicalActionRows(
      [{ id: "ai-1", title: "No owner name", status: "OPEN", dueDate: new Date("2026-01-01"), owner: { user: { name: null } }, programme: { title: "P" } }],
      [],
    );
    expect(rows[0].owner).toBe("Unassigned");
  });
});
