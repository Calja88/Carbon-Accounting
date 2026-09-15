import { z } from "zod";
import { FactorBasis, Scope, OfficialCorporateBoundary, OfficialCvBasis, OfficialGasMeasure } from "@prisma/client";
import { canonicalJson, canonicalOrder, contractHash } from "./canonical";
import { assertExactNumber, toLosslessDecimal18_8 } from "./exact-number";

const text = z.string().min(1).max(4096).refine(v => v.trim().length > 0, "Blank text");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = text;
const nullableText = text.nullable();
const instant = z.string().refine(v => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v, "Canonical UTC millisecond instant required");
const exact = z.strictObject({ coefficient: text, exponent: z.number().int() }).superRefine((value, ctx) => {
  try { assertExactNumber(value); } catch { ctx.addIssue({ code: "custom", message: "Invalid exact number" }); }
});
const purpose = z.enum(["PRODUCTION_COMPLETE", "TEST_ONLY"]);

export const releaseIdentitySchema = z.strictObject({
  namespace: text, reportingYear: z.number().int().min(1900).max(9999), revisionKey: text,
});

/** Deliberately projects only source semantics; unknown transport/mapping fields
 * are stripped here. All other approval-bound contracts are strict objects. */
const sourceIdentitySchema = z.object({
  release: releaseIdentitySchema, identityVersion: z.literal("v1"),
  scope: z.string().nullable().optional().default(null),
  level1: z.string().nullable().optional().default(null), level2: z.string().nullable().optional().default(null),
  level3: z.string().nullable().optional().default(null), level4: z.string().nullable().optional().default(null),
  columnText: z.string().nullable().optional().default(null), unit: z.string().nullable().optional().default(null),
  gas: z.string().nullable().optional().default(null), boundary: z.string().nullable().optional().default(null),
  geography: z.string().nullable().optional().default(null), cv: z.string().nullable().optional().default(null),
  rf: z.string().nullable().optional().default(null), load: z.string().nullable().optional().default(null),
  occupancy: z.string().nullable().optional().default(null), vehicleClass: z.string().nullable().optional().default(null),
  qualifiers: z.record(z.string(), z.string().nullable()).optional().default({}),
});

export function sourceIdentity(input: unknown): { canonicalIdentity: string; sourceIdentityHash: string } {
  const value = sourceIdentitySchema.parse(input);
  return { canonicalIdentity: canonicalJson(value), sourceIdentityHash: contractHash("source-identity/v1", value) };
}

export function sourceContentHash(identityHash: string, value: unknown): string {
  return contractHash("source-content/v1", { identityHash: hash.parse(identityHash), exact: exact.parse(value) });
}

const lookupSchema = z.strictObject({ category: text, subtype: nullableText, basis: z.enum(FactorBasis) });
export type Lookup = z.infer<typeof lookupSchema>;

export function subtypeIdentity(subtype: string | null): string {
  nullableText.parse(subtype);
  return canonicalJson(subtype === null ? ["null"] : ["string", subtype]);
}

export function runtimeLookupKey(input: Lookup): string {
  const v = lookupSchema.parse(input);
  const key = canonicalJson([v.category, JSON.parse(subtypeIdentity(v.subtype)), v.basis]);
  if (Buffer.byteLength(key, "utf8") > 1024) throw new Error("Lookup key too long");
  return key;
}

const dimensionsSchema = lookupSchema.extend({
  unit: text, scope: z.enum(Scope), scope3Category: nullableText,
  boundary: z.enum(OfficialCorporateBoundary), gasMeasure: z.enum(OfficialGasMeasure),
  geography: text, cvBasis: z.enum(OfficialCvBasis),
}).superRefine((v, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if ((v.scope === "SCOPE_2") === (v.basis === "STANDARD")) issue("Scope/basis mismatch");
  if ((v.scope === "SCOPE_3") !== (v.scope3Category !== null)) issue("Scope 3 category mismatch");
  if (v.gasMeasure !== "WHOLE_GAS_CO2E") issue("Only whole-gas CO2e is eligible");
  if (!["DIRECT", "WTT", "TD_LOSSES"].includes(v.boundary)) issue("Boundary needs a later reviewed contract");
  if (v.geography !== "GB") issue("Only explicit reviewed GB applicability is supported");
  if (v.boundary === "WTT" && (!v.category.startsWith("wtt_") || v.scope !== "SCOPE_3")) issue("WTT mapping mismatch");
  if (v.boundary === "TD_LOSSES" && (!v.category.startsWith("td_losses_") || v.scope !== "SCOPE_3")) issue("T&D mapping mismatch");
  if (v.boundary === "DIRECT" && /^(wtt_|td_losses_)/.test(v.category)) issue("Direct/component category collision");
  try { runtimeLookupKey({ category: v.category, subtype: v.subtype, basis: v.basis }); } catch { issue("Invalid lookup key"); }
});
export type FactorDimensions = z.infer<typeof dimensionsSchema>;
const lookupOf = (v: Lookup): Lookup => ({ category: v.category, subtype: v.subtype, basis: v.basis });

const coverageSchema = z.strictObject({
  id: text, version, purpose, productContractVersion: version,
  requirements: z.array(z.strictObject({
    id: text, dimensions: dimensionsSchema, level: z.enum(["MANDATORY", "OPTIONAL"]),
    carryForwardAllowed: z.boolean(), companionOfId: nullableText, rationale: text,
  })).min(1),
});
export type CoverageContract = z.infer<typeof coverageSchema>;

function unique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

export function validateCoverage(input: unknown): CoverageContract {
  const value = coverageSchema.parse(input);
  unique(value.requirements.map(r => r.id), "Duplicate requirement ID");
  unique(value.requirements.map(r => runtimeLookupKey(lookupOf(r.dimensions))), "Duplicate coverage lookup key");
  const byId = new Map(value.requirements.map(r => [r.id, r]));
  for (const requirement of value.requirements) {
    const visited = new Set([requirement.id]);
    let parent = requirement.companionOfId;
    while (parent !== null) {
      if (visited.has(parent) || !byId.has(parent)) throw new Error("Invalid/cyclic coverage companion");
      visited.add(parent); parent = byId.get(parent)!.companionOfId;
    }
    if (requirement.companionOfId) {
      const parentRow = byId.get(requirement.companionOfId)!;
      const a = requirement.dimensions, b = parentRow.dimensions;
      if (a.unit !== b.unit || a.geography !== b.geography || a.cvBasis !== b.cvBasis ||
          !["WTT", "TD_LOSSES"].includes(a.boundary) || b.boundary !== "DIRECT" ||
          (parentRow.level === "MANDATORY" && requirement.level !== "MANDATORY")) throw new Error("Incompatible companion");
    }
  }
  return { ...value, requirements: canonicalOrder(value.requirements) };
}

export function coverageHash(input: unknown): string { return contractHash("coverage/v1", validateCoverage(input)); }

const mappingSchema = z.strictObject({
  id: text, identityId: text, sourceFactorId: text, sourceObservationHash: hash, targetSlot: text,
  revision: z.number().int().positive(), supersedesMappingId: nullableText,
  decision: z.enum(["MAPPED", "UNMAPPED", "REJECTED"]), target: dimensionsSchema.nullable(),
  sourceValue: exact.nullable(), interpretedValue: exact.nullable(), transform: z.literal("IDENTITY"),
  geographyRationale: nullableText, qualifierPolicy: nullableText,
  rationale: text, mappedByUserId: text, mappedAt: instant, mappingRuleVersion: version,
});
export type MappingRevision = z.infer<typeof mappingSchema>;

export function validateMapping(input: unknown, predecessor?: MappingRevision, coverage?: CoverageContract): MappingRevision {
  const v = mappingSchema.parse(input);
  if (v.decision === "UNMAPPED" && v.targetSlot !== "UNMAPPED") throw new Error("Deliberately unmapped decisions use the UNMAPPED stream");
  if (v.supersedesMappingId === v.id || (v.revision === 1) !== (v.supersedesMappingId === null)) throw new Error("Invalid mapping predecessor");
  if (v.revision > 1) {
    if (!predecessor || predecessor.id !== v.supersedesMappingId || predecessor.identityId !== v.identityId ||
        predecessor.targetSlot !== v.targetSlot || predecessor.revision !== v.revision - 1) throw new Error("Mapping predecessor must be the previous stream revision");
  }
  if (v.decision === "MAPPED") {
    if (!v.target || !v.sourceValue || !v.interpretedValue || !v.geographyRationale || !v.qualifierPolicy) throw new Error("Mapped dimensions, value and interpretation rationale required");
    if (canonicalJson(v.sourceValue) !== canonicalJson(v.interpretedValue)) throw new Error("Identity transform changed source value");
    toLosslessDecimal18_8(v.interpretedValue);
    if (v.target.cvBasis === "UNSPECIFIED") throw new Error("CV applicability must be explicit");
    if (v.targetSlot !== runtimeLookupKey(lookupOf(v.target))) throw new Error("Mapping target slot mismatch");
    if (coverage && !validateCoverage(coverage).requirements.some(r => canonicalJson(r.dimensions) === canonicalJson(v.target))) throw new Error("Target absent from reviewed coverage");
  } else if (v.target !== null || v.interpretedValue !== null) throw new Error("Unmapped/rejected decision has a target value");
  return v;
}

export function mappingHash(input: unknown, predecessor?: MappingRevision): string {
  return contractHash("mapping/v1", validateMapping(input, predecessor));
}

const manifestSchema = z.strictObject({
  formatVersion: z.literal("v1"), registryId: text, primaryRelease: releaseIdentitySchema, purpose,
  proposedName: text, createdByUserId: text, baselinePlanId: nullableText, baselineGeneration: z.number().int().nonnegative(),
  applicableFrom: instant, applicableUntil: instant,
  validationVersion: version, mappingRuleVersion: version, numericPolicyVersion: version,
  approvalPolicyVersion: version, provenanceVersion: version,
  coverage: coverageSchema,
  artifacts: z.array(z.strictObject({
    id: text, release: releaseIdentitySchema, sha256: hash, byteSize: z.number().int().positive(),
    storageVersion: text, verificationHash: hash, inventoryHash: hash, parseHash: hash.nullable(),
    use: z.enum(["FACTOR_INPUT", "PROVENANCE", "METHODOLOGY", "ERRATA"]),
    parserVersion: nullableText, sourceProfileVersion: nullableText, identityVersion: version,
    // Full immutable parse observation inventory, not a UI's truncated list.
    observationIds: z.array(text),
  })).min(1),
  mappings: z.array(z.strictObject({ mapping: mappingSchema, predecessor: mappingSchema.nullable() })),
  dispositions: z.array(z.strictObject({
    sourceFactorId: text, decision: z.enum(["SELECTED", "EXCLUDED", "REJECTED", "DUPLICATE"]),
    reasonCode: text, rationale: text, acknowledgedWarningCodes: z.array(text),
  })),
  factors: z.array(z.strictObject({
    coverageRequirementId: text, origin: z.enum(["NEW_OFFICIAL", "CARRY_FORWARD"]),
    mappingId: nullableText, sourceFactorId: nullableText, predecessorFactorId: nullableText,
    rootSourceFactorId: nullableText, sourceRelease: releaseIdentitySchema.nullable(),
    originalSourceName: text, originalPublisher: text, originalVintageYear: z.number().int().min(1900).max(9999),
    originalSourceUrl: nullableText, dimensions: dimensionsSchema, value: exact,
    carryForwardRationale: nullableText, carryValidFrom: instant.nullable(), carryValidUntil: instant.nullable(),
  })).min(1),
  sourceCounts: z.record(text, z.number().int().nonnegative()),
  warningSummary: z.array(z.strictObject({ code: text, count: z.number().int().nonnegative(), rationale: text })),
});
export type PublicationManifest = z.infer<typeof manifestSchema>;

/** Pure proposal validation only. Source verification, live authority and DB
 * locks are mandatory future publication checks, not inferred from this result. */
export function validateManifest(input: unknown): PublicationManifest {
  const v = manifestSchema.parse(input);
  if (v.applicableFrom >= v.applicableUntil) throw new Error("Invalid applicability interval");
  const coverage = validateCoverage(v.coverage);
  if (coverage.purpose !== v.purpose) throw new Error("Coverage purpose mismatch");
  unique(v.artifacts.map(a => a.id), "Duplicate manifest artifact");
  unique(v.mappings.map(m => m.mapping.id), "Duplicate manifest mapping");
  unique(v.dispositions.map(d => d.sourceFactorId), "Duplicate source disposition");
  unique(v.factors.map(f => runtimeLookupKey(lookupOf(f.dimensions))), "Duplicate manifest lookup key");
  unique(v.factors.map(f => f.coverageRequirementId), "Duplicate coverage output");
  const observationIds = v.artifacts.filter(a => a.use === "FACTOR_INPUT").flatMap(a => a.observationIds);
  unique(observationIds, "Duplicate input observation");
  if (canonicalJson([...observationIds].sort()) !== canonicalJson(v.dispositions.map(d => d.sourceFactorId).sort())) throw new Error("Incomplete source disposition inventory");
  if (v.sourceCounts.candidates !== observationIds.length || v.sourceCounts.selected !== v.dispositions.filter(d => d.decision === "SELECTED").length) throw new Error("Source counts do not match the bound inventory");
  for (const a of v.artifacts) {
    unique(a.observationIds, "Duplicate artifact observation");
    if (a.use === "FACTOR_INPUT" && (!a.parseHash || !a.parserVersion || !a.sourceProfileVersion)) throw new Error("Factor artifact requires a bound parse");
    if (a.use !== "FACTOR_INPUT" && a.observationIds.length) throw new Error("Evidence cannot supply factor observations");
  }
  const mappings = new Map(v.mappings.map(m => {
    const mapping = validateMapping(m.mapping, m.predecessor ?? undefined, coverage);
    if (mapping.mappingRuleVersion !== v.mappingRuleVersion) throw new Error("Mapping rule version mismatch");
    return [mapping.id, mapping] as const;
  }));
  const requirements = new Map(coverage.requirements.map(r => [r.id, r]));
  for (const f of v.factors) {
    toLosslessDecimal18_8(f.value);
    const requirement = requirements.get(f.coverageRequirementId);
    if (!requirement || canonicalJson(requirement.dimensions) !== canonicalJson(f.dimensions)) throw new Error("Coverage dimension mismatch");
    if (f.origin === "NEW_OFFICIAL") {
      const mapping = f.mappingId === null ? undefined : mappings.get(f.mappingId);
      if (!mapping || mapping.decision !== "MAPPED" || mapping.sourceFactorId !== f.sourceFactorId ||
          canonicalJson(mapping.target) !== canonicalJson(f.dimensions) || canonicalJson(mapping.interpretedValue) !== canonicalJson(f.value) ||
          f.rootSourceFactorId !== f.sourceFactorId || !f.sourceRelease ||
          !v.dispositions.some(d => d.sourceFactorId === f.sourceFactorId && d.decision === "SELECTED")) throw new Error("Invalid official source lineage");
      const artifact = v.artifacts.find(a => a.use === "FACTOR_INPUT" && a.observationIds.includes(mapping.sourceFactorId));
      if (!artifact || canonicalJson(artifact.release) !== canonicalJson(f.sourceRelease)) throw new Error("Source observation belongs to another release");
      if (f.carryForwardRationale || f.carryValidFrom || f.carryValidUntil) throw new Error("New factor has carry-forward metadata");
    } else {
      if (!requirement.carryForwardAllowed || !f.predecessorFactorId || f.mappingId || f.sourceFactorId ||
          !f.carryForwardRationale || !f.carryValidFrom || !f.carryValidUntil ||
          f.carryValidFrom > v.applicableFrom || f.carryValidUntil < v.applicableUntil) throw new Error("Invalid carry-forward coverage/validity");
    }
    if (f.sourceRelease && f.originalVintageYear !== f.sourceRelease.reportingYear) throw new Error("Source vintage relabelled");
    if (f.sourceRelease && !v.artifacts.some(a => canonicalJson(a.release) === canonicalJson(f.sourceRelease))) throw new Error("Unbound source release");
  }
  for (const r of coverage.requirements) if (r.level === "MANDATORY" && !v.factors.some(f => f.coverageRequirementId === r.id)) throw new Error("Missing mandatory coverage");
  for (const d of v.dispositions) if ((d.decision === "SELECTED") !== v.factors.some(f => f.sourceFactorId === d.sourceFactorId)) throw new Error("Disposition/output mismatch");
  if (v.mappings.some(m => !v.factors.some(f => f.mappingId === m.mapping.id))) throw new Error("Unused selected mapping");
  return { ...v, coverage,
    artifacts: canonicalOrder(v.artifacts.map(a => ({ ...a, observationIds: [...a.observationIds].sort() }))),
    mappings: canonicalOrder(v.mappings), factors: canonicalOrder(v.factors),
    dispositions: canonicalOrder(v.dispositions.map(d => ({ ...d, acknowledgedWarningCodes: [...new Set(d.acknowledgedWarningCodes)].sort() }))),
    warningSummary: canonicalOrder(v.warningSummary),
  };
}

export function publicationManifestHash(input: unknown): string { return contractHash("publication-manifest/v1", validateManifest(input)); }

export interface PlatformApprovalInput {
  purpose: "MANIFEST_REVIEW" | "PUBLISH" | "ACTIVATE";
  subjectHash: string; contributorsHash: string; approverUserId: string;
  approvedAt: string; expiresAt: string; approvalPolicyVersion: string;
}

/** Takes already-resolved live platform grants, never organisation permissions. */
export function assertIndependentApproval(input: PlatformApprovalInput, contributors: readonly string[], capabilities: readonly string[], now: string): void {
  text.parse(input.approverUserId); version.parse(input.approvalPolicyVersion);
  hash.parse(input.subjectHash); hash.parse(input.contributorsHash);
  instant.parse(input.approvedAt); instant.parse(input.expiresAt); instant.parse(now);
  const capability = input.purpose === "MANIFEST_REVIEW" ? "REVIEW" : input.purpose;
  if (!["MANIFEST_REVIEW", "PUBLISH", "ACTIVATE"].includes(input.purpose) || !capabilities.includes(capability) ||
      contributors.includes(input.approverUserId) || input.contributorsHash !== contractHash("contributors/v1", [...new Set(contributors)].sort()) ||
      input.approvedAt > now || now >= input.expiresAt ||
      Date.parse(input.expiresAt) - Date.parse(input.approvedAt) > 7 * 86_400_000) throw new Error("Invalid independent platform approval");
}

export const platformEventSchema = z.strictObject({
  registryId: text, sequence: z.string().regex(/^[1-9]\d*$/), actorUserId: nullableText,
  actorKind: z.enum(["USER", "SYSTEM"]), eventType: text, correlationId: text, occurredAt: instant,
  subjects: z.record(text, nullableText), summary: text, details: z.record(text, z.unknown()), previousEventHash: hash.nullable(),
});
export function platformEventHash(input: unknown): string {
  const v = platformEventSchema.parse(input);
  if ((v.sequence === "1") !== (v.previousEventHash === null) || (v.actorKind === "USER" && !v.actorUserId)) throw new Error("Invalid platform chain/actor");
  return contractHash("audit-event/v1", v);
}

export interface PlatformChainAnchor { registryId: string; nextEventSequence: string; lastEventHash: string | null }

/** A trusted registry head is required to detect deletion of the chain's tail. */
export function verifyPlatformEventChain(events: readonly unknown[], anchor: PlatformChainAnchor): boolean {
  try {
    text.parse(anchor.registryId); hash.nullable().parse(anchor.lastEventHash);
    if (anchor.nextEventSequence !== String(events.length + 1)) return false;
    let previous: string | null = null;
    for (let i = 0; i < events.length; i++) {
      const event = z.strictObject({ event: platformEventSchema, contentHash: hash }).parse(events[i]);
      if (event.event.registryId !== anchor.registryId || event.event.sequence !== String(i + 1) ||
          event.event.previousEventHash !== previous || platformEventHash(event.event) !== event.contentHash) return false;
      previous = event.contentHash;
    }
    return previous === anchor.lastEventHash;
  } catch { return false; }
}
