import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { BOARD1, buildActionPlan, buildCarbonTargets, buildSubmissionObligations, scope3Allocation } from "./board1";
import { buildSyntheticEvidence } from "./evidence";
import { assertDemoTarget } from "./guard";
const validEnv = { dataMode: "synthetic", deploymentClass: "private-demo", configuredDatabaseId: "db-demo", allowedDatabaseId: "db-demo", configuredEnvironmentId: "env-demo" };
const validDb = { actualDatabaseId: "db-demo", manifestEnvironmentId: "env-demo", dataClass: "SYNTHETIC" as const, disposable: true, ordinaryOrganisationCount: 0 };
describe("BOARD-1 seed specification", () => {
  it("matches both headline totals", () => { const rows = buildCarbonTargets(); for (const [year, expected] of [[2026,1248000],[2025,1560000]]) expect(rows.filter(r => r.year === year).reduce((sum,r) => sum+r.totalKg,0)).toBeCloseTo(expected,6); });
  it("reconciles every month", () => { const rows = buildCarbonTargets(); BOARD1.monthlyCurrentKg.forEach((total,i) => expect(rows.filter(r => r.month === `2026-${String(i+1).padStart(2,"0")}`).reduce((sum,r) => sum+r.totalKg,0)).toBeCloseTo(total,6)); });
  it("matches the three site totals", () => { const rows = buildCarbonTargets().filter(r => r.year === 2026); expect(BOARD1.sites.map(s => rows.filter(r => r.siteKey === s.key).reduce((sum,r) => sum+r.totalKg,0))).toEqual([960000,264000,24000]); });
  it("keeps MB out of headline", () => { const rows = buildCarbonTargets().filter(r => r.year === 2026); expect(rows.reduce((sum,r) => sum+r.scope2MarketKg,0)).toBe(216000); expect(rows.every(r => Math.abs(r.totalKg-r.scope1Kg-r.scope2LocationKg-r.scope3Kg)<.000001)).toBe(true); });
  it("has exactly 192 unique source obligations", () => { const rows = buildSubmissionObligations(); expect(rows).toHaveLength(192); expect(new Set(rows.map(r=>r.externalKey)).size).toBe(192); expect(rows.every(r => !r.source.includes("category3"))).toBe(true); });
  it("uses valid derived Category 3 and balances only synthetic Category 1", () => { const parts = scope3Allocation(100,13); expect(parts).toEqual({category1Kg:67,category3Kg:13,category6Kg:15,category7Kg:5}); expect(() => scope3Allocation(100,90)).toThrow(); });
  it("contains 11 open and two completed actions, three overdue", () => { const rows = buildActionPlan(); expect(rows.filter(r=>r.intendedState==="OPEN")).toHaveLength(11); expect(rows.filter(r=>r.dueDate<BOARD1.asOfDate)).toHaveLength(3); });
  it("reconciles LCA totals without adding them to corporate targets", () => { const total = (v: typeof BOARD1.lca.baseline | typeof BOARD1.lca.scenario) => v.materials+v.manufacture+v.transport; expect(total(BOARD1.lca.baseline)).toBeCloseTo(.120); expect(total(BOARD1.lca.scenario)).toBeCloseTo(.102); });
  it("builds real deterministic evidence bytes and checksums", () => { const a=buildSyntheticEvidence(), b=buildSyntheticEvidence(); expect(a).toHaveLength(6); a.forEach((f,i)=>{expect(f.bytes.length).toBeGreaterThan(100); expect(createHash("sha256").update(f.bytes).digest("hex")).toBe(f.sha256); expect(f.sha256).toBe(b[i].sha256); expect(f.bytes.toString("utf8")).toContain("Synthetic demonstration");}); });
});
describe("demo target guard", () => {
  it("permits independently matched disposable identity", () => expect(()=>assertDemoTarget(validEnv,validDb)).not.toThrow());
  it("rejects production mode", () => expect(()=>assertDemoTarget({...validEnv,dataMode:"production"},validDb)).toThrow());
  it("rejects an ordinary tenant even in a demo-labelled database", () => expect(()=>assertDemoTarget(validEnv,{...validDb,ordinaryOrganisationCount:1})).toThrow());
  it("rejects false configured identity", () => expect(()=>assertDemoTarget(validEnv,{...validDb,actualDatabaseId:"other"})).toThrow());
  it("rejects a missing manifest", () => expect(()=>assertDemoTarget(validEnv,{...validDb,manifestEnvironmentId:""})).toThrow());
  it("rejects non-disposable data", () => expect(()=>assertDemoTarget(validEnv,{...validDb,disposable:false})).toThrow());
});
