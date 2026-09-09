/**
 * Server-side protection for the AI endpoints.
 *
 * Three separate problems, three separate guards:
 *
 *  1. A runaway client loop or an impatient user hammering a button —
 *     a per-user requests-per-minute ceiling.
 *  2. Quota exhaustion over a day (OpenRouter's free tier is capped daily) —
 *     a per-user requests-per-day ceiling.
 *  3. The same request submitted twice in quick succession (double-click,
 *     retry-on-slow-network) — a short in-process dedupe window.
 *
 * (1) and (2) count rows in AiInteraction rather than keeping state in
 * memory, so the limit survives a restart and holds across instances. (3) is
 * intentionally in-process and best-effort: it exists to swallow accidental
 * duplicates, not to be a security control.
 *
 * All limits are configurable (`AI_RATE_LIMIT_PER_MINUTE`,
 * `AI_RATE_LIMIT_PER_DAY`, or the admin settings page) and, per Phase 1
 * tenancy (T18), scoped to one user *within* one Organisation: the same
 * person acting in two different organisations gets two independent quotas,
 * matching each Organisation's own `requestsPerMinute`/`requestsPerDay`
 * settings rather than a single limit shared across every tenant they belong
 * to.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { AiRuntimeConfig } from "./config";

export interface RateLimitVerdict {
  allowed: boolean;
  reason: string | null;
  retryAfterSeconds: number | null;
}

const ALLOWED: RateLimitVerdict = { allowed: true, reason: null, retryAfterSeconds: null };

export async function checkAiRateLimit(
  userId: string,
  organisationId: string,
  config: AiRuntimeConfig,
): Promise<RateLimitVerdict> {
  const now = Date.now();
  const minuteAgo = new Date(now - 60_000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  try {
    const [lastMinute, lastDay] = await Promise.all([
      prisma.aiInteraction.count({ where: { userId, organisationId, createdAt: { gte: minuteAgo } } }),
      prisma.aiInteraction.count({ where: { userId, organisationId, createdAt: { gte: dayAgo } } }),
    ]);

    if (lastMinute >= config.requestsPerMinute) {
      return {
        allowed: false,
        reason: `You've made ${lastMinute} AI requests in the last minute (limit ${config.requestsPerMinute}). Please wait a moment.`,
        retryAfterSeconds: 60,
      };
    }

    if (lastDay >= config.requestsPerDay) {
      return {
        allowed: false,
        reason: `You've reached today's AI request limit (${config.requestsPerDay}). AI assistance will be available again tomorrow — everything else works as normal.`,
        retryAfterSeconds: 3600,
      };
    }

    return ALLOWED;
  } catch {
    // If the counter itself is unavailable, let the request through: the
    // provider has its own limits, and blocking real work because a count
    // query failed would be the worse failure.
    return ALLOWED;
  }
}

// --- Duplicate-submission guard -------------------------------------------

interface DedupeEntry {
  expiresAt: number;
}

const DEDUPE_WINDOW_MS = 4_000;
const dedupeCache = new Map<string, DedupeEntry>();

function sweep(now: number) {
  if (dedupeCache.size < 500) return;
  for (const [key, entry] of dedupeCache) {
    if (entry.expiresAt <= now) dedupeCache.delete(key);
  }
}

export function dedupeKey(userId: string, feature: string, payload: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 32);
  return `${userId}:${feature}:${hash}`;
}

/**
 * Returns false when an identical request from the same user was accepted
 * within the last few seconds. Best-effort only, by design.
 */
export function claimDedupeSlot(key: string): boolean {
  const now = Date.now();
  sweep(now);
  const existing = dedupeCache.get(key);
  if (existing && existing.expiresAt > now) return false;
  dedupeCache.set(key, { expiresAt: now + DEDUPE_WINDOW_MS });
  return true;
}

/** Test seam — clears the in-process dedupe window. */
export function resetDedupeCache(): void {
  dedupeCache.clear();
}
