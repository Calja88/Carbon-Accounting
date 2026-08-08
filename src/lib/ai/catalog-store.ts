/**
 * Persistence for the model catalogue. The catalogue is a *cache* of the
 * provider's live metadata, held on the singleton AiSettings row so the admin
 * UI and the router both read exactly the same snapshot.
 */

import { prisma } from "@/lib/prisma";
import { AI_SETTINGS_SINGLETON_ID } from "./config";
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
