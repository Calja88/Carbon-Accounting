import { describe, expect, it } from "vitest";
import { classifyDeterministically } from "@/lib/classification-rules";

/**
 * The platform's own rules take precedence over any model. These tests fix
 * that precedence in place: where a rule fires, the answer is the rule's, and
 * where the wording is genuinely ambiguous the rules decline rather than pick.
 */

describe("classifyDeterministically", () => {
  it("classifies purchased grid electricity as Scope 2", () => {
    const result = classifyDeterministically("Monthly electricity supply invoice, 12,450 kWh, MPAN 1234");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.scope).toBe("SCOPE_2");
    expect(result.dataPointCode).toBe("S2-01");
    expect(result.source).toBe("platform-rule");
    expect(result.explanation).toMatch(/Scope 2/);
  });

  it("classifies mains gas as Scope 1 stationary combustion", () => {
    const result = classifyDeterministically("Natural gas bill for the Hull site, MPRN 998877");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.scope).toBe("SCOPE_1");
    expect(result.dataPointCode).toBe("S1-01");
  });

  it("classifies refrigerant top-ups as Scope 1 fugitive emissions", () => {
    const result = classifyDeterministically("R410A refrigerant recharge, 3 kg");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dataPointCode).toBe("S1-05");
  });

  it("keeps grey fleet mileage in Scope 1 rather than business travel", () => {
    const result = classifyDeterministically("Mileage claim, employee-owned vehicle, 240 miles");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.scope).toBe("SCOPE_1");
    expect(result.dataPointCode).toBe("S1-04");
  });

  it("does not treat a mileage claim as company fleet fuel", () => {
    const result = classifyDeterministically("Fuel card for the company fleet, diesel, 400 litres");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dataPointCode).toBe("S1-03");
  });

  it("classifies a hotel stay as Category 6 business travel", () => {
    const result = classifyDeterministically("Hotel accommodation, 3 room nights");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dataPointCode).toBe("S3-06");
    expect(result.subtypeKey).toBe("hotel");
  });

  it("does not classify commuter rail as business travel", () => {
    const result = classifyDeterministically("Employee commuting survey, rail");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dataPointCode).toBe("S3-07");
  });

  it("declines when it recognises nothing rather than guessing", () => {
    const result = classifyDeterministically("Miscellaneous supplier charge");
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.ambiguousBetween).toEqual([]);
  });

  it("declines and reports the conflict when two different rules fire", () => {
    // Reads as both standby-generator fuel (S1-02) and company fleet fuel
    // (S1-03) — a real ambiguity a person or the AI assistant should resolve,
    // not one to pick a side on. Both are Scope 1, but they are different data
    // points with different factors.
    const result = classifyDeterministically("Diesel delivery for the standby generator and the company fleet");
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.ambiguousBetween.length).toBeGreaterThan(1);
  });

  it("lets a rule's exclusion terms resolve wording that only looks ambiguous", () => {
    // "Natural gas" would fire the gas rule, but the gas rule excludes
    // anything mentioning refrigerant — so this resolves cleanly to F-gas
    // rather than being reported as a conflict.
    const result = classifyDeterministically("Natural gas-charged R134a refrigerant top-up, combined invoice");
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.dataPointCode).toBe("S1-05");
  });

  it("declines on an empty description", () => {
    expect(classifyDeterministically("").matched).toBe(false);
    expect(classifyDeterministically("   ").matched).toBe(false);
  });

  it("is unaffected by punctuation and casing", () => {
    const a = classifyDeterministically("ELECTRICITY — supply (kWh)");
    const b = classifyDeterministically("electricity supply kwh");
    expect(a.matched && b.matched).toBe(true);
    if (!a.matched || !b.matched) return;
    expect(a.dataPointCode).toBe(b.dataPointCode);
  });
});
