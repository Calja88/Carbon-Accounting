import { describe, expect, it } from "vitest";
import { buildCarbonSection } from "../carbon-adapter";
import type { CarbonAdapterInput } from "../carbon-adapter";
function input():CarbonAdapterInput {
  const coverage={expected:1,received:1,reviewed:1,excluded:0,awaitingFactor:0,flagged:0};
  const totals={scope1:10,scope2Location:20,scope2Market:5,scope3:30,total:60};
  return {current:{group:{...totals},sites:[{siteId:"a",siteName:"A",entityName:"Synthetic",totals:{...totals}}],monthly:[{month:"2026-01",label:"Jan",total:60}]},previous:{group:{...totals},sites:[{siteId:"a",siteName:"A",entityName:"Synthetic",totals:{...totals}}],monthly:[{month:"2025-01",label:"Jan",total:60}]},currentCoverage:{group:{...coverage},sites:{a:{...coverage}},months:{"2026-01":{...coverage}}},previousCoverage:{group:{...coverage},sites:{a:{...coverage}},months:{"2025-01":{...coverage}}},from:"2026-01",to:"2026-01",previousFrom:"2025-01",previousTo:"2025-01",permittedSiteIds:["a"],selectedSiteId:"a",currentComparisonKey:"same",previousComparisonKey:"same",quantifiedCategories:4,screenedCategories:15,screenedCategoriesReason:null,asOf:"2026-09-08",marketBasedAvailable:true};
}
describe("actual analytics shape adapter",()=>{
  it("does not invent a zero MB companion when its rows are absent",()=>{const data=input();data.marketBasedAvailable=false;const out=buildCarbonSection(data);if(out.state!=="ready")throw Error();expect(out.data.marketBasedKg).toBeNull();});
  it("keeps kg and market basis separate",()=>{const out=buildCarbonSection(input());expect(out.state).toBe("ready");if(out.state==="ready"){expect(out.data.current.kgCO2e).toBe(60);expect(out.data.marketBasedKg).toBe(5);}});
  it("preserves selected site in hero and month drilldowns",()=>{const out=buildCarbonSection(input());if(out.state!=="ready")throw Error();expect(out.data.current.source.href).toContain("siteId=a");expect(out.data.trend[0].href).toContain("siteId=a");});
  it("rejects foreign site rows",()=>{const data=input();data.permittedSiteIds=["other"];expect(()=>buildCarbonSection(data)).toThrow("scope");});
  it("rejects a market companion added into headline",()=>{const data=input();data.current.group.total+=5;expect(()=>buildCarbonSection(data)).toThrow("headline");});
  it("rejects inconsistent site totals",()=>{const data=input();data.current.sites=[];expect(()=>buildCarbonSection(data)).toThrow("Site and group");});
  it("rejects a monthly total that differs from headline",()=>{const data=input();data.current.monthly[0].total=5;expect(()=>buildCarbonSection(data)).toThrow("Monthly");});
  it("shows missing monthly coverage as a gap",()=>{const data=input();for(const c of [data.currentCoverage.group,data.currentCoverage.sites.a,data.currentCoverage.months["2026-01"]]){c.received=0;c.reviewed=0;}const out=buildCarbonSection(data);if(out.state!=="ready")throw Error();expect(out.data.trend[0].currentKg).toBeNull();});
  it("never substitutes complete coverage when site coverage is absent",()=>{const data=input();data.currentCoverage.sites={};expect(()=>buildCarbonSection(data)).toThrow("Missing site/month coverage");});
  it("rejects impossible Scope 3 coverage",()=>{const data=input();data.quantifiedCategories=16;expect(()=>buildCarbonSection(data)).toThrow("Scope 3");});
  it("allows a null screened count (no screening recorded) with a valid quantified count",()=>{const data=input();data.screenedCategories=null;data.screenedCategoriesReason="Scope 3 screening is not recorded for this reporting boundary.";const out=buildCarbonSection(data);if(out.state!=="ready")throw Error();expect(out.data.screenedCategories).toBeNull();expect(out.data.screenedCategoriesReason).toMatch(/not recorded/);});
  it("still validates screened when it is not null",()=>{const data=input();data.screenedCategories=3;expect(()=>buildCarbonSection(data)).toThrow("Scope 3");});
  it("a null screened count never constrains the quantified count",()=>{const data=input();data.screenedCategories=null;data.quantifiedCategories=15;expect(()=>buildCarbonSection(data)).not.toThrow();});
});
