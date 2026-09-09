/**
 * Parsing for legislation.gov.uk's Atom search/changes feeds and the
 * single-entry feed each instrument exposes at `{uri}/data.feed` (spec §4:
 * "parser, canonical identifiers, pagination/cursor mapping").
 *
 * legislation.gov.uk documents its Atom feeds at
 * https://www.legislation.gov.uk/developer/formats and
 * https://www.legislation.gov.uk/developer/uris — entries use plain Atom
 * (`id`, `title`, `updated`, `published`, `link`) plus two extension
 * namespaces: Dublin Core (`dc:type`, `dc:identifier`) for publication
 * metadata, and legislation.gov.uk's own `leg:` namespace
 * (`leg:affectedURI`, `leg:affectingURI`, `leg:type`, `leg:appliedDate`) for
 * changes/effects entries. This module targets that documented shape.
 *
 * This sandbox cannot reach legislation.gov.uk (outbound network policy
 * denies it — see `__fixtures__/legislation-gov-uk/README.md`), so the field
 * mapping below has not been checked against a live capture in this session.
 * The fixtures it's tested against were built to match the documented
 * shape, not recorded live. Re-run `scripts/record-legislation-fixtures.mjs`
 * from an environment with network access and diff the result against
 * `__fixtures__/legislation-gov-uk/` before relying on this in production.
 */

import { XMLParser } from "fast-xml-parser";
import { LegalContentProviderError } from "./types";

const LEGISLATION_HOST_PREFIXES = ["https://www.legislation.gov.uk/id/", "https://www.legislation.gov.uk/"];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  trimValues: true,
});

/** legislation.gov.uk canonical URIs are always `{host}/{type}/{year}/{number}[/...]`; the canonical ID is that path with no host, trimmed of any trailing format/section segment beyond the third path component. */
export function toCanonicalId(uriOrPath: string): string {
  let path = uriOrPath.trim();
  for (const prefix of LEGISLATION_HOST_PREFIXES) {
    if (path.startsWith(prefix)) {
      path = path.slice(prefix.length);
      break;
    }
  }
  path = path.replace(/^\/+|\/+$/g, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new LegalContentProviderError(`Cannot derive a canonical ID from "${uriOrPath}".`, "PARSE_ERROR", false);
  }
  // Keep at most {type}/{year}/{number} — drop trailing segments like
  // "made", "data.feed", "data.xml", "2020-03-01" (point-in-time views).
  return segments.slice(0, 3).join("/");
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return textOf((value as Record<string, unknown>)["#text"]);
  }
  return String(value).trim() || null;
}

function dateOf(value: unknown): Date | null {
  const text = textOf(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function findLinkHref(entry: Record<string, unknown>, rel: string): string | null {
  for (const link of asArray(entry.link as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    if ((link as Record<string, unknown>)["@_rel"] === rel) {
      return textOf((link as Record<string, unknown>)["@_href"]);
    }
  }
  return null;
}

export interface ParsedAtomEntry {
  id: string;
  title: string | null;
  updated: Date | null;
  published: Date | null;
  alternateHref: string | null;
  dcType: string | null;
  legAffectedUri: string | null;
  legAffectingUri: string | null;
  legType: string | null;
  legAppliedDate: Date | null;
  raw: Record<string, unknown>;
}

export interface ParsedAtomFeed {
  entries: ParsedAtomEntry[];
  nextHref: string | null;
}

/**
 * Parses one Atom feed document. Throws `LegalContentProviderError` with
 * `code: "PARSE_ERROR"` for anything that isn't well-formed XML or doesn't
 * contain a `<feed>` root — the T41 acceptance criterion "malformed ...
 * responses fail safely" starts here, before any entry is looked at.
 */
export function parseAtomFeed(xml: string): ParsedAtomFeed {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser.parse(xml, true) as Record<string, unknown>;
  } catch (err) {
    throw new LegalContentProviderError(`Provider response is not well-formed XML: ${err instanceof Error ? err.message : String(err)}`, "PARSE_ERROR", false);
  }

  const feed = doc.feed as Record<string, unknown> | undefined;
  if (!feed || typeof feed !== "object") {
    throw new LegalContentProviderError("Provider response has no <feed> root element.", "PARSE_ERROR", false);
  }

  const nextHref = findLinkHref(feed, "next");

  const entries: ParsedAtomEntry[] = [];
  for (const rawEntry of asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const entry = rawEntry as Record<string, unknown>;
    const id = textOf(entry.id);
    if (!id) {
      // An entry with no <id> has no canonical identifier to attach to —
      // this one entry is unusable, but it does not invalidate the rest of
      // the page (T41 acceptance: "partial responses fail safely", read as
      // "safely" rather than "loudly reject the whole batch").
      continue;
    }
    entries.push({
      id,
      title: textOf(entry.title),
      updated: dateOf(entry.updated),
      published: dateOf(entry.published),
      alternateHref: findLinkHref(entry, "alternate"),
      dcType: textOf(entry["dc:type"]),
      legAffectedUri: textOf(entry["leg:affectedURI"]),
      legAffectingUri: textOf(entry["leg:affectingURI"]),
      legType: textOf(entry["leg:type"]),
      legAppliedDate: dateOf(entry["leg:appliedDate"]),
      raw: entry,
    });
  }

  return { entries, nextHref };
}
