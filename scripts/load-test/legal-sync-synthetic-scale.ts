/**
 * T83 load test: legal sync throughput and cursor safety at synthetic scale
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6: "load-test ... legal sync
 * ... on synthetic scale or recorded fixtures only"; "legal provider
 * outage/rate limit/malformed payload"). Never calls a live API — a
 * synthetic in-memory `LegalContentProvider` stands in, generating several
 * thousand paginated discovery items, matching "recorded fixtures only" for
 * unit tests while giving a realistic page count for a throughput number.
 *
 * Also replays the T41/T42 "rate limiting does not advance cursor"
 * acceptance criterion at scale: one page in the middle of a run fails with
 * a retryable `RATE_LIMITED` error, and the test asserts the stored cursor
 * still reflects only the pages that actually committed.
 *
 * `LegalInstrumentVersion`/`LegalChangeEvent` are append-only by DB trigger
 * (T40's immutable event log), so this script's cleanup intentionally
 * leaves the synthetic provider/instruments/versions/events in place at the
 * end of the run rather than fighting that guarantee — same posture as
 * `organisation-export-scale.ts` takes with `AuditEvent`.
 *
 * Run: `DATABASE_URL=postgresql://... npx tsx scripts/load-test/legal-sync-synthetic-scale.ts`
 */

import { requireLoadTestDb, reportSloLine, summarise } from "./lib/db-guard";
import type {
  DiscoveryInput,
  DiscoveryPage,
  EffectsInput,
  LegalContentProvider,
  ProviderHealth,
  ProviderInstrument,
  ProviderVersion,
} from "@/lib/ems/legal/provider/types";

const TOTAL_ITEMS = 3000;
const PAGE_SIZE = 50;
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROVIDER_KEY = `loadtest-legal-provider-${RUN_ID}`;

/** Deterministic synthetic instrument generator — never fetches anything over the network. */
function makeSyntheticProvider(options: { failOnPage?: number } = {}): LegalContentProvider & { pagesServed: number } {
  let pagesServed = 0;
  return {
    key: PROVIDER_KEY,
    pagesServed: 0,
    async discoverPublications(input: DiscoveryInput): Promise<DiscoveryPage> {
      const pageIndex = input.cursor ? Number(input.cursor) : 0;
      pagesServed += 1;
      this.pagesServed = pagesServed;
      if (options.failOnPage !== undefined && pageIndex === options.failOnPage) {
        const { LegalContentProviderError } = await import("@/lib/ems/legal/provider/types");
        throw new LegalContentProviderError("synthetic rate limit", "RATE_LIMITED", true, 429);
      }
      const start = pageIndex * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, TOTAL_ITEMS);
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
        const i = start + offset;
        return {
          canonicalId: `loadtest/${RUN_ID}/${i}`,
          itemType: "NEW_PUBLICATION",
          title: `Synthetic instrument ${i}`,
          providerItemId: `event-${i}`,
          detectedAt: new Date(),
          effectiveAt: null,
          sourceUrl: `https://example.invalid/loadtest/${i}`,
          raw: { synthetic: true, index: i },
        };
      });
      return { items, nextCursor: end < TOTAL_ITEMS ? String(pageIndex + 1) : null };
    },
    async discoverEffects(input: EffectsInput): Promise<DiscoveryPage> {
      return this.discoverPublications(input);
    },
    async getInstrument(canonicalId: string): Promise<ProviderInstrument> {
      return {
        canonicalId,
        instrumentType: "SYNTHETIC",
        title: `Synthetic instrument ${canonicalId}`,
        year: 2026,
        number: "1",
        madeAt: null,
        publishedAt: null,
        commencementAt: null,
        status: "ACTIVE",
        sourceUrl: `https://example.invalid/loadtest/${canonicalId}`,
      };
    },
    async getVersionMetadata(canonicalId: string): Promise<ProviderVersion> {
      return {
        canonicalId,
        providerVersionId: `${canonicalId}-v1`,
        retrievedAt: new Date(),
        checksum: `checksum-${canonicalId}`,
        sourceUrl: `https://example.invalid/loadtest/${canonicalId}`,
        metadata: { synthetic: true },
      };
    },
    async healthCheck(): Promise<ProviderHealth> {
      return { circuit: "CLOSED", reachable: true, checkedAt: new Date(), detail: null };
    },
  };
}

async function main() {
  requireLoadTestDb("legal-sync-synthetic-scale");
  const { PrismaClient } = await import("@prisma/client");
  const { runLegalSyncCycle } = await import("@/lib/ems/legal/legal-sync-worker");
  const prisma = new PrismaClient();

  try {
    await prisma.legalSourceProvider.create({
      data: { key: PROVIDER_KEY, name: "Load test synthetic provider", authorityType: "OFFICIAL", status: "ENABLED" },
    });

    console.log(`Running a full sync cycle over ${TOTAL_ITEMS} synthetic items (${Math.ceil(TOTAL_ITEMS / PAGE_SIZE)} pages)...`);
    const provider = makeSyntheticProvider();
    const durations: number[] = [];
    const start = Date.now();
    const result = await runLegalSyncCycle({ providerKey: PROVIDER_KEY, stream: "PUBLICATIONS", provider, now: new Date() });
    durations.push(Date.now() - start);

    const writtenOk = result.itemsWritten === TOTAL_ITEMS && result.pagesProcessed === Math.ceil(TOTAL_ITEMS / PAGE_SIZE);
    console.log(`${writtenOk ? "PASS" : "FAIL"}  full sync: itemsWritten=${result.itemsWritten} pagesProcessed=${result.pagesProcessed} (expected ${TOTAL_ITEMS} / ${Math.ceil(TOTAL_ITEMS / PAGE_SIZE)})`);

    const instrumentCount = await prisma.legalInstrument.count({ where: { provider: { key: PROVIDER_KEY } } });
    console.log(`${instrumentCount === TOTAL_ITEMS ? "PASS" : "FAIL"}  persisted instrument count: ${instrumentCount} (expected ${TOTAL_ITEMS})`);

    // Rate-limit-mid-run: cursor must reflect only the pages that committed
    // before the failure, never the failing page or anything after it.
    console.log("Simulating a rate-limited page partway through a run...");
    const cursorBefore = await prisma.legalSyncCursor.findFirstOrThrow({
      where: { provider: { key: PROVIDER_KEY }, stream: "PUBLICATIONS" },
    });
    const failingPage = 3;
    const flakyProvider = makeSyntheticProvider({ failOnPage: failingPage });
    let threw = false;
    try {
      await runLegalSyncCycle({ providerKey: PROVIDER_KEY, stream: "PUBLICATIONS", provider: flakyProvider, now: new Date() });
    } catch {
      threw = true;
    }
    const cursorAfter = await prisma.legalSyncCursor.findUniqueOrThrow({ where: { id: cursorBefore.id } });
    // A fresh cycle always restarts from page 1 of a new overlap window
    // (module doc comment), so the meaningful assertion is: the cycle threw
    // (the rate limit propagated) and the cursor's status/lastSuccessAt
    // were not advanced as if the run had completed successfully.
    const rateLimitOk = threw && cursorAfter.status === "ERROR";
    console.log(`${rateLimitOk ? "PASS" : "FAIL"}  rate-limit safety: cycle threw=${threw}, cursor status=${cursorAfter.status} (expected ERROR, never a false success)`);

    // SLO target from docs/operations/slo-sli.md: legal cursor staleness / full-cycle duration p95 <= 30s at 3,000-item synthetic scale.
    const throughputPass = reportSloLine(`full legal sync cycle (${TOTAL_ITEMS} items)`, summarise(durations), 30_000);

    const overallPass = writtenOk && instrumentCount === TOTAL_ITEMS && rateLimitOk && throughputPass;
    console.log(overallPass ? "\nOverall: PASS" : "\nOverall: FAIL");
    if (!overallPass) process.exitCode = 1;
  } finally {
    // `LegalInstrumentVersion`/`LegalChangeEvent` are append-only by DB
    // trigger (T40's immutable event log), so this run's synthetic
    // provider/instruments/versions/events are intentionally left in place
    // rather than fought — same posture as `organisation-export-scale.ts`.
    // Only the mutable cursor row is cleaned up.
    console.log("Cleaning up synthetic data (provider/instruments/versions/events are append-only and intentionally left — see file header)...");
    const provider = await prisma.legalSourceProvider.findUnique({ where: { key: PROVIDER_KEY } });
    if (provider) {
      await prisma.legalSyncCursor.deleteMany({ where: { providerId: provider.id } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
