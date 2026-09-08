#!/usr/bin/env node
/**
 * Manual developer tool for T41 (Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md §4):
 * fetches legislation.gov.uk's live Atom feeds, trims each to its first few
 * entries, and writes them into
 * src/lib/ems/legal/provider/__fixtures__/legislation-gov-uk/ so the offline
 * test suite can be re-recorded against real responses.
 *
 * Never run by `npm test` or CI — this makes real outbound requests and is
 * meant to be run by a developer, by hand, from an environment that can
 * reach legislation.gov.uk (this sandbox's network policy denies it — see
 * the fixtures README).
 *
 * Usage: node scripts/record-legislation-fixtures.mjs
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

const BASE_URL = "https://www.legislation.gov.uk";
const USER_AGENT =
  "ParagonEMS-LegalRegister/1.0 (+https://github.com/calja88/carbon-accounting; contact: legal-register@paragon-ems.invalid)";
const MAX_ENTRIES_PER_FIXTURE = 3;
const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src/lib/ems/legal/provider/__fixtures__/legislation-gov-uk",
);

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true });

async function fetchFeed(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
  return response.text();
}

function trimFeed(xml, maxEntries) {
  const doc = parser.parse(xml, true);
  const feed = doc.feed;
  if (!feed) throw new Error("Response has no <feed> root — cannot trim.");
  const entries = Array.isArray(feed.entry) ? feed.entry : feed.entry ? [feed.entry] : [];
  feed.entry = entries.slice(0, maxEntries);
  // Drop the "next" link so a trimmed fixture never implies more pages
  // exist than were actually written.
  const links = Array.isArray(feed.link) ? feed.link : feed.link ? [feed.link] : [];
  feed.link = links.filter((link) => link["@_rel"] !== "next");
  return builder.build(doc);
}

async function recordFeed(sourceUrl, fileName, { maxEntries = MAX_ENTRIES_PER_FIXTURE } = {}) {
  console.log(`Fetching ${sourceUrl} ...`);
  const xml = await fetchFeed(sourceUrl);
  const trimmed = trimFeed(xml, maxEntries);
  const outPath = path.join(FIXTURES_DIR, fileName);
  await writeFile(outPath, trimmed, "utf8");
  console.log(`Wrote ${outPath}`);
}

async function main() {
  await recordFeed(`${BASE_URL}/new/data.feed`, "publications-page-1.atom.xml");
  await recordFeed(`${BASE_URL}/changes/data.feed`, "effects-page-1.atom.xml");
  console.log(
    "\nDone. publications-page-2.atom.xml, instrument-uksi-2020-1.atom.xml, and the malformed/partial " +
      "fixtures are deliberately hand-authored edge cases, not live recordings — leave them as-is unless " +
      "you are updating the specific behaviour they test (see the fixtures README).",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
