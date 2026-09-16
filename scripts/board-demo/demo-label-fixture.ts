/**
 * The display-label rules that carry an already-seeded BOARD demo from the
 * "BOARD-1" wording a board audience used to see to plain "Demo", with no
 * database dependency — the same split as `site-identity-fixture.ts` and
 * `collection-plan-fixture.ts`, so the rules can be asserted (and their
 * idempotency proved) without a live connection.
 *
 * `align-demo-catalogue.ts` is the only thing that applies them.
 *
 * WHAT THIS IS, AND IS NOT
 * -----------------------
 * Presentation only. `live-seed-port.ts` writes these display strings once,
 * with `update: {}`, so a re-seed leaves an existing environment untouched —
 * this is the migration path for the demo database that already exists, the
 * same role the rest of `align-demo-catalogue.ts` plays for the Phase 6
 * catalogue corrections. It is the database-side half of commit 3e94741,
 * which changed the same literals in the seed.
 *
 * Every technical identity stays exactly as it was, because things are
 * anchored to it: `BOARD1.fixtureVersion`, the `DemoFixtureLease.fixtureKey`,
 * the organisation slug, `ActivityDataPoint.code` (`BOARD1-*`),
 * `factorCategory` (`board1_*`, the emission-factor lookup key),
 * `buildPriority`, the `BOARD-1:*` submission external keys, the
 * `BOARD1-LCA/NC/CTL/PACK/MR-*` references, `BOARD1-CA-EXT`, the
 * `board1-agenda` template key, the `BOARD-1 <persona>` user and role names
 * every lookup keys off, and the content-addressed evidence bytes.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 * -----------------------------------
 * Immutable history keeps its original wording, because rewriting it would be
 * falsifying a record — the same three record kinds `align-site-identity.ts`
 * leaves alone: hash-chained `AuditEvent`, the ISSUED `ManagementReviewPack`
 * whose `checksumSha256` is re-verified against its payload on every read, and
 * `NonconformityClosure.snapshot`. If those still read "BOARD-1", that is what
 * was recorded at the time and it stays.
 */

/**
 * The presentation prefix the demo used to carry, and what replaces it.
 * `Demo ` does not contain `BOARD-1 `, which is what makes a rerun a no-op.
 */
export const DEMO_LABEL_PREFIX = { from: "BOARD-1 ", to: "Demo " } as const;

/**
 * `ActivityDataPoint.dataPointName` — the source name on the data-entry list,
 * the entry form, /sources, the activity register and every calculation
 * drill-down. "BOARD-1 gas" -> "Demo gas".
 *
 * A prefix rewrite rather than a re-derivation: the seed builds this from its
 * own `sourceKey`, which the catalogue row does not carry, and the existing
 * name is the only place that key survives.
 */
export function demoDataPointName(current: string): string {
  return current.startsWith(DEMO_LABEL_PREFIX.from)
    ? DEMO_LABEL_PREFIX.to + current.slice(DEMO_LABEL_PREFIX.from.length)
    : current;
}

/**
 * `ActivityDataPoint.category` — the display category on the activity detail
 * page. Re-derived from `factorCategory` exactly as the seed now does, so the
 * `board1_` lookup prefix stops leaking into a user-facing label while the
 * lookup key itself is left alone.
 *
 * Derived, not rewritten: the same input always yields the same output, so a
 * second run plans nothing. Kept in step with `live-seed-port.ts` by the
 * assertions in `tests/board-product/demo-label-convergence.test.ts`, the same
 * way this file's neighbour duplicates the seed's `promptTemplate`.
 */
export function demoDisplayCategory(factorCategory: string): string {
  return factorCategory.replace(/^board1_/, "").replace(/_/g, " ");
}

/**
 * The one-off display strings the seed writes as literals. Matched on the
 * exact superseded value, never on a pattern: an exact match cannot catch a
 * row nobody meant, and no `after` contains its `before`, so a rerun finds
 * nothing.
 *
 * `table` is the Postgres relation. Every column here is a name, a title or a
 * cited source — never a quantity, status, key or checksum.
 */
export interface DisplayLiteral {
  table: string;
  column: string;
  before: string;
  after: string;
}

/**
 * What a display rename must never move. `align-demo-catalogue.ts` counts
 * these before and after and fails the run if any of them changed — the
 * accounting tables because a label is not allowed to touch a figure, and
 * `managementReviewPack`/`auditEvent` because a label is not allowed to add
 * to the immutable record either.
 *
 * `rolePermission` is deliberately absent: concern 3 of that script exists to
 * add exactly one such row.
 */
export const TRACKED_COUNTS = [
  "activityEntry", "calculation", "activityDataPoint", "emissionFactorSet", "emissionFactor",
  "organisationSourceConfig", "carbonCollectionRequirement", "product", "lcaAssessment",
  "lcaInventoryItem", "reportingPeriod", "carbonSourcePeriodObligation", "emsAudit",
  "auditProgramme", "emsProgramme", "managementReviewPack", "auditEvent",
] as const;

export const DISPLAY_LITERALS: readonly DisplayLiteral[] = [
  // Shown on /admin/factors and on every calculation's factor provenance.
  { table: "EmissionFactorSet", column: "name", before: "BOARD-1 demo factors — not for reporting", after: "Demo factors — not for reporting" },
  // EMS programme heading.
  { table: "EmsProgramme", column: "name", before: "BOARD-1 demonstration programme", after: "Demo programme" },
  { table: "ComplianceEvaluationProgramme", column: "name", before: "BOARD-1 compliance evaluation programme", after: "Demo compliance evaluation programme" },
  { table: "AuditProgramme", column: "name", before: "BOARD-1 internal audit programme", after: "Demo internal audit programme" },
  { table: "EmsAudit", column: "title", before: "BOARD-1 internal audit", after: "Demo internal audit" },
  // Cited factor source on every manually-assigned LCA inventory item.
  { table: "LcaInventoryItem", column: "manualFactorSource", before: "BOARD-1 demonstration — not for reporting", after: "Demo — not for reporting" },
  // Agenda template display name; `templateKey` stays "board1-agenda".
  { table: "ManagementReviewAgendaTemplate", column: "name", before: "BOARD-1 demonstration agenda", after: "Demo agenda" },
];
