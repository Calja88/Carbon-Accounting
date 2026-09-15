import { describe, expect, it } from "vitest";
import { artifactIdentity, canonicalJson, contractHash } from "../canonical";
import { parseSourceNumber, toLosslessDecimal18_8, isLosslessDecimal18_8 } from "../exact-number";
import {
  sourceIdentity, sourceContentHash, runtimeLookupKey, subtypeIdentity, validateMapping, mappingHash,
  validateCoverage, coverageHash, validateManifest, publicationManifestHash,
  assertIndependentApproval, platformEventHash, verifyPlatformEventChain,
  type MappingRevision, type CoverageContract, type PublicationManifest, type FactorDimensions,
} from "../contracts";

const hash = "a".repeat(64);
const release = { namespace: "UK_GOV_GHG_COMPANY_REPORTING", reportingYear: 2026, revisionKey: "synthetic-v1" };
const from = "2026-01-01T00:00:00.000Z", until = "2027-01-01T00:00:00.000Z";
const direct: FactorDimensions = {
  category: "stationary_combustion_natural_gas", subtype: null, basis: "STANDARD", unit: "kWh",
  scope: "SCOPE_1", scope3Category: null, boundary: "DIRECT", gasMeasure: "WHOLE_GAS_CO2E", geography: "GB", cvBasis: "GROSS",
};
const wtt: FactorDimensions = { ...direct, category: "wtt_natural_gas", scope: "SCOPE_3", scope3Category: "Cat 3", boundary: "WTT" };
function mapping(target = direct, id = "direct"): MappingRevision {
  return {
    id, identityId: `identity-${id}`, sourceFactorId: `source-${id}`, sourceObservationHash: hash,
    targetSlot: runtimeLookupKey({ category: target.category, subtype: target.subtype, basis: target.basis }),
    revision: 1, supersedesMappingId: null, decision: "MAPPED", target,
    sourceValue: { coefficient: "1", exponent: -1 }, interpretedValue: { coefficient: "1", exponent: -1 },
    transform: "IDENTITY", geographyRationale: "Synthetic GB test evidence", qualifierPolicy: "Gross CV explicitly reviewed",
    rationale: "Synthetic exact mapping", mappedByUserId: "mapper", mappedAt: from, mappingRuleVersion: "v1",
  };
}
function coverage(): CoverageContract {
  return { id: "coverage", version: "v1", purpose: "TEST_ONLY", productContractVersion: "v1", requirements: [
    { id: "direct", dimensions: direct, level: "MANDATORY", carryForwardAllowed: false, companionOfId: null, rationale: "Test requirement" },
    { id: "wtt", dimensions: wtt, level: "MANDATORY", carryForwardAllowed: false, companionOfId: "direct", rationale: "Test companion" },
  ] };
}
function manifest(): PublicationManifest {
  const mappings = [mapping(), mapping(wtt, "wtt")];
  return {
    formatVersion: "v1", registryId: "registry", primaryRelease: release, purpose: "TEST_ONLY", proposedName: "Synthetic test only",
    createdByUserId: "mapper", baselinePlanId: null, baselineGeneration: 0, applicableFrom: from, applicableUntil: until,
    validationVersion: "v1", mappingRuleVersion: "v1", numericPolicyVersion: "v1", approvalPolicyVersion: "v1", provenanceVersion: "v1",
    coverage: coverage(), artifacts: [{
      id: "artifact", release, sha256: hash, byteSize: 123, storageVersion: "immutable-1", verificationHash: hash,
      inventoryHash: hash, parseHash: hash, use: "FACTOR_INPUT", parserVersion: "v1", sourceProfileVersion: "flat-v1", identityVersion: "v1",
      observationIds: mappings.map(m => m.sourceFactorId),
    }], mappings: mappings.map(m => ({ mapping: m, predecessor: null })),
    dispositions: mappings.map(m => ({ sourceFactorId: m.sourceFactorId, decision: "SELECTED", reasonCode: "REVIEWED", rationale: "Synthetic", acknowledgedWarningCodes: [] })),
    factors: mappings.map(m => ({
      coverageRequirementId: m.id, origin: "NEW_OFFICIAL", mappingId: m.id, sourceFactorId: m.sourceFactorId,
      predecessorFactorId: null, rootSourceFactorId: m.sourceFactorId, sourceRelease: release,
      originalSourceName: "Synthetic source", originalPublisher: "Test publisher", originalVintageYear: 2026,
      originalSourceUrl: null, dimensions: m.target!, value: m.interpretedValue!,
      carryForwardRationale: null, carryValidFrom: null, carryValidUntil: null,
    })), sourceCounts: { candidates: 2, selected: 2 }, warningSummary: [],
  };
}

describe("exact source values", () => {
  it.each([
    ["12", "12", 0, "12"], ["0.12500", "125", -3, "0.125"], ["1.20e+2", "12", 1, "120"],
    ["1e-8", "1", -8, "0.00000001"], ["0", "0", 0, "0"], ["-0.000", "0", 0, "0"],
    ["9999999999.99999999", "999999999999999999", -8, "9999999999.99999999"],
  ])("preserves %s without rounding", (token, coefficient, exponent, decimal) => {
    const value = parseSourceNumber(String(token));
    expect(value.kind).toBe("FINITE");
    if (value.kind !== "FINITE") throw Error("Expected exact value");
    expect(value.rawToken).toBe(token); expect(value.exact).toEqual({ coefficient, exponent });
    expect(toLosslessDecimal18_8(value.exact)).toBe(decimal);
  });
  it.each(["0.123456789", "-1", "10000000000", "1e20"])("retains but refuses publication of %s", token => {
    const value = parseSourceNumber(token);
    if (value.kind !== "FINITE") throw Error("Expected finite source evidence");
    expect(value.rawToken).toBe(token); expect(isLosslessDecimal18_8(value.exact)).toBe(false);
    expect(() => toLosslessDecimal18_8(value.exact)).toThrow();
  });
  it.each([null, "", "   "])("missing %s never becomes zero", token => expect(parseSourceNumber(token).kind).toBe("MISSING"));
  it.each(["NaN", "Infinity", "=1+1", "#VALUE!", "1,234", "1e1001", "1e9999999999999", "1".repeat(1001)])("blocks malformed/bounded %s", token => {
    expect(parseSourceNumber(token).kind).toBe("INVALID");
  });
  it("refuses noncanonical pairs", () => expect(() => toLosslessDecimal18_8({ coefficient: "10", exponent: 0 })).toThrow());
  it("retains an exact XML token independently of a binary Number representation", () => {
    const token = "0.12345678901234567890123456789";
    const value = parseSourceNumber(token);
    expect(value.kind === "FINITE" && value.exact.coefficient).toBe("12345678901234567890123456789");
    expect(String(Number(token))).not.toBe(token);
  });
});

describe("canonical source and artifact identities", () => {
  const source = { release, identityVersion: "v1", level1: "Fuels", level2: "Natural gas", unit: "kWh", gas: "kg CO2e", boundary: "Fuels", cv: "Gross CV" };
  it("excludes row/sheet position, source ID, value and application mapping", () => {
    const a = sourceIdentity({ ...source, sourceRow: 83, sourceId: "one", sheet: "A", value: "1", mapping: direct });
    const b = sourceIdentity({ ...source, sourceRow: 999, sourceId: "two", sheet: "B", value: "2", mapping: wtt });
    expect(a).toEqual(b);
    expect(sourceContentHash(a.sourceIdentityHash, { coefficient: "1", exponent: 0 })).not.toBe(sourceContentHash(b.sourceIdentityHash, { coefficient: "2", exponent: 0 }));
  });
  it.each(["unit", "cv", "boundary", "level2", "gas", "rf", "load", "geography"])("binds %s", dimension => {
    expect(sourceIdentity({ ...source, [dimension]: "different" }).sourceIdentityHash).not.toBe(sourceIdentity(source).sourceIdentityHash);
  });
  it("equates missing with null but distinguishes an explicit empty source dimension", () => {
    expect(sourceIdentity(source)).toEqual(sourceIdentity({ ...source, geography: null }));
    expect(sourceIdentity(source)).not.toEqual(sourceIdentity({ ...source, geography: "" }));
  });
  it("binds release revision and hierarchy order", () => {
    expect(sourceIdentity({ ...source, release: { ...release, revisionKey: "corrected" } })).not.toEqual(sourceIdentity(source));
    expect(sourceIdentity({ ...source, level1: source.level2, level2: source.level1 })).not.toEqual(sourceIdentity(source));
  });
  it("hashes exact bytes without filename/release arguments", () => {
    expect(artifactIdentity(Buffer.from("abc"))).toEqual({ sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", byteSize: 3 });
    expect(artifactIdentity(Buffer.from("abc"))).not.toEqual(artifactIdentity(Buffer.from("abd")));
  });
  it("normalises Unicode/object ordering, separates hash domains and rejects unsafe values", () => {
    expect(canonicalJson({ b: "e\u0301", a: null })).toBe(canonicalJson({ a: null, b: "é" }));
    expect(contractHash("mapping/v1", [1])).not.toBe(contractHash("source-identity/v1", [1]));
    for (const value of [undefined, NaN, Infinity, 0.1, new Date(), { x: undefined }, new Array(2), Object.assign(new Array(1), { extra: 1 })]) expect(() => canonicalJson(value)).toThrow();
    expect(() => canonicalJson({ "é": 1, "e\u0301": 2 })).toThrow("collision");
  });
});

describe("mapping and coverage contracts", () => {
  it("validates exact reviewed mappings and immutable stream successors", () => {
    const first = mapping(); expect(validateMapping(first, undefined, coverage())).toEqual(first);
    const next = { ...first, id: "revision-2", revision: 2, supersedesMappingId: first.id, rationale: "Review clarified" };
    expect(validateMapping(next, first).revision).toBe(2);
    expect(mappingHash(first)).not.toBe(mappingHash(next, first));
    expect(() => validateMapping(next)).toThrow("predecessor");
    expect(() => validateMapping({ ...next, supersedesMappingId: next.id }, first)).toThrow();
  });
  it("requires explicit unmapped rationale and no target/value", () => {
    const unmapped = { ...mapping(), decision: "UNMAPPED", targetSlot: "UNMAPPED", target: null, interpretedValue: null };
    expect(validateMapping(unmapped).decision).toBe("UNMAPPED");
    expect(() => validateMapping({ ...unmapped, rationale: " " })).toThrow();
    expect(() => validateMapping({ ...unmapped, target: direct })).toThrow();
  });
  it.each([
    { geography: "" }, { geography: "US" }, { gasMeasure: "GAS_CONTRIBUTION_CO2E" }, { boundary: "COMBINED" },
    { cvBasis: "UNSPECIFIED" }, { scope: "SCOPE_2" }, { unit: "" }, { category: "wtt_natural_gas" },
  ])("rejects incompatible target %j", change => expect(() => validateMapping({ ...mapping(), target: { ...direct, ...change } })).toThrow());
  it("refuses value transformation and targets outside reviewed requirements", () => {
    expect(() => validateMapping({ ...mapping(), interpretedValue: { coefficient: "2", exponent: -1 } })).toThrow("changed source");
    const c = coverage(); c.requirements[0].dimensions = { ...direct, unit: "litres" };
    expect(() => validateMapping(mapping(), undefined, c)).toThrow();
  });
  it("uses null-safe keys without sentinel collisions", () => {
    expect(subtypeIdentity(null)).not.toBe(subtypeIdentity("null"));
    expect(runtimeLookupKey({ category: "x", subtype: null, basis: "STANDARD" })).not.toBe(runtimeLookupKey({ category: "x", subtype: "null", basis: "STANDARD" }));
    const c = coverage(); c.requirements.push({ ...c.requirements[0], id: "duplicate-null" });
    expect(() => validateCoverage(c)).toThrow("Duplicate coverage lookup");
  });
  it("binds optional/carry-forward flags and validates companion cycles", () => {
    const a = coverage(), b = coverage(); b.requirements[0].carryForwardAllowed = true;
    expect(coverageHash(a)).not.toBe(coverageHash(b));
    a.requirements[0].companionOfId = "wtt"; expect(() => validateCoverage(a)).toThrow();
  });
});

describe("complete immutable manifest", () => {
  it("hashes identically after reordering every set-valued collection", () => {
    const a = manifest(), b = manifest();
    b.artifacts.reverse(); b.artifacts[0].observationIds.reverse(); b.mappings.reverse(); b.dispositions.reverse(); b.factors.reverse(); b.coverage.requirements.reverse();
    expect(publicationManifestHash(a)).toBe(publicationManifestHash(b));
  });
  it("binds values, artifact bytes, provenance, dates and policy versions", () => {
    const a = manifest();
    for (const change of [
      (m: PublicationManifest) => { m.artifacts[0].sha256 = "b".repeat(64); },
      (m: PublicationManifest) => { m.validationVersion = "v2"; },
      (m: PublicationManifest) => { m.provenanceVersion = "v2"; },
      (m: PublicationManifest) => { m.applicableUntil = "2026-12-01T00:00:00.000Z"; },
      (m: PublicationManifest) => { m.factors[0].value = { coefficient: "2", exponent: -1 }; m.mappings[0].mapping.sourceValue = m.factors[0].value; m.mappings[0].mapping.interpretedValue = m.factors[0].value; },
    ]) { const b = manifest(); change(b); expect(publicationManifestHash(b)).not.toBe(publicationManifestHash(a)); }
  });
  it("binds excluded observations/reasons and mapping revisions", () => {
    const a = manifest(); a.artifacts[0].observationIds.push("excluded");
    a.sourceCounts.candidates = 3;
    a.dispositions.push({ sourceFactorId: "excluded", decision: "REJECTED", reasonCode: "MISSING", rationale: "Blank stays blank", acknowledgedWarningCodes: [] });
    const b = structuredClone(a); b.dispositions[2].rationale = "Unavailable official value";
    expect(publicationManifestHash(a)).not.toBe(publicationManifestHash(b));
    b.mappings[0].predecessor = structuredClone(b.mappings[0].mapping);
    b.mappings[0].mapping = { ...b.mappings[0].mapping, id: "new-revision", revision: 2, supersedesMappingId: "direct" };
    b.factors[0].mappingId = "new-revision";
    expect(publicationManifestHash(a)).not.toBe(publicationManifestHash(b));
  });
  it("rejects missing required factors, invented observations and conflicting nullable keys", () => {
    const a = manifest(); a.factors.pop(); expect(() => validateManifest(a)).toThrow();
    const b = manifest(); b.artifacts[0].observationIds.push("unaccounted"); expect(() => validateManifest(b)).toThrow("inventory");
    const c = manifest(); c.factors.push({ ...c.factors[0] }); expect(() => validateManifest(c)).toThrow("Duplicate manifest lookup");
    expect(() => validateManifest({ ...manifest(), purpose: "PRODUCTION_COMPLETE" })).toThrow("purpose");
  });
  it("requires carry-forward permission, original vintage and complete validity", () => {
    const m = manifest(); m.coverage.requirements[0].carryForwardAllowed = true;
    m.sourceCounts.selected = 1;
    m.mappings.shift(); m.dispositions[0].decision = "EXCLUDED";
    m.factors[0] = { ...m.factors[0], origin: "CARRY_FORWARD", mappingId: null, sourceFactorId: null,
      rootSourceFactorId: null, sourceRelease: null, predecessorFactorId: "legacy-factor", originalVintageYear: 2024,
      originalSourceName: "Reviewed manual 2024 source", carryForwardRationale: "Still valid in reviewed period", carryValidFrom: from, carryValidUntil: until };
    expect(validateManifest(m).factors.find(f => f.origin === "CARRY_FORWARD")?.originalVintageYear).toBe(2024);
    m.coverage.requirements[0].carryForwardAllowed = false; expect(() => validateManifest(m)).toThrow("carry-forward");
    m.coverage.requirements[0].carryForwardAllowed = true; m.factors[0].carryValidUntil = from; expect(() => validateManifest(m)).toThrow();
  });
  it("refuses unexpected unbound manifest fields", () => expect(() => publicationManifestHash({ ...manifest(), commitAllowed: true })).toThrow());
  it("refuses invented counts and cross-release attribution", () => {
    const a = manifest(); a.sourceCounts.selected = 999; expect(() => validateManifest(a)).toThrow("counts");
    const b = manifest(); const wrongRelease = { ...release, revisionKey: "wrong" };
    b.artifacts.push({ ...b.artifacts[0], id: "other", release: wrongRelease, use: "PROVENANCE", observationIds: [], parseHash: null });
    b.factors[0].sourceRelease = wrongRelease;
    expect(() => validateManifest(b)).toThrow("another release");
  });
});

describe("platform approval and separate audit chain", () => {
  const approval = { purpose: "PUBLISH" as const, subjectHash: hash, contributorsHash: contractHash("contributors/v1", ["mapper"]),
    approverUserId: "reviewer", approvedAt: from, expiresAt: "2026-01-08T00:00:00.000Z", approvalPolicyVersion: "v1" };
  it("requires a live platform grant and independent actor even with all roles", () => {
    expect(() => assertIndependentApproval(approval, ["mapper"], ["PUBLISH"], from)).not.toThrow();
    expect(() => assertIndependentApproval(approval, ["mapper"], ["carbon.factor.manage"], from)).toThrow();
    expect(() => assertIndependentApproval({ ...approval, approverUserId: "mapper" }, ["mapper"], ["MAP", "REVIEW", "PUBLISH", "ACTIVATE"], from)).toThrow();
    expect(() => assertIndependentApproval(approval, ["mapper"], ["PUBLISH"], approval.expiresAt)).toThrow();
  });
  it("detects changed, deleted and cross-registry audit events", () => {
    const first = { registryId: "registry", sequence: "1", actorUserId: "reviewer", actorKind: "USER", eventType: "APPROVAL_GRANTED", correlationId: "request", occurredAt: from, subjects: { manifestId: "manifest" }, summary: "Synthetic review", details: {}, previousEventHash: null };
    const firstHash = platformEventHash(first);
    const second = { ...first, sequence: "2", previousEventHash: firstHash };
    const rows = [{ event: first, contentHash: firstHash }, { event: second, contentHash: platformEventHash(second) }];
    const anchor = { registryId: "registry", nextEventSequence: "3", lastEventHash: rows[1].contentHash };
    expect(verifyPlatformEventChain(rows, anchor)).toBe(true);
    expect(verifyPlatformEventChain(rows.slice(1), anchor)).toBe(false);
    expect(verifyPlatformEventChain(rows.slice(0, 1), anchor)).toBe(false);
    expect(verifyPlatformEventChain([{ ...rows[0], event: { ...first, summary: "Changed" } }, rows[1]], anchor)).toBe(false);
    expect(verifyPlatformEventChain([rows[0], { ...rows[1], event: { ...second, registryId: "tenant" } }], anchor)).toBe(false);
  });
});
