/** Seed inputs/expectations ONLY. Never import scripts/board-demo from src/. */
export const BOARD1 = {
  fixtureVersion: "BOARD-1", organisation: "Northstar Identification — DEMONSTRATION",
  asOfDate: "2026-09-08", operationalTimezone: "Europe/London",
  from: "2026-01", to: "2026-08", previousFrom: "2025-01", previousTo: "2025-08",
  disclosure: "Synthetic demonstration — not company performance",
  currentKg: 1248000, previousKg: 1560000, marketBasedScope2Kg: 216000,
  monthlyCurrentKg: [168000,162000,156000,154000,150000,148000,152000,158000],
  monthlyPreviousKg: [210000,204000,198000,196000,194000,188000,186000,184000],
  sites: [
    { key: "north-works", name: "North Works", activity: "Manufacturing", scope1Share: 5/6, scope2Share: 25/36, scope3Share: .8 },
    { key: "east-cards", name: "East Cards", activity: "Metal-card and bureau operations", scope1Share: 1/6, scope2Share: 10/36, scope3Share: .18 },
    { key: "central-digital", name: "Central Digital", activity: "Office and software", scope1Share: 0, scope2Share: 1/36, scope3Share: .02 },
  ],
  sourceKeys: {
    "north-works": ["gas","fleet","electricity","substrate","services","consumables","travel","commuting"],
    "east-cards": ["gas","fleet","electricity","substrate","services","consumables","travel","commuting"],
    "central-digital": ["electricity-a","electricity-b","services-a","services-b","services-c","services-d","travel","commuting"],
  },
  lca: { product: "Demo transit card, v1", declaredUnit: "One finished card", boundary: "Cradle-to-gate", baseline: { materials: .084, manufacture: .024, transport: .012 }, scenario: { materials: .066, manufacture: .024, transport: .012 } },
} as const;
export interface CarbonTarget { year: number; month: string; siteKey: string; scope1Kg: number; scope2LocationKg: number; scope2MarketKg: number; scope3Kg: number; totalKg: number }
const round = (n: number) => Math.round(n * 1000000) / 1000000;
export function buildCarbonTargets(): CarbonTarget[] {
  return ([2026,2025] as const).flatMap(year => {
    const totals = year === 2026 ? BOARD1.monthlyCurrentKg : BOARD1.monthlyPreviousKg;
    const multiplier = year === 2026 ? 1 : 1.25;
    return totals.flatMap((total, monthIndex) => BOARD1.sites.map(site => {
      const scope1Kg = round(27000 * multiplier * site.scope1Share), scope2LocationKg = round(54000 * multiplier * site.scope2Share);
      const scope3Kg = round((total - 81000 * multiplier) * site.scope3Share);
      return { year, month: `${year}-${String(monthIndex+1).padStart(2,"0")}`, siteKey: site.key, scope1Kg, scope2LocationKg, scope2MarketKg: scope2LocationKg / 2, scope3Kg, totalKg: round(scope1Kg + scope2LocationKg + scope3Kg) };
    }));
  });
}
/** Balance only synthetic Category 1 inputs after the retained engine produces its actual valid Category 3. */
export function scope3Allocation(totalKg: number, derivedCategory3Kg: number) {
  const category6Kg = round(totalKg * .15), category7Kg = round(totalKg * .05);
  const category1Kg = round(totalKg - derivedCategory3Kg - category6Kg - category7Kg);
  if (![totalKg, derivedCategory3Kg, category1Kg].every(Number.isFinite) || derivedCategory3Kg < 0 || category1Kg < 0) throw new Error("Engine result cannot fit the agreed synthetic category envelope");
  return { category1Kg, category3Kg: derivedCategory3Kg, category6Kg, category7Kg };
}
/**
 * Both years' obligations, at the SAME fine per-source granularity —
 * Checkpoint B corrective handoff §2: the prior (2025) comparable window
 * now goes through the identical real per-source construction as the
 * current (2026) window (see live-seed-port.ts's shared per-year carbon
 * pipeline), so its reviewable obligation set is genuinely comparable in
 * shape, not a coarser stand-in invented just to make the two years look
 * alike. 192 obligations per year (3 sites x 8 sources x 8 months) = 384
 * total.
 */
export function buildSubmissionObligations() {
  return ([2026, 2025] as const).flatMap(year =>
    BOARD1.sites.flatMap(site =>
      Array.from({ length: 8 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).flatMap(month =>
        BOARD1.sourceKeys[site.key].map(source => ({ externalKey: `BOARD-1:${site.key}:${month}:${source}`, siteKey: site.key, month, source, status: "REVIEW_REQUIRED" as const })),
      ),
    ),
  );
}
export function buildActionPlan() {
  return Array.from({ length: 13 }, (_, i) => ({
    externalKey: `BOARD-1:action:${String(i+1).padStart(2,"0")}`,
    title: i === 0 ? "Confirm monthly containment inspection ownership" : i === 11 ? "Verify containment check effectiveness" : `Demonstration improvement action ${i+1}`,
    intendedState: i >= 11 ? "COMPLETED" as const : "OPEN" as const,
    dueDate: i < 3 ? `2026-09-0${i+1}` : `2026-09-${String(15+i).padStart(2,"0")}`,
    requiresVerification: true,
  }));
}
export const IMPROVEMENT_CHAIN = [
  { key: "DEM-ASP-004", kind: "aspect", title: "Solvent storage and transfer", detail: "Fictional materials-handling process with local water/soil impact under abnormal conditions." },
  { key: "DEM-OBL-004", kind: "internal-requirement", title: "Monthly containment inspection", detail: "Fictional internal requirement; not invented statutory law or a permit." },
  { key: "DEM-CTL-002", kind: "control", title: "Containment inspection procedure", detail: "Controlled synthetic revision 2; named checks and retained evidence." },
  { key: "DEM-OBJ-003", kind: "objective", title: "Improve containment assurance", detail: "Measured assurance coverage; action completion alone does not achieve it." },
  { key: "DEM-FND-006", kind: "finding", title: "Inspection ownership not consistently recorded", detail: "Synthetic audit finding linked to source evidence and requirement revision." },
  { key: "DEM-NC-002", kind: "nonconformity", title: "Containment inspection gap", detail: "One synthetic corrective-action chain with independent effectiveness review." },
] as const;
