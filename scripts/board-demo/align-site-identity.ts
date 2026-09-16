/**
 * Aligns an already-seeded BOARD demo database to the real UK operating-site
 * identities the fixture now carries (`BOARD1.sites` / `BOARD1.organisation`).
 *
 * `live-seed-port.ts` writes site, organisation and entity names exactly once,
 * at first build, and a rebuild of an existing fixture is refused rather than
 * replayed — so this is the migration path for the demo database that already
 * exists, the same role `align-demo-catalogue.ts` plays for the Phase 6
 * catalogue corrections.
 *
 * WHAT THIS IS, AND IS NOT
 * -----------------------
 * Real site identity over synthetic demonstration data. Only *names* move:
 * every quantity, factor, calculation, scope allocation, reporting window and
 * collection requirement is left exactly as it was, and no row is created or
 * deleted. The synthetic disclosure is unaffected — the runtime banner is
 * driven by the demo manifest, provisioning token, fixture lease and connected
 * database identity (`src/lib/board/demo-identity.ts`), never by an
 * organisation or site name, so renaming cannot switch it off.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 * -----------------------------------
 * Three record kinds keep their original wording because they are immutable
 * history, not presentation, and rewriting them would be falsifying a record:
 *
 *  - `AuditEvent` — hash-chained (`contentHash`/`previousEventHash`). It says
 *    what was actually recorded at the time.
 *  - `ManagementReviewPack` — ISSUED, and `getManagementReviewPack` re-verifies
 *    `checksumSha256` against the payload on every read. Editing the payload
 *    would break the pack page outright.
 *  - `NonconformityClosure.snapshot` — the frozen state at closure, pinned as a
 *    source revision by that issued pack.
 *
 * Site *ids* are never changed, so every historical reference — activity
 * entries, calculations, obligations, source configuration, collection
 * requirements, reporting periods — stays attached exactly as it was.
 *
 * Idempotent and deterministic: sites/organisation/entity are set by id from
 * the fixture's own identity map, and the narrative pass rewrites only legacy
 * strings, which a second run no longer finds. Run through the demo-safe
 * wrapper, never directly:
 *
 *   pnpm run db:board-demo:align-site-identity -- --dry-run
 *   pnpm run db:board-demo:align-site-identity
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { BOARD1, SOURCE_DOCUMENTS, sourceDocumentBody, type SourceDocumentKey } from "./board1";
import { assertDemoDatabaseTarget } from "./db-target-guard";
import { applyLegacyRenames } from "./site-identity-fixture";
import { FIXTURE_ORGANISATION_SLUG_PREFIX } from "./live-seed-port";

/**
 * The exact columns carrying a site or group name in free text, found by
 * scanning every text/json column in the demo database. An explicit list, never
 * a blind sweep: the frozen records above are absent on purpose.
 */
const NARRATIVE_COLUMNS: readonly { table: string; column: string; json?: boolean }[] = [
  { table: "ActivityProcess", column: "name" },
  { table: "OtherRequirementSource", column: "issuingParty" },
  { table: "ApplicabilityAssessment", column: "rationale" },
  { table: "Nonconformity", column: "reopenReason" },
  { table: "ContainmentRecord", column: "actionTaken" },
  { table: "RootCauseAnalysis", column: "conclusion" },
  { table: "RootCauseAnalysis", column: "analysisPayload", json: true },
  { table: "CorrectiveAction", column: "description" },
];

/** Row counts that must not move. A rename writes no row and deletes none. */
const TRACKED_COUNTS = [
  "organisation", "site", "user", "organisationMembership", "activityEntry", "calculation",
  "emissionFactor", "activityDataPoint", "organisationSourceConfig", "carbonCollectionRequirement",
  "product", "lcaAssessment", "lcaInventoryItem", "lcaCalculationResult", "entity",
  "reportingPeriod", "evidenceObject", "sourceDocument", "carbonSourcePeriodObligation",
] as const;

async function snapshot(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const model of TRACKED_COUNTS) {
    out[model] = await (prisma[model] as { count: () => Promise<number> }).count();
  }
  return out;
}

interface Planned {
  label: string;
  before: string;
  after: string;
  apply: () => Promise<void>;
}

/** Sites, organisation and entity are set by id from the fixture's own identity map — never matched by their old name. */
async function planIdentityRenames(organisationId: string, entityId: string, siteIds: Record<string, string>): Promise<Planned[]> {
  const planned: Planned[] = [];

  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, select: { name: true, slug: true } });
  if (!org.slug.startsWith(FIXTURE_ORGANISATION_SLUG_PREFIX)) {
    throw new Error(`Refusing: organisation ${organisationId} does not carry the fixture slug prefix.`);
  }
  if (org.name !== BOARD1.organisation) {
    planned.push({
      label: "Organisation.name",
      before: org.name,
      after: BOARD1.organisation,
      apply: async () => { await prisma.organisation.update({ where: { id: organisationId }, data: { name: BOARD1.organisation } }); },
    });
  }

  const entity = await prisma.entity.findFirstOrThrow({ where: { id: entityId, organisationId }, select: { name: true } });
  if (entity.name !== BOARD1.organisation) {
    planned.push({
      label: "Entity.name",
      before: entity.name,
      after: BOARD1.organisation,
      apply: async () => { await prisma.entity.update({ where: { id: entityId }, data: { name: BOARD1.organisation } }); },
    });
  }

  for (const site of BOARD1.sites) {
    const id = siteIds[site.key];
    if (!id) throw new Error(`Refusing: the fixture identity map has no site id for key "${site.key}".`);
    // Re-proved against this organisation, exactly as the seed re-proves the map's ids.
    const row = await prisma.site.findFirstOrThrow({ where: { id, organisationId }, select: { name: true } });
    if (row.name === site.name) continue;
    planned.push({
      label: `Site.name [${site.key}] ${id}`,
      before: row.name,
      after: site.name,
      apply: async () => { await prisma.site.update({ where: { id }, data: { name: site.name } }); },
    });
  }

  return planned;
}

/** Free-text mentions of the superseded names, scoped to the fixture organisation. */
async function planNarrativeRenames(organisationId: string): Promise<Planned[]> {
  const planned: Planned[] = [];

  for (const { table, column, json } of NARRATIVE_COLUMNS) {
    const expression = json ? `"${column}"::text` : `"${column}"`;
    let rows: { id: string; value: string | null }[];
    try {
      rows = await prisma.$queryRawUnsafe<{ id: string; value: string | null }[]>(
        `SELECT "id", ${expression} AS value FROM "${table}" WHERE "organisationId" = $1`,
        organisationId,
      );
    } catch (error) {
      throw new Error(`Could not read ${table}.${column}: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const row of rows) {
      if (row.value === null) continue;
      const next = applyLegacyRenames(row.value);
      if (next === row.value) continue;
      // A json column must still be json after the substitution.
      if (json) JSON.parse(next);
      planned.push({
        label: `${table}.${column} ${row.id}`,
        before: row.value,
        after: next,
        apply: async () => {
          await prisma.$executeRawUnsafe(
            `UPDATE "${table}" SET "${column}" = $1${json ? "::jsonb" : ""} WHERE "id" = $2 AND "organisationId" = $3`,
            next, row.id, organisationId,
          );
        },
      });
    }
  }

  return planned;
}

/**
 * The two synthetic SourceDocuments name the site they document, and their
 * bytes are content-addressed — `verifyAllInvariants` re-derives them from
 * `sourceDocumentBody` and compares byte-for-byte, through the real
 * tenant-scoped document path. Renaming a site without converging these would
 * leave a board reviewer opening an invoice for a site that no longer exists,
 * and would fail the fixture's own replay check.
 */
async function planSourceDocumentRenames(organisationId: string, documentIds: Record<string, string>): Promise<Planned[]> {
  const planned: Planned[] = [];

  for (const key of Object.keys(SOURCE_DOCUMENTS) as SourceDocumentKey[]) {
    const id = documentIds[key];
    if (!id) throw new Error(`Refusing: the fixture identity map has no source document id for "${key}".`);
    const document = await prisma.sourceDocument.findFirstOrThrow({
      where: { id, organisationId },
      select: { id: true, filename: true, content: true },
    });
    // Derived from the entry the document actually documents, exactly as the
    // seed and the invariant both do — never from the stored bytes.
    const entry = await prisma.activityEntry.findFirstOrThrow({
      where: { organisationId, sourceDocumentId: document.id },
      select: { canonicalValue: true, canonicalUnit: true },
    });
    const expected = Buffer.from(sourceDocumentBody(key, entry.canonicalValue.toString(), entry.canonicalUnit), "utf8");
    const current = Buffer.from(document.content);
    if (current.equals(expected)) continue;

    planned.push({
      label: `SourceDocument.content [${key}] ${document.id} (${document.filename})`,
      before: current.toString("utf8"),
      after: expected.toString("utf8"),
      apply: async () => {
        await prisma.sourceDocument.update({
          where: { id: document.id },
          // sha256/byteSize are the document's content address; they move with the bytes or the invariant fails.
          data: { content: expected, sha256: createHash("sha256").update(expected).digest("hex"), byteSize: expected.length },
        });
      },
    });
  }

  return planned;
}

async function main(): Promise<void> {
  // Belt and braces: the wrapper already verified the configuration, but a
  // direct `tsx` invocation must not be able to skip it.
  assertDemoDatabaseTarget(process.env);
  const [identity] = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
  console.log(`connected: ${identity.db} as ${identity.usr}`);

  const lease = await prisma.demoFixtureLease.findUniqueOrThrow({ where: { fixtureKey: BOARD1.fixtureVersion } });
  if (!lease.fixtureOrganisationId) throw new Error("Refusing: the BOARD-1 lease records no fixture organisation.");
  const map = lease.identityMap as Record<string, unknown> | null;
  const entityId = typeof map?.entityId === "string" ? map.entityId : null;
  const siteIds = map?.siteIds && typeof map.siteIds === "object" && !Array.isArray(map.siteIds)
    ? (map.siteIds as Record<string, string>)
    : null;
  const documentIds = {
    invoice: typeof map?.invoiceSourceDocumentId === "string" ? map.invoiceSourceDocumentId : "",
    meter: typeof map?.meterReadingSourceDocumentId === "string" ? map.meterReadingSourceDocumentId : "",
  };
  if (!entityId || !siteIds || !documentIds.invoice || !documentIds.meter) {
    throw new Error("Refusing: the BOARD-1 lease has no usable identity map — a rename must be anchored to recorded ids, never guessed from names.");
  }

  const planned = [
    ...(await planIdentityRenames(lease.fixtureOrganisationId, entityId, siteIds)),
    ...(await planNarrativeRenames(lease.fixtureOrganisationId)),
    ...(await planSourceDocumentRenames(lease.fixtureOrganisationId, documentIds)),
  ];

  console.log(`\nRecords to change: ${planned.length}`);
  for (const change of planned) {
    console.log(`  ${change.label}\n    - ${change.before.slice(0, 200)}\n    + ${change.after.slice(0, 200)}`);
  }
  if (planned.length === 0) console.log("  (none — already aligned)");

  if (process.argv.includes("--dry-run")) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const before = await snapshot();
  for (const change of planned) await change.apply();
  const after = await snapshot();

  const moved = TRACKED_COUNTS.filter((model) => before[model] !== after[model]);
  console.log(`\nBEFORE ${JSON.stringify(before)}`);
  console.log(`AFTER  ${JSON.stringify(after)}`);
  if (moved.length > 0) {
    throw new Error(`A rename changed row counts, which it must never do: ${moved.map((m) => `${m} ${before[m]}->${after[m]}`).join(", ")}`);
  }
  console.log("Row counts unchanged across every tracked table.");
  console.log(`Aligned ${planned.length} record(s) to the BOARD-1 site identities.`);
}

main()
  .catch((error: unknown) => {
    console.error("Site-identity alignment failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
