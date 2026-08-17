/**
 * Tests for Atom parsing and canonical-ID derivation (T41, spec §4). Reads
 * the recorded/constructed fixtures directly off disk — no network, no
 * fetch involved at all in this file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAtomFeed, toCanonicalId } from "@/lib/ems/legal/provider/atom-parser";
import { LegalContentProviderError } from "@/lib/ems/legal/provider/types";

const FIXTURES_DIR = join(__dirname, "..", "__fixtures__", "legislation-gov-uk");
function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

describe("toCanonicalId", () => {
  it("strips the id-host prefix", () => {
    expect(toCanonicalId("https://www.legislation.gov.uk/id/uksi/2020/1")).toBe("uksi/2020/1");
  });

  it("strips the plain host prefix", () => {
    expect(toCanonicalId("https://www.legislation.gov.uk/uksi/2020/1")).toBe("uksi/2020/1");
  });

  it("drops trailing segments beyond type/year/number", () => {
    expect(toCanonicalId("https://www.legislation.gov.uk/uksi/2020/1/made/data.xml")).toBe("uksi/2020/1");
  });

  it("throws for a URI with too few path segments", () => {
    expect(() => toCanonicalId("https://www.legislation.gov.uk/uksi")).toThrow(LegalContentProviderError);
  });
});

describe("parseAtomFeed", () => {
  it("parses entries and the next-page link", () => {
    const parsed = parseAtomFeed(fixture("publications-page-1.atom.xml"));
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.nextHref).toBe("https://www.legislation.gov.uk/new/data.feed?page=2");
    expect(parsed.entries[0].id).toBe("https://www.legislation.gov.uk/id/uksi/2026/1");
    expect(parsed.entries[0].dcType).toBe("UnitedKingdomStatutoryInstrument");
  });

  it("has no next link on the last page", () => {
    const parsed = parseAtomFeed(fixture("publications-page-2.atom.xml"));
    expect(parsed.nextHref).toBeNull();
    expect(parsed.entries).toHaveLength(1);
  });

  it("parses leg: namespace fields on an effects entry", () => {
    const parsed = parseAtomFeed(fixture("effects-page-1.atom.xml"));
    expect(parsed.entries).toHaveLength(2);
    const [first] = parsed.entries;
    expect(first.legAffectedUri).toBe("https://www.legislation.gov.uk/id/uksi/2020/1");
    expect(first.legAffectingUri).toBe("https://www.legislation.gov.uk/id/ukpga/2026/2");
    expect(first.legType).toBe("amendment");
    expect(first.legAppliedDate?.toISOString().slice(0, 10)).toBe("2026-02-01");
  });

  it("drops entries missing an id, keeping well-formed ones", () => {
    const parsed = parseAtomFeed(fixture("partial-entries.atom.xml"));
    // 3 entries in the fixture; the id-less one is dropped by the parser
    // itself (it has nothing to key off), the timestamp-less one survives
    // parsing here and is dropped one layer up, by the client's entry
    // mapper (see legislation-gov-uk.test.ts).
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries.every((e) => e.id)).toBe(true);
  });

  it("throws PARSE_ERROR for XML with no <feed> root", () => {
    expect(() => parseAtomFeed(fixture("no-feed-root.xml"))).toThrow(LegalContentProviderError);
    try {
      parseAtomFeed(fixture("no-feed-root.xml"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LegalContentProviderError);
      expect((err as InstanceType<typeof LegalContentProviderError>).code).toBe("PARSE_ERROR");
      expect((err as InstanceType<typeof LegalContentProviderError>).retryable).toBe(false);
    }
  });

  it("throws PARSE_ERROR for input that is not XML at all", () => {
    expect(() => parseAtomFeed("this is not xml { at all")).toThrow(LegalContentProviderError);
  });
});
