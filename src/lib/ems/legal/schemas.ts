import { z } from "zod";

export const registerJurisdictionSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(120),
  subdivision: z.string().trim().max(120).optional(),
  active: z.boolean().optional(),
});
export type RegisterJurisdictionInput = z.infer<typeof registerJurisdictionSchema>;

export const registerLegalTopicSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  active: z.boolean().optional(),
});
export type RegisterLegalTopicInput = z.infer<typeof registerLegalTopicSchema>;

export const registerLegalSourceProviderSchema = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  authorityType: z.enum(["OFFICIAL", "EDITORIAL"]),
  configReference: z.string().trim().max(500).optional(),
  status: z.enum(["ENABLED", "DISABLED"]).optional(),
});
export type RegisterLegalSourceProviderInput = z.infer<typeof registerLegalSourceProviderSchema>;

export const upsertLegalInstrumentSchema = z.object({
  providerKey: z.string().trim().min(1),
  canonicalId: z.string().trim().min(1).max(300),
  instrumentType: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(500),
  year: z.number().int().optional(),
  number: z.string().trim().max(120).optional(),
  madeAt: z.coerce.date().optional(),
  publishedAt: z.coerce.date().optional(),
  commencementAt: z.coerce.date().optional(),
  status: z.enum(["ACTIVE", "REVOKED", "SUPERSEDED", "UNKNOWN"]).optional(),
  latestSourceHash: z.string().trim().max(200).optional(),
  jurisdictionCodes: z.array(z.string().trim().min(1)).optional(),
  topicKeys: z.array(z.string().trim().min(1)).optional(),
});
export type UpsertLegalInstrumentInput = z.infer<typeof upsertLegalInstrumentSchema>;

export const recordLegalInstrumentVersionSchema = z.object({
  providerVersionId: z.string().trim().min(1).max(300),
  retrievedAt: z.coerce.date(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  documentStorageRef: z.string().trim().max(500).optional(),
  checksum: z.string().trim().min(1).max(200),
  sourceUrl: z.string().trim().min(1).max(2000),
});
export type RecordLegalInstrumentVersionInput = z.infer<typeof recordLegalInstrumentVersionSchema>;

export const recordLegalProvisionReferenceSchema = z.object({
  versionId: z.string().trim().min(1).optional(),
  providerProvisionId: z.string().trim().min(1).max(300),
  label: z.string().trim().max(500).optional(),
  uri: z.string().trim().max(2000).optional(),
});
export type RecordLegalProvisionReferenceInput = z.infer<typeof recordLegalProvisionReferenceSchema>;

export const recordLegalChangeEventSchema = z.object({
  providerEventId: z.string().trim().min(1).max(300),
  eventType: z.string().trim().min(1).max(120),
  sourceInstrumentId: z.string().trim().min(1),
  affectedInstrumentId: z.string().trim().min(1).optional(),
  affectedProvisionId: z.string().trim().min(1).optional(),
  sourceVersionId: z.string().trim().min(1).optional(),
  sourceHash: z.string().trim().max(200).optional(),
  detectedAt: z.coerce.date(),
  effectiveAt: z.coerce.date().optional(),
  rawEvidence: z.record(z.string(), z.unknown()),
  /** When a provider has no stable event id, the service derives a dedupe key from the other fields instead. */
  dedupeKey: z.string().trim().min(1).max(300).optional(),
});
export type RecordLegalChangeEventInput = z.infer<typeof recordLegalChangeEventSchema>;
