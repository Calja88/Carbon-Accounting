/**
 * Shared evidence-bytes storage contract (task T22,
 * Docs/PHASE2_EMS_FOUNDATION_SPEC.md §1: "Evidence bytes use one provider
 * interface. Metadata and checksum live in Neon; storage keys are opaque.").
 *
 * This is the T22 generalisation of the provider interface the LCA module
 * introduced in `src/lib/lca/evidence-service.ts`: the interface and the
 * register/active/forKey registry pattern are now shared here, so any
 * evidence-owning domain gets the same "point it at S3/Azure/Vercel Blob
 * later without a redesign" story.
 *
 * Bytes are NOT shared between domains. `createEvidenceStorageRegistry`
 * takes a domain-specific default provider, so the LCA module keeps writing
 * to `LcaEvidenceBlob` (via its own default provider) and the shared
 * documents/evidence module below writes to `EvidenceObjectBlob` — separate
 * tables, separate foreign keys. T22 explicitly does not migrate existing
 * LCA evidence bytes into the new shared table.
 */

import { prisma } from "@/lib/prisma";

export interface StoredEvidenceBytes {
  storageProvider: string;
  storageKey: string;
}

export interface EvidenceStorageProvider {
  readonly name: string;
  put(input: { evidenceId: string; fileName: string; mimeType: string; bytes: Buffer }): Promise<StoredEvidenceBytes>;
  get(storageKey: string): Promise<Buffer | null>;
  remove(storageKey: string): Promise<void>;
}

export interface EvidenceStorageRegistry {
  register(provider: EvidenceStorageProvider): void;
  active(): EvidenceStorageProvider;
  forKey(name: string | null): EvidenceStorageProvider | null;
}

/**
 * Builds an independent provider registry for one evidence domain. `envVar`
 * is the environment variable that selects the active provider by name
 * (e.g. `"LCA_EVIDENCE_STORAGE"`, `"DOCUMENT_EVIDENCE_STORAGE"`) — each
 * domain gets its own variable so switching one domain's backend can never
 * accidentally repoint another's.
 */
export function createEvidenceStorageRegistry(
  envVar: string,
  defaultProvider: EvidenceStorageProvider,
): EvidenceStorageRegistry {
  const providers = new Map<string, EvidenceStorageProvider>([[defaultProvider.name, defaultProvider]]);

  return {
    register(provider: EvidenceStorageProvider): void {
      providers.set(provider.name, provider);
    },
    active(): EvidenceStorageProvider {
      const configured = process.env[envVar];
      if (configured && providers.has(configured)) return providers.get(configured) as EvidenceStorageProvider;
      return defaultProvider;
    },
    forKey(name: string | null): EvidenceStorageProvider | null {
      if (!name) return null;
      return providers.get(name) ?? null;
    },
  };
}

/**
 * The shared documents/evidence module's built-in provider. Bytes live in
 * EvidenceObjectBlob, a table nothing but the shared evidence download route
 * ever selects from — the same "keep bytes out of listing queries" shape as
 * the LCA module's own database provider.
 */
const databaseEvidenceObjectProvider: EvidenceStorageProvider = {
  name: "database",
  async put({ evidenceId, bytes }) {
    // Prisma's Bytes column takes a Uint8Array backed by a plain ArrayBuffer;
    // Node's Buffer can sit on a SharedArrayBuffer, so copy rather than cast.
    const data = Uint8Array.from(bytes);
    await prisma.evidenceObjectBlob.upsert({
      where: { evidenceObjectId: evidenceId },
      create: { evidenceObjectId: evidenceId, data },
      update: { data },
    });
    return { storageProvider: "database", storageKey: evidenceId };
  },
  async get(storageKey) {
    const blob = await prisma.evidenceObjectBlob.findUnique({ where: { evidenceObjectId: storageKey } });
    return blob ? Buffer.from(blob.data) : null;
  },
  async remove(storageKey) {
    await prisma.evidenceObjectBlob.deleteMany({ where: { evidenceObjectId: storageKey } });
  },
};

/** Registry for the shared documents/evidence module (EvidenceObject). */
export const documentEvidenceStorage = createEvidenceStorageRegistry(
  "DOCUMENT_EVIDENCE_STORAGE",
  databaseEvidenceObjectProvider,
);
