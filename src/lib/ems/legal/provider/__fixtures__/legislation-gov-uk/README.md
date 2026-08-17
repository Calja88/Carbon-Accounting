# legislation.gov.uk fixtures

Offline test fixtures for `LegislationGovUkProvider` (T41,
`Docs/PHASE4_LEGAL_COMPLIANCE_SPEC.md` §4). Every test that exercises the
client reads one of these files through an injected `fetchImpl` — nothing
under `src/lib/ems/legal/provider/__tests__/` makes a live network call.

## Status of these files

This session's sandbox denies outbound access to `www.legislation.gov.uk`
(confirmed: the environment's HTTPS proxy returns a 403 on `CONNECT` to that
host). The fixtures below were therefore **constructed to match
legislation.gov.uk's documented Atom feed shape**
(<https://www.legislation.gov.uk/developer/formats>,
<https://www.legislation.gov.uk/developer/uris>) — plain Atom
(`id`/`title`/`updated`/`published`/`link`) plus the Dublin Core
(`dc:type`, `dc:identifier`) and `leg:` (`leg:affectedURI`,
`leg:affectingURI`, `leg:type`, `leg:appliedDate`) extension elements the
docs describe — **not captured from a live response**. Treat them as a
faithful-effort approximation, not a verified recording.

Content: entirely publication metadata for fictional example instruments
(`uksi/2026/1`, `ukpga/2026/2`, `ssi/2025/300`, ...) — years and years are
synthetic (no year past this environment's clock date is claimed as real
enacted legislation), no legislative text is included anywhere (per spec
§3: "no unlicensed copied prose"), and no environmental/carbon data of any
kind appears in this directory.

Before this client is used against production data, regenerate real
recordings from an environment that can reach legislation.gov.uk and diff
them against the files here — the field mapping in `atom-parser.ts` and
`legislation-gov-uk.ts` should not change if the real shape matches the
documented one, but this has not been confirmed.

## Files

| File | Used by | Purpose |
|---|---|---|
| `publications-page-1.atom.xml` | `discoverPublications` | First page, includes `link rel="next"` |
| `publications-page-2.atom.xml` | `discoverPublications` | Second page, no `next` link (end of stream) |
| `effects-page-1.atom.xml` | `discoverEffects` | Separate stream/cursor from publications |
| `instrument-uksi-2020-1.atom.xml` | `getInstrument`, `getVersionMetadata` | Single-entry `{uri}/data.feed` response |
| `partial-entries.atom.xml` | malformed/partial handling | One entry with no `<id>`, one with no timestamp, one valid — only the valid entry should survive |
| `malformed-not-xml.txt` | malformed/partial handling | Not well-formed XML (unclosed tags) — must fail safely, not throw an unhandled error |
| `no-feed-root.xml` | malformed/partial handling | Well-formed XML but no `<feed>` root (e.g. an HTML error page served with a misleading content-type) |

## Licensing

legislation.gov.uk content is Crown copyright, published under the [Open
Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/),
which permits copying and reuse (including commercial use) with
attribution. Only small excerpts of structural metadata belong here —
never bulk downloads, never the licensed text of an instrument's
provisions (that stays as a `sourceUrl` reference, per T40's
`LegalProvisionReference` model, which explicitly never stores provision
text).

## Regenerating from a live environment

`scripts/record-legislation-fixtures.mjs` (repo root) fetches the same
endpoints this client calls and writes trimmed responses into this
directory. It is never invoked by tests or CI — it is a manual developer
tool, run only when you have real network access and want to refresh these
files:

```sh
node scripts/record-legislation-fixtures.mjs
```

It identifies itself with the same respectful `User-Agent` the client
sends in production (see `LEGAL_PROVIDER_CONTACT` in
`legislation-gov-uk.ts`), applies the same request policy (one request per
endpoint, no retries), and truncates each feed to its first few entries
before writing — never a full bulk crawl.
