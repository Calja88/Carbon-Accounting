# Phase 3-vi: factor publication schema and pure contracts

Implemented on `board/product-2026-09-22`. This phase adds schema, pure contracts
and synthetic tests. It does not provide an importer, publication endpoint,
activation service or runtime resolver integration. Import/commit remains
disabled. The official workbook was neither imported nor committed.

## Implemented schema

The 21 model names from the [Phase 3-v architecture](PHASE3_V_FACTOR_PUBLICATION_SCHEMA.md)
are retained:

| Area | Models |
| --- | --- |
| Registry and source | `OfficialFactorRegistry`, `OfficialFactorRelease`, `OfficialSourceArtifact`, `OfficialReleaseArtifact`, `OfficialSourceVerification`, `OfficialArtifactParse`, `OfficialFactorIdentity`, `OfficialSourceFactor` |
| Review and coverage | `OfficialFactorMapping`, `OfficialCoverageContract`, `OfficialCoverageRequirement` |
| Manifest | `OfficialPublicationManifest`, `OfficialManifestArtifact`, `OfficialManifestDisposition`, `OfficialManifestFactor` |
| Authority and lifecycle | `PlatformFactorGrant`, `OfficialFactorApproval`, `OfficialFactorPublication`, `OfficialActivationPlan`, `OfficialActivationWindow`, `OfficialFactorEvent` |

There are 25 new enums. Explicit short SQL names stay within PostgreSQL's
63-byte identifier limit. `OfficialDisposition` maps to `of_disposition_kind`,
because a table also creates a composite type in PostgreSQL's type namespace.

Existing model scalar additions are limited to:

- `EmissionFactorSet.officialManagement`: nullable enum, no default or backfill.
- `EmissionFactor.officialManifestFactorId`: nullable unique lineage FK.
- `EmissionFactor.publishedLookupKey`: nullable canonical lookup key, with an
  additive unique constraint on `(factorSetId, publishedLookupKey)`.

Inverse relations are added to runtime models and `User`; organisation roles and
production role templates are unchanged. Existing factor decimal types and
uniqueness remain intact. Null metadata retains legacy behaviour. The current
resolver does not read the new fields or tables.

## Migration and database validation

Migration: `prisma/migrations/20260915160000_official_factor_publication_contracts/migration.sql`.

Canonical file: UTF-8, LF, 67,192 bytes. The sibling `.gitattributes` pins LF.
SHA-256:

```text
54f0e3152afdb57ee7cb795080c980ff05f119354a705cff15914aec98236707
```

The migration creates new tables, enums, indexes, functions, triggers and
`btree_gist`; existing-table changes are additive nullable columns, constraints
and foreign keys. There is no backfill or existing-data rewrite. UPDATE/DELETE
trigger declarations reject prohibited operations; they are not data mutations.

The migration and SQL assertions first passed in a rolled-back transaction.
The canonical migration was then applied successfully only to this disposable
Neon child, and its recorded migration checksum was verified:

| Property | Value |
| --- | --- |
| Non-production project | `cool-cake-20837205` |
| New branch | `phase3vi-contracts-20260915` |
| Branch ID | `br-tiny-sky-ar3pklia` |
| Parent | `br-cold-grass-aroam3e1` |
| Endpoint | `ep-gentle-heart-ar9gu583` |
| PostgreSQL | 18; `btree_gist` available |
| Created | 2026-09-15 14:48:41 UTC |
| Automatic expiry | 2026-09-16 14:48:37 UTC |

The test runner requires a private branch-creation receipt, validates the project,
new branch, endpoint, credentials' agreement and expiry, explicitly supplies both
`DATABASE_URL` and `DIRECT_URL`, and clears alternate overrides. The existing
Prisma target-consistency guard remains in force. No env file was changed and no
connection credentials are committed. Production and the existing staging
database were not connected to or mutated. Branch creation uses the authorised
parent through Neon's branch API.

## Pure contracts

### Exact numbers

Raw numeric tokens are preserved alongside a normalized integer coefficient and
base-10 exponent. Finite, missing and invalid observations are distinct. Trailing
zeroes and scientific notation normalize without a floating-point value round
trip. Zero remains zero; missing never becomes zero. Negative source observations
can be retained as evidence, but publication conversion rejects negatives.

`toLosslessDecimal18_8` returns an exact decimal string or rejects overflow and
excess fractional precision. It never rounds. Inputs are bounded to 4,096 token
characters, 1,000 coefficient digits and an absolute exponent of 1,000. Source
precision beyond runtime capacity is storable as evidence and blocked from
mapping/publication. SQL checks compare separate exact values with decimal
candidates to detect rounding. Capturing raw workbook XML tokens before ExcelJS
converts values to Number remains future ingestion work.

### Source and artifact identity

Canonical JSON normalizes Unicode and line endings, sorts object keys, preserves
semantic array order and distinguishes null from empty strings. Undefined,
non-integer JSON numbers, sparse arrays and normalized-key collisions fail.
SHA-256 hashes have contract-specific domains.

Source identity includes the release namespace/year/revision and reviewed source
dimensions: hierarchy, source scope/column, unit, gas, boundary, geography, CV,
radiative-forcing and transport qualifiers. It excludes row/sheet position,
numeric value and application mapping. Content hashes bind identity and exact
value so a changed value becomes a conflict under the same identity.

Artifact identity is SHA-256 of the supplied bytes plus their size. File naming
and release association are separate. These utilities do not persist bytes.

### Mapping revisions

Mapped and deliberately unmapped decisions require a rationale. Revisions bind
their source observation and immutable identity stream, target dimensions and
previous revision. Self-reference and invalid predecessor changes fail. No fuzzy
or automatic mapping is implemented. Mapped candidates must preserve source
value, gas, CV and boundary and fit Decimal(18,8) exactly. The implemented initial
policy permits whole-gas GB corporate Direct/WTT/T&D candidates with explicit
scope and companion-category conventions; it does not accept real workbook rows.

### Coverage and manifests

Coverage declares category, null-safe subtype, basis, unit/activity dimensions,
version, mandatory/optional classification and per-key carry-forward permission.
Requirements default to mandatory and carry-forward defaults to false. Duplicate
keys, incompatible companions and companion cycles fail.

The manifest hash binds release/artifact/verification/parse inventory, mapping
revision identities, selected source factors, excluded/rejected dispositions and
reasons, interpreted exact values, original lineage/vintage, coverage, dates and
validation/mapping/provenance versions. Set-like collections are sorted before
hashing. Validation checks counts, mandatory coverage, unique output keys,
release linkage and explicit carry-forward intervals and rationale.

Validation proves consistency relative to the supplied coverage contract. It
does not establish that the contract covers the product's full authorised
inventory, authenticate the source, or grant permission to publish or activate.

## Database integrity and null-safe uniqueness

Null subtype is encoded as `["null"]`; a literal string such as `"null"` is
`["string","null"]`. Canonical lookup keys are JSON arrays containing category,
typed subtype and basis, bounded to 1,024 UTF-8 bytes. SQL CHECK constraints
recompute these encodings, so callers cannot invent a key to bypass uniqueness.

Coverage and manifest keys are non-null and unique in their parent. Runtime
lineage and lookup fields must be both null or both populated; populated keys
must match the runtime dimensions. Legacy all-null metadata remains valid.
Additional unique constraints cover releases, artifact retries, source identity,
mapping revisions, manifests and publication retries.

Source observations, mappings, sealed items and platform events are immutable.
Parse/coverage/manifest/plan assemblies require a seal before commit and prevent
late child insertion. Manifest sealing checks mandatory coverage and complete
source dispositions. Schedule windows use a PostgreSQL exclusion constraint:
overlap within a plan fails; adjacent half-open intervals are allowed. These are
structural schema protections, not an activation mechanism.

## Platform authority and audit

Dedicated platform grants and approvals are separate from organisation
`carbon.factor.manage`, memberships and legacy `User.role`. Pure approval checks
require the relevant platform capability, an independent approver, contributor
binding and a maximum seven-day lifetime. Database checks enforce approval subject
shape, one-way revocation and immutable bodies. No default grants are provisioned.

The separate platform event schema and domain-separated hash chain do not reuse
the organisation audit chain. Verification takes a trusted registry sequence/head
anchor to detect missing tail events as well as internal tampering. Authority
helpers accept caller-supplied current state; querying live grants and emitting
events atomically remain future service work.

## Validation results

- Prisma validation and client generation: passed.
- Focused Vitest checks: **277 tests across 18 files passed**, including 59 new
  pure-contract tests and 14 schema/target-safety tests. Coverage includes existing
  Phase 3-i/ii/iii parser/UI calibration, factor visibility/resolution,
  entries-service, calculation/Scope 3, tenant supplier isolation, relevant report
  and dashboard behaviour, Prisma target guards and concurrent Phase 4-i audit
  regressions.
- Disposable SQL integration: **20 expected constraint refusals**, successful
  valid inserts, deferred seals, exact-number/null-key postconditions and adjacent
  intervals passed. Synthetic fixture records were entirely rolled back. No real
  official factors were persisted and no registry was activated.
- TypeScript `tsc --noEmit --incremental false`: passed.
- ESLint on the new publication library and test directory: passed.
- GitNexus change analysis reported low overall risk with no affected indexed
  execution flows; the complete changed-symbol listing was returned. Prisma model
  caller discovery is not supported, so schema consumers were also checked in
  source. The refresh reported an unavailable full-text index and sampled process
  coverage; zero indexed flows is not proof that all dependencies are absent.
- Full test suite and Next build omitted: no application runtime imports or
  build-loaded application files were changed by this phase.

Concurrent commit `35aea8eeb8e21ed9685328ea2660d4a3803d5210` (Phase 4-i) was
preserved. Unrelated `AGENTS.md`, `CLAUDE.md` and `.claude/` changes are excluded.

## Phase 3-vii handoff and remaining gates

Phase 3-vii can proceed as a separately authorised guarded integration phase:

1. Implement verified immutable artifact storage and raw-token extraction, source
   persistence/repositories and parser acceptance rules under their own tests.
2. Revalidate live grants, approval independence/expiry, canonical stored hashes,
   source authenticity and complete product coverage inside publication
   transactions. Persist audit events and registry sequence changes atomically.
3. Materialise complete inactive runtime projections with idempotency and
   concurrency protection; enforce guarded-set membership, exact lineage and
   projection immutability, including legacy inventories used in schedules.
4. Add guarded readers and activity-period schedules without changing existing
   source precedence. Legacy eligibility must explicitly include null
   `officialManagement`; SQL inequality alone excludes null rows. Prevent partial
   official sets from shadowing complete sets, and preserve original factor
   attribution/vintage in new calculation snapshots.
5. Prove failed/stale/replayed approvals, concurrent publication and activation,
   complete coverage/carry-forward and inactive TEST_ONLY sets synthetically.
   Existing snapshots, Scope 2 methodology and corporate/LCA separation remain
   unchanged. No production migration or activation follows automatically.

Operational decisions remain: trusted storage/retention and file limits, verified
release revision identity, named grant administrators/independent reviewers,
approved seven-day lifetime, authoritative initial GB coverage inventory and
evidence-backed carry-forward criteria. The disposable test validates the schema;
it approves none of these source or operational decisions.
