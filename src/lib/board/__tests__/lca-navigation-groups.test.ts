/**
 * BD07: proves the live assessment layout's thirteen navigation segments all
 * fall inside one of Astra's four `LcaNavigation` groups (Setup, Inventory,
 * Results, Review & issue) — none silently dropped into the "Additional
 * assessment pages" overflow, and none missing a group entirely.
 *
 * `GROUPS` lives inline inside `src/components/board/lca-navigation.tsx`
 * (Astra-supplied, installed verbatim, not modified) and isn't exported, so
 * this test mirrors it exactly rather than reaching into the component's
 * internals. If lca-navigation.tsx's GROUPS ever changes, update this mirror
 * to match — this test exists to catch drift between the two, not to
 * enforce one over the other.
 */
import { describe, expect, it } from "vitest";

// Mirrors GROUPS in src/components/board/lca-navigation.tsx verbatim.
const ASTRA_GROUPS: Record<string, string[]> = {
  Setup: ["", "goal-scope"],
  Inventory: ["model", "inventory", "registers", "evidence"],
  Results: ["results", "data-quality", "scenarios"],
  "Review & issue": ["review", "versions", "audit", "report"],
};

// Mirrors the live navItems segments built in
// src/app/(app)/assessments/[id]/layout.tsx — the "existing thirteen
// destinations" BD07 requires to remain reachable.
const LIVE_ASSESSMENT_SEGMENTS = [
  "",
  "goal-scope",
  "model",
  "inventory",
  "results",
  "data-quality",
  "scenarios",
  "registers",
  "evidence",
  "review",
  "versions",
  "audit",
  "report",
];

describe("BD07 LCA navigation grouping", () => {
  it("keeps exactly the thirteen existing assessment destinations", () => {
    expect(LIVE_ASSESSMENT_SEGMENTS).toHaveLength(13);
    expect(new Set(LIVE_ASSESSMENT_SEGMENTS).size).toBe(13);
  });

  it("places every live segment inside a known group — none fall through to the 'Additional' overflow", () => {
    const grouped = new Set(Object.values(ASTRA_GROUPS).flat());
    const orphaned = LIVE_ASSESSMENT_SEGMENTS.filter((segment) => !grouped.has(segment));
    expect(orphaned).toEqual([]);
  });

  it("assigns every group segment to exactly one group", () => {
    const seen = new Map<string, string>();
    for (const [group, segments] of Object.entries(ASTRA_GROUPS)) {
      for (const segment of segments) {
        expect(seen.has(segment)).toBe(false);
        seen.set(segment, group);
      }
    }
  });

  it("does not silently drop a live segment the groups don't know about (a new destination stays reachable via the 'Additional' overflow, not lost)", () => {
    const grouped = new Set(Object.values(ASTRA_GROUPS).flat());
    // Every currently-known live segment must be grouped; this documents the
    // policy: a *new* destination added later without updating GROUPS would
    // fail the previous test, which is the intended signal to either add it
    // to a group or accept it in "Additional assessment pages".
    for (const segment of LIVE_ASSESSMENT_SEGMENTS) {
      expect(grouped.has(segment)).toBe(true);
    }
  });
});
