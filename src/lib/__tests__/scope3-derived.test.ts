import { describe, expect, it } from "vitest";
import { wttMappingFor, WTT_TD_FACTOR_MAP } from "@/lib/scope3-derived";

describe("wttMappingFor", () => {
  it("maps every Scope 1 combustion category to a well-to-tank companion", () => {
    expect(wttMappingFor("stationary_combustion_natural_gas")?.wttFactorCategory).toBe("wtt_natural_gas");
    expect(wttMappingFor("stationary_combustion_diesel")?.wttFactorCategory).toBe("wtt_diesel");
    expect(wttMappingFor("mobile_combustion_fuel")?.wttFactorCategory).toBe("wtt_road_fuel");
    expect(wttMappingFor("mobile_combustion_mileage")?.wttFactorCategory).toBe("wtt_mileage");
  });

  it("maps grid electricity to T&D losses", () => {
    expect(wttMappingFor("grid_electricity")?.wttFactorCategory).toBe("td_losses_electricity");
  });

  it("preserves subtype for fuel-typed categories but not for single-factor ones", () => {
    expect(wttMappingFor("mobile_combustion_fuel")?.keepsSubtypeKey).toBe(true);
    expect(wttMappingFor("stationary_combustion_natural_gas")?.keepsSubtypeKey).toBe(false);
  });

  it("returns null for categories with no WTT/T&D companion (fugitive emissions, purchased heat)", () => {
    expect(wttMappingFor("fugitive_refrigerant")).toBeNull();
    expect(wttMappingFor("purchased_heat_steam")).toBeNull();
  });

  it("does not map market-based/residual-mix electricity separately — same category key as location-based", () => {
    // grid_electricity is one factorCategory shared by all three bases;
    // the derivation job itself is responsible for only reading
    // LOCATION_BASED source rows, not this mapping.
    expect(Object.keys(WTT_TD_FACTOR_MAP)).toContain("grid_electricity");
    expect(Object.keys(WTT_TD_FACTOR_MAP).filter((k) => k.startsWith("grid_electricity"))).toHaveLength(1);
  });
});
