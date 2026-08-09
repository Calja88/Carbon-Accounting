/**
 * LCI/PCF source governance registry.
 *
 * One `LciSource` row per entry in data/lci-import/uk-desnz-2026/lci_source_manifest.json
 * — the manifest that screened every candidate LCI/PCF data source (UK
 * DESNZ, ESIG, CEPE, ecoinvent, Sphera, FEFAC/Blonk, Quantis, RDC, EC nodes,
 * Federal LCA Commons, ProBas, ÖKOBAUDAT, ELCD, openLCA methods) for whether
 * its numbers may ever be imported onto this website. Only a source whose
 * normalised decision is ALLOW_WITH_ATTRIBUTION may have numeric factor
 * values imported; everything else is catalogued for discovery/audit only
 * (brief: "Do not scrape or import numerical data from ESIG, CEPE,
 * ecoinvent, FEFAC/Blonk or Sphera using this manifest.").
 *
 * Upserts are idempotent and keyed on the manifest's own `source_id`, so
 * re-running never duplicates a row — it only refreshes metadata and
 * `lastChecked`. This mirrors the AI layer's self-initialising catalogue
 * pattern (src/lib/ai/catalog-store.ts): `ensureLciSourcesInitialized` is
 * safe to call on every admin request and only does real work when the
 * registry is empty or the manifest version on disk has moved on, so the
 * Admin -> LCI Data Sources page always has the registry populated without
 * requiring a manual seed step in production.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { LciLicenseDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const MANIFEST_PATH = path.join(process.cwd(), "data/lci-import/uk-desnz-2026/lci_source_manifest.json");

export interface ManifestSource {
  source_id: string;
  source_name: string;
  owner?: string;
  coverage?: string;
  current_status?: string;
  access?: string;
  licence_summary?: string;
  licence_expiry?: string;
  website_import_decision: string;
  free_access?: string;
  commercial_embedding?: string;
  relevance?: string;
  recommended_action?: string;
  data_url?: string;
  licence_url?: string;
  evidence_note?: string;
  last_checked?: string;
}

export interface LciSourceManifest {
  manifest_version: string;
  generated_at: string;
  purpose?: string;
  legal_note?: string;
  policy: Record<string, string>;
  sources: ManifestSource[];
}

/**
 * Normalises the manifest's free-text `website_import_decision` onto the
 * platform's four-value governance enum. Anything starting with `BLOCK`, and
 * the manifest's own `NOT_AN_LCI_FACTOR_SOURCE` marker, always normalises to
 * BLOCK (brief: "treat any manifest website_import_decision starting with
 * BLOCK as governance-blocked, and NOT_AN_LCI_FACTOR_SOURCE as
 * blocked-for-factor-import too"). The raw string is always stored alongside
 * this so nothing is lossy.
 */
export function normalizeLicenseDecision(raw: string): LciLicenseDecision {
  const value = raw.trim().toUpperCase();
  if (value === "ALLOW_WITH_ATTRIBUTION") return LciLicenseDecision.ALLOW_WITH_ATTRIBUTION;
  if (value.startsWith("BLOCK") || value === "NOT_AN_LCI_FACTOR_SOURCE") return LciLicenseDecision.BLOCK;
  if (value.startsWith("CONDITIONAL")) return LciLicenseDecision.CONDITIONAL_DATASET_LEVEL_REVIEW;
  // METADATA_ONLY and any METADATA_* variant (e.g.
  // "METADATA_OR_LAST_RESORT_PROXY_ONLY") — discovery only, never numeric.
  return LciLicenseDecision.METADATA_ONLY;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function readSourceManifest(): Promise<LciSourceManifest> {
  const text = await fs.readFile(MANIFEST_PATH, "utf-8");
  return JSON.parse(text) as LciSourceManifest;
}

export interface UpsertManifestResult {
  manifestVersion: string;
  upserted: number;
  sourceIds: string[];
}

/** Idempotently upserts every source in the manifest — never duplicates. */
export async function upsertLciSourcesFromManifest(manifest: LciSourceManifest): Promise<UpsertManifestResult> {
  const lastChecked = new Date();
  const sourceIds: string[] = [];

  for (const source of manifest.sources) {
    const licenseDecision = normalizeLicenseDecision(source.website_import_decision);
    await prisma.lciSource.upsert({
      where: { sourceId: source.source_id },
      update: {
        sourceName: source.source_name,
        owner: source.owner ?? null,
        coverage: source.coverage ?? null,
        licenseDecision,
        rawLicenseDecision: source.website_import_decision,
        licenseSummary: source.licence_summary ?? null,
        dataUrl: source.data_url ?? null,
        licenseUrl: source.licence_url ?? null,
        relevance: source.relevance ?? null,
        recommendedAction: source.recommended_action ?? null,
        lastChecked: parseDate(source.last_checked) ?? lastChecked,
        manifestVersion: manifest.manifest_version,
      },
      create: {
        sourceId: source.source_id,
        sourceName: source.source_name,
        owner: source.owner ?? null,
        coverage: source.coverage ?? null,
        licenseDecision,
        rawLicenseDecision: source.website_import_decision,
        licenseSummary: source.licence_summary ?? null,
        dataUrl: source.data_url ?? null,
        licenseUrl: source.licence_url ?? null,
        relevance: source.relevance ?? null,
        recommendedAction: source.recommended_action ?? null,
        lastChecked: parseDate(source.last_checked) ?? lastChecked,
        manifestVersion: manifest.manifest_version,
      },
    });
    sourceIds.push(source.source_id);
  }

  return { manifestVersion: manifest.manifest_version, upserted: manifest.sources.length, sourceIds };
}

export async function listLciSources() {
  return prisma.lciSource.findMany({
    orderBy: { sourceName: "asc" },
    include: { factorSets: { select: { id: true, name: true, sourceVersion: true, createdAt: true, _count: { select: { factors: true } } } } },
  });
}

// --- Self-initialisation ----------------------------------------------------
// Mirrors src/lib/ai/catalog-store.ts's ensureAiInitialized: safe to call on
// every request, throttled so it never becomes a read-per-request, and a
// complete no-op once the registry already reflects the manifest on disk.

const INIT_COOLDOWN_MS = 5 * 60 * 1000;
let initPromise: Promise<void> | null = null;
let lastInitAttempt = 0;

/**
 * Ensures every source in the on-disk manifest has a row in `LciSource`,
 * without requiring a manual seed command in production. No-ops once the
 * registry already has a row per manifest source at the manifest's current
 * version — so this stays cheap on every call after the first.
 */
export async function ensureLciSourcesInitialized(): Promise<void> {
  if (initPromise) return initPromise;

  const now = Date.now();
  if (now - lastInitAttempt < INIT_COOLDOWN_MS) return;
  lastInitAttempt = now;

  initPromise = (async () => {
    try {
      const manifest = await readSourceManifest();
      const existing = await prisma.lciSource.count({ where: { manifestVersion: manifest.manifest_version } });
      if (existing >= manifest.sources.length) return;
      await upsertLciSourcesFromManifest(manifest);
    } catch {
      // Manifest missing or DB unreachable — the registry stays whatever it
      // was; core app is unaffected either way, exactly like the AI
      // catalogue's self-init.
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}
