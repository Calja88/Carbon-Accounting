/**
 * BD07: the product LCA footprint (e.g. 0.120 / 0.102 kgCO2e per card) must
 * never be added into corporate Scope 1/2/3 totals or the Overview headline.
 * There is no shared model between the two domains — `LcaCalculationResult`/
 * `LcaCalculationRun` are entirely separate tables from `Calculation`/
 * `ActivityEntry` — so this is proven structurally: the corporate analytics
 * read path contains no reference to any Lca* symbol, and the new BD07
 * live-lca adapter never touches the corporate Calculation/ActivityEntry
 * models or the corporate analytics module.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("LCA / corporate carbon separation", () => {
  it("the corporate analytics engine never references an Lca* model or module", () => {
    const analytics = read("../../analytics-service.ts");
    expect(analytics).not.toMatch(/\bLca[A-Z]/);
    expect(analytics).not.toMatch(/["'`][^"'`]*\/lca\//);
  });

  it("the corporate calculation write path never references an Lca* model or module", () => {
    const entries = read("../../entries-service.ts");
    expect(entries).not.toMatch(/\bLca[A-Z]/);
    expect(entries).not.toMatch(/["'`][^"'`]*\/lca\//);
  });

  it("the BD07 live-lca adapter never reads or writes the corporate Calculation/ActivityEntry models or analytics module", () => {
    const liveLca = read("../live-lca.ts");
    expect(liveLca).not.toMatch(/\bprisma\.calculation\b/i);
    expect(liveLca).not.toMatch(/\bprisma\.activityEntry\b/i);
    expect(liveLca).not.toMatch(/["'`][^"'`]*\/analytics-service["'`]/);
    expect(liveLca).not.toMatch(/["'`][^"'`]*\/entries-service["'`]/);
  });

  it("the BD07 board scenario component only ever separately labels the LCA figures as apart from corporate carbon", () => {
    const scenario = read("../../../components/board/lca-scenario.tsx");
    expect(scenario).toMatch(/separate from the corporate carbon inventory/);
  });
});
