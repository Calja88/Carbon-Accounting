/**
 * End-to-end (within the client) tests for `LegislationGovUkProvider` (T41,
 * spec §4 + §9). `fetchImpl` is a URL-keyed lookup over the fixtures in
 * `__fixtures__/legislation-gov-uk/` — no test in this file makes a real
 * network call, and none is skipped or gated on network access.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegislationGovUkProvider } from "@/lib/ems/legal/provider/legislation-gov-uk";
import { LegalContentProviderError } from "@/lib/ems/legal/provider/types";

const FIXTURES_DIR = join(__dirname, "..", "__fixtures__", "legislation-gov-uk");
function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

const BASE_URL = "https://www.legislation.gov.uk";
const USER_AGENT = "test-agent/1.0 (+contact: test@example.invalid)";

function xmlResponse(body: string, status = 200, contentType = "application/atom+xml"): Response {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

/** Maps exact request URLs to fixture files (or synthetic responses); unmapped URLs fail the test loudly instead of hanging or hitting a real network. */
function makeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string, ..._rest: [RequestInit?]) => {
    const route = routes[url];
    if (!route) throw new Error(`Unmapped test URL: ${url}`);
    return route();
  });
}

describe("LegislationGovUkProvider.discoverPublications", () => {
  it("returns a cursor that resumes on the next page, then null at the end of the stream", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("publications-page-1.atom.xml")),
      [`${BASE_URL}/new/data.feed?page=2`]: () => xmlResponse(fixture("publications-page-2.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const page1 = await provider.discoverPublications({ stream: "PUBLICATIONS" });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].canonicalId).toBe("uksi/2026/1");
    expect(page1.items[1].canonicalId).toBe("ukpga/2026/2");
    expect(page1.nextCursor).toBe(`${BASE_URL}/new/data.feed?page=2`);

    const page2 = await provider.discoverPublications({ stream: "PUBLICATIONS", cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].canonicalId).toBe("ssi/2025/300");
    expect(page2.nextCursor).toBeNull();
  });

  it("sends the identifying user agent", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("publications-page-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });
    await provider.discoverPublications({ stream: "PUBLICATIONS" });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });
});

describe("LegislationGovUkProvider.discoverEffects", () => {
  it("uses a separate endpoint/stream from discoverPublications", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/changes/data.feed`]: () => xmlResponse(fixture("effects-page-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const page = await provider.discoverEffects({ stream: "EFFECTS" });
    expect(page.items).toHaveLength(2);
    expect(page.items[0].canonicalId).toBe("uksi/2020/1");
    expect(page.items[0].itemType).toBe("amendment");
    expect(page.items[0].effectiveAt?.toISOString().slice(0, 10)).toBe("2026-02-01");
    // Only the /changes/ endpoint was ever called for this stream.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE_URL}/changes/data.feed`);
  });

  it("advances independently of the publications cursor", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("publications-page-1.atom.xml")),
      [`${BASE_URL}/changes/data.feed`]: () => xmlResponse(fixture("effects-page-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const publications = await provider.discoverPublications({ stream: "PUBLICATIONS" });
    const effects = await provider.discoverEffects({ stream: "EFFECTS" });

    expect(publications.nextCursor).toBe(`${BASE_URL}/new/data.feed?page=2`);
    expect(effects.nextCursor).toBeNull();
  });
});

describe("LegislationGovUkProvider malformed/partial handling", () => {
  it("drops entries with no id or no timestamp, keeping the valid one, rather than failing the whole page", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("partial-entries.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const page = await provider.discoverPublications({ stream: "PUBLICATIONS" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].canonicalId).toBe("uksi/2026/52");
  });

  it("throws LegalContentProviderError, not an unhandled error, for non-well-formed XML", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("malformed-not-xml.txt"), 200, "application/atom+xml"),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    await expect(provider.discoverPublications({ stream: "PUBLICATIONS" })).rejects.toBeInstanceOf(LegalContentProviderError);
  });

  it("throws LegalContentProviderError for a response with no <feed> root", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("no-feed-root.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    await expect(provider.discoverPublications({ stream: "PUBLICATIONS" })).rejects.toMatchObject({ code: "PARSE_ERROR" });
  });
});

describe("LegislationGovUkProvider rate limiting", () => {
  it("does not return a page or cursor when every attempt is rate-limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const provider = new LegislationGovUkProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      userAgent: USER_AGENT,
      maxRetries: 1,
    });

    await expect(provider.discoverPublications({ stream: "PUBLICATIONS" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("leaves a caller-held cursor untouched: retrying the same call after a rate limit resumes from the same cursor", async () => {
    let rateLimited = true;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === `${BASE_URL}/new/data.feed?page=2`) {
        if (rateLimited) return new Response("", { status: 429 });
        return xmlResponse(fixture("publications-page-2.atom.xml"));
      }
      throw new Error(`Unmapped test URL: ${url}`);
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT, maxRetries: 0 });

    const cursor = `${BASE_URL}/new/data.feed?page=2`;
    await expect(provider.discoverPublications({ stream: "PUBLICATIONS", cursor })).rejects.toMatchObject({ code: "RATE_LIMITED" });

    // A caller only ever persists a cursor it received back from a
    // successful call — since the call above threw, `cursor` here is
    // whatever the caller already had. Retrying with that same value must
    // still work once the provider stops rate-limiting: nothing advanced.
    rateLimited = false;
    const page = await provider.discoverPublications({ stream: "PUBLICATIONS", cursor });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].canonicalId).toBe("ssi/2025/300");
  });
});

describe("LegislationGovUkProvider pagination ceiling", () => {
  it("refuses to request a page beyond the configured ceiling", async () => {
    const fetchImpl = vi.fn();
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT, maxPages: 1 });

    await expect(
      provider.discoverPublications({ stream: "PUBLICATIONS", cursor: `${BASE_URL}/new/data.feed?page=2` }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a null cursor instead of one beyond the ceiling", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("publications-page-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT, maxPages: 1 });

    const page = await provider.discoverPublications({ stream: "PUBLICATIONS" });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });
});

describe("LegislationGovUkProvider.getInstrument / getVersionMetadata", () => {
  it("maps a single-entry feed to a provider instrument with a canonical id", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/uksi/2020/1/data.feed`]: () => xmlResponse(fixture("instrument-uksi-2020-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const instrument = await provider.getInstrument("uksi/2020/1");
    expect(instrument.canonicalId).toBe("uksi/2020/1");
    expect(instrument.year).toBe(2020);
    expect(instrument.number).toBe("1");
    expect(instrument.instrumentType).toBe("UnitedKingdomStatutoryInstrument");
  });

  it("derives a stable checksum from the version metadata and never fetches the licensed document text", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/uksi/2020/1/data.feed`]: () => xmlResponse(fixture("instrument-uksi-2020-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const version = await provider.getVersionMetadata("uksi/2020/1");
    expect(version.canonicalId).toBe("uksi/2020/1");
    expect(version.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws NOT_FOUND when the feed has no entry", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/uksi/2099/999/data.feed`]: () =>
        xmlResponse('<feed xmlns="http://www.w3.org/2005/Atom"><id>x</id><title>Empty</title></feed>'),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    await expect(provider.getInstrument("uksi/2099/999")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("LegislationGovUkProvider.healthCheck", () => {
  it("never throws, and reports reachable/circuit status", async () => {
    const fetchImpl = makeFetch({
      [`${BASE_URL}/new/data.feed`]: () => xmlResponse(fixture("publications-page-1.atom.xml")),
    });
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const health = await provider.healthCheck();
    expect(health.reachable).toBe(true);
    expect(health.circuit).toBe("CLOSED");
  });

  it("reports unreachable rather than throwing when the provider is down", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const provider = new LegislationGovUkProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, userAgent: USER_AGENT });

    const health = await provider.healthCheck();
    expect(health.reachable).toBe(false);
    expect(health.detail).toBeTruthy();
  });
});

describe("getLegalContentProvider registry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves 'legislation-gov-uk' to LegislationGovUkProvider", async () => {
    const { getLegalContentProvider } = await import("@/lib/ems/legal/provider/registry");
    const provider = getLegalContentProvider("legislation-gov-uk");
    expect(provider.key).toBe("legislation-gov-uk");
  });

  it("throws for an unknown provider key", async () => {
    const { getLegalContentProvider } = await import("@/lib/ems/legal/provider/registry");
    expect(() => getLegalContentProvider("not-a-real-provider")).toThrow(/Unknown legal content provider/);
  });
});
