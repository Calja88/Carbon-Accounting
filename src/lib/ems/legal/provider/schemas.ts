/**
 * Zod validation for everything a `LegalContentProvider` hands back (spec
 * §4: "every returned object is Zod validated before persistence"). The
 * parser (`atom-parser.ts`) turns provider XML into plain objects; these
 * schemas are the last gate before a client method returns them to a
 * caller — a response that parses as XML but doesn't match this shape is
 * treated the same as one that failed to parse at all (T41 acceptance:
 * "malformed or partial responses must fail safely").
 */

import { z } from "zod";

export const discoveryItemSchema = z.object({
  canonicalId: z.string().trim().min(1),
  itemType: z.string().trim().min(1),
  title: z.string().trim().min(1),
  providerItemId: z.string().trim().min(1).nullable(),
  detectedAt: z.date(),
  effectiveAt: z.date().nullable(),
  sourceUrl: z.string().trim().min(1),
  raw: z.record(z.string(), z.unknown()),
});

export const discoveryPageSchema = z.object({
  items: z.array(discoveryItemSchema),
  nextCursor: z.string().trim().min(1).nullable(),
});

export const providerInstrumentSchema = z.object({
  canonicalId: z.string().trim().min(1),
  instrumentType: z.string().trim().min(1),
  title: z.string().trim().min(1),
  year: z.number().int().nullable(),
  number: z.string().trim().min(1).nullable(),
  madeAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  commencementAt: z.date().nullable(),
  status: z.enum(["ACTIVE", "REVOKED", "SUPERSEDED", "UNKNOWN"]),
  sourceUrl: z.string().trim().min(1),
});

export const providerVersionSchema = z.object({
  canonicalId: z.string().trim().min(1),
  providerVersionId: z.string().trim().min(1),
  retrievedAt: z.date(),
  checksum: z.string().trim().min(1),
  sourceUrl: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()),
});

export const providerHealthSchema = z.object({
  circuit: z.enum(["CLOSED", "OPEN"]),
  reachable: z.boolean(),
  checkedAt: z.date(),
  detail: z.string().nullable(),
});
