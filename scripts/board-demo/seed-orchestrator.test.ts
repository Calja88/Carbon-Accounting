import { describe, expect, it, vi } from "vitest";
import { seedBoardDemo } from "./seed-orchestrator";
import type { DemoSeedPort } from "./seed-orchestrator";
const env={dataMode:"synthetic",deploymentClass:"private-demo",configuredDatabaseId:"db",allowedDatabaseId:"db",configuredEnvironmentId:"env"};
function port():DemoSeedPort { return {
  readConnectedIdentity:vi.fn(async()=>({actualDatabaseId:"db",manifestEnvironmentId:"env",dataClass:"SYNTHETIC" as const,disposable:true,ordinaryOrganisationCount:0})),
  withExclusiveFixtureLease:async(_,operation)=>operation(),existingFixture:async()=>null,verifyExistingFixture:vi.fn(async()=>{}),beginFixture:vi.fn(async()=>{}),
  createSyntheticOrganisationAndActors:vi.fn(async()=>{}),createAndCalculateCarbon:vi.fn(async()=>{}),storeEvidence:vi.fn(async()=>{}),createImprovementChain:vi.fn(async()=>{}),createAndCalculateLca:vi.fn(async()=>{}),createFrozenManagementPack:vi.fn(async()=>{}),verifyAllInvariants:vi.fn(async()=>({digest:"a".repeat(64)})),markFixtureReady:vi.fn(async()=>{}),
}; }
describe("seed orchestration safety",()=>{
  it("checks identity before beginning fixture",async()=>{const p=port();await expect(seedBoardDemo(p,{...env,allowedDatabaseId:"other"})).rejects.toThrow();expect(p.beginFixture).not.toHaveBeenCalled();expect(p.createSyntheticOrganisationAndActors).not.toHaveBeenCalled();});
  it("checks identity again under the exclusive lease",async()=>{const p=port();await seedBoardDemo(p,env);expect(p.readConnectedIdentity).toHaveBeenCalledTimes(2);expect(p.beginFixture).toHaveBeenCalledWith("BOARD-1");expect(p.markFixtureReady).toHaveBeenCalledWith("BOARD-1","a".repeat(64));});
  it("never marks a failed carbon build ready",async()=>{const p=port();p.createAndCalculateCarbon=async()=>{throw Error("Engine mismatch");};await expect(seedBoardDemo(p,env)).rejects.toThrow("Engine mismatch");expect(p.beginFixture).toHaveBeenCalled();expect(p.markFixtureReady).not.toHaveBeenCalled();});
  it("refuses a partial fixture instead of overwriting it",async()=>{const p=port();p.existingFixture=async()=>({version:"BOARD-1",digest:""});await expect(seedBoardDemo(p,env)).rejects.toThrow("fresh empty");expect(p.beginFixture).not.toHaveBeenCalled();});
  it("verifies a READY fixture without repeating writes",async()=>{const p=port();p.existingFixture=async()=>({version:"BOARD-1",digest:"a".repeat(64)});expect(await seedBoardDemo(p,env)).toBe("verified-existing");expect(p.verifyExistingFixture).toHaveBeenCalled();expect(p.createAndCalculateCarbon).not.toHaveBeenCalled();});
  it("rejects invalid reconciliation digests",async()=>{const p=port();p.verifyAllInvariants=async()=>({digest:"fake"});await expect(seedBoardDemo(p,env)).rejects.toThrow("digest");expect(p.markFixtureReady).not.toHaveBeenCalled();});
});
