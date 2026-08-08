/**
 * Persistence for the model catalogue. The catalogue is a *cache* of the
 * provider's live metadata, held on the singleton AiSettings row so the admin
 * UI and the router both read exactly the same snapshot.
 */

import { prisma } from "@/lib/prisma";
import { AI_SETTINGS_SINGLETON_ID, ensureAiSettingsRow } from "./config";
import { buildCatalogSnapshot, CatalogSnapshot, EMPTY_CATALOG, parseCatalog } from "./catalog";
import { getAiProvider } from "./provider-registry";
import { AiModelInfo } from "./types";

interface CachedSnapshot {
  snapshot: CatalogSnapshot;
  expiresAt: number;
}

const SNAPSHOT_CACHE_TTL_MS = 60_000;
let cache: CachedSnapshot | null = null;

export function invalidateCatalogCache(): void {
  cache = null;
}

/**
 * The catalogue as last fetched. Never fetches on its own — a request path
 * must not be able to trigger an outbound catalogue call, or a burst of
 * traffic becomes a burst of provider requests. Refreshing is an explicit
 * admin action (`refreshModelCatalog`).
 */
export async function loadCatalog(): Promise<CatalogSnapshot> {
  if (cache && cache.expiresAt > Date.now()) return cache.snapshot;

  try {
    const row = await prisma.aiSettings.findUnique({
      where: { id: AI_SETTINGS_SINGLETON_ID },
      select: { catalogJson: true, catalogRefreshedAt: true },
    });
    const models = row?.catalogJson ? (row.catalogJson as unknown as AiModelInfo[]) : [];
    const snapshot = buildCatalogSnapshot(Array.isArray(models) ? models : [], row?.catalogRefreshedAt ?? null);
    cache = { snapshot, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS };
    return snapshot;
  } catch {
    // No catalogue is a degraded state, not a failure: free-only mode falls
    // back to the documented `:free` convention (see catalog.ts).
    return EMPTY_CATALOG;
  }
}

export interface CatalogRefreshResult {
  modelCount: number;
  freeCount: number;
  refreshedAt: Date;
}

/**
 * Fetches the provider's current catalogue and stores it. Server-side only,
 * admin-triggered. The stored snapshot holds capability/pricing metadata
 * only — no credentials of any kind.
 */
export async function refreshModelCatalog(): Promise<CatalogRefreshResult> {
  const provider = getAiProvider();
  const models = await provider.listModels();
  const refreshedAt = new Date();

  await prisma.aiSettings.update({
    where: { id: AI_SETTINGS_SINGLETON_ID },
    data: {
      catalogJson: JSON.parse(JSON.stringify(models)),
      catalogRefreshedAt: refreshedAt,
    },
  });

  invalidateCatalogCache();

  return {
    modelCount: models.length,
    freeCount: models.filter((m) => m.cost === "FREE").length,
    refreshedAt,
  };
}

export { parseCatalog };

// --- Self-initialisation ----------------------------------------------------

/** A catalogue this old is refreshed automatically rather than left stale. */
const CATALOG_STALE_MS = 24 * 60 * 60 * 1000;
/** How often a failed/attempted init is allowed to retry, so an outage or a
 *  missing key doesn't turn every request into a database+network probe. */
const INIT_COOLDOWN_MS = 5 * 60 * 1000;

let initPromise: Promise<void> | null = null;
let lastInitAttempt = 0;

/**
 * Idempotent self-initialisation: if a key is configured, makes sure the
 * settings row exists (safe defaults — free-only, auto-accept off — derived
 * from `defaultAiConfig()`, and never overwritten once an admin has saved
 * real settings) and that the model catalogue is present and not stale.
 *
 * Safe to call on every request: an in-flight call is reused, and both
 * success and failure are throttled by `INIT_COOLDOWN_MS` so this never
 * becomes a fetch-per-request. No-ops entirely with no API key.
 */
export async function ensureAiInitialized(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return;
  if (initPromise) return initPromise;

  const now = Date.now();
  if (now - lastInitAttempt < INIT_COOLDOWN_MS) return;
  lastInitAttempt = now;

  initPromise = (async () => {
    try {
      await ensureAiSettingsRow();

      const row = await prisma.aiSettings.findUnique({
        where: { id: AI_SETTINGS_SINGLETON_ID },
        select: { catalogRefreshedAt: true },
      });
      const stale = !row?.catalogRefreshedAt || Date.now() - row.catalogRefreshedAt.getTime() > CATALOG_STALE_MS;

      if (stale) {
        // Best-effort: on failure the last-known-good catalogue (if any)
        // is left exactly as it was — refreshModelCatalog only writes on
        // success — and free-only mode falls back to the documented
        // `:free` naming convention in the meantime.
        await refreshModelCatalog().catch(() => {});
      }
    } catch {
      // Database unreachable, etc. — AI stays in whatever state the
      // environment defaults leave it; core app is unaffected either way.
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}
