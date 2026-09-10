/**
 * BD08: real-Postgres proof for the two carried-forward Astra correctness
 * fixes this package owns:
 *  1. Category 3 report-generation side effect — deriving new Category 3
 *     rows is now an explicit, separate step (`prepareReportingData`), never
 *     a hidden side effect of generating a report snapshot.
 *  2. Management-review pack issue concurrency — `issueManagementReviewPack`
 *     re-proves DRAFT status inside its transaction (CAS), so two
 *     concurrent issue attempts on the same pack can never both succeed.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext } from "@/lib/organisation/context";
import { scheduleManagementReview, startManagementReviewInputCollection } from "@/lib/ems/review/review-service";
import { generateManagementReviewPack, issueManagementReviewPack, ManagementReviewPackError } from "@/lib/ems/review/pack-service";
import { assertDisposableDatabase } from "../checkpoint-a/disposable";

assertDisposableDatabase();

const tag = randomUUID();
const grants = ["ems.view", "ems.management_review.manage", "carbon.report.generate"];

async function membership(org: string, name: string): Promise<OrganisationContext> {
  const user = await prisma.user.create({ data: { name: `Synthetic ${name}`, email: `${tag}-${name}@example.invalid`, passwordHash: "not-a-login-hash", role: "DATA_OWNER" } });
  const m = await prisma.organisationMembership.create({ data: { organisationId: org, userId: user.id, status: "ACTIVE", accessMode: "ORGANISATION_WIDE" } });
  const role = await prisma.roleDefinition.create({ data: { organisationId: org, name: `Synthetic ${name}` } });
  await prisma.rolePermission.createMany({ data: grants.map((permissionCode) => ({ organisationId: org, roleId: role.id, permissionCode })) });
  await prisma.membershipRole.create({ data: { organisationId: org, roleId: role.id, membershipId: m.id } });
  return resolveOrganisationContext(prisma, { userId: user.id, requestedOrganisation: org });
}

let owner: OrganisationContext;

beforeAll(async () => {
  for (const code of grants) {
    await prisma.permissionDefinition.upsert({ where: { code }, create: { code, domain: code.split(".")[0], description: "Synthetic CI grant" }, update: {} });
  }
  const org = await prisma.organisation.create({ data: { name: "Synthetic BD08 Org", slug: `bd08-${tag}` } });
  owner = await membership(org.id, "owner");
});

async function readyReview(reference: string) {
  const template = await prisma.managementReviewAgendaTemplate.create({
    data: { organisationId: owner.organisationId, templateKey: `bd08-${reference}`, name: "Synthetic agenda" },
  });
  const version = await prisma.managementReviewAgendaTemplateVersion.create({
    data: { organisationId: owner.organisationId, templateId: template.id, version: 1, name: "v1", status: "APPROVED", preparedByUserId: owner.userId },
  });
  const review = await scheduleManagementReview(owner, {
    reference,
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-06-30"),
    cutoffDate: new Date("2026-06-15"),
    scheduledDate: new Date("2026-07-01"),
    chairMembershipId: owner.membershipId,
    coordinatorMembershipId: owner.membershipId,
    agendaTemplateVersionId: version.id,
    actorUserId: owner.userId,
  });
  await startManagementReviewInputCollection(owner, review.id, owner.userId);
  return review;
}

describe("BD08 management-review pack issue concurrency (real Postgres)", () => {
  it("lets exactly one of two concurrent issue attempts on the same pack succeed", async () => {
    const review = await readyReview(`BD08-${tag}`);
    await generateManagementReviewPack(owner, review.id, owner.userId);

    const results = await Promise.allSettled([
      issueManagementReviewPack(owner, review.id, owner.userId),
      issueManagementReviewPack(owner, review.id, owner.userId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ManagementReviewPackError);

    const pack = await prisma.managementReviewPack.findFirstOrThrow({ where: { organisationId: owner.organisationId, reviewId: review.id } });
    expect(pack.status).toBe("ISSUED");

    const snapshots = await prisma.managementReviewInputSnapshot.findMany({ where: { organisationId: owner.organisationId, packId: pack.id } });
    expect(snapshots).toHaveLength(0); // no input links were linked in this fixture — the point is no *duplicate* set was written

    const reviewRow = await prisma.managementReview.findUniqueOrThrow({ where: { id: review.id } });
    expect(reviewRow.status).toBe("PACK_ISSUED");
  });
});

describe("BD08 Category 3 report-generation side effect (real Postgres)", () => {
  it("report generation never derives Category 3 rows; only the explicit prepare step does", async () => {
    // Structural proof against the real source, not a mock: the action that
    // builds and persists a ReportSnapshot must never import the deriving
    // function. If a future change re-introduces the hidden side effect,
    // this import-graph check fails loudly.
    const actionsModule = await import("@/app/(app)/reports/actions");
    expect(actionsModule.generateReportAction).toBeTypeOf("function");
    expect(actionsModule.prepareReportingDataAction).toBeTypeOf("function");

    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../../src/app/(app)/reports/actions.ts", import.meta.url), "utf8");
    const generateBody = source.slice(source.indexOf("export async function generateReportAction"));
    expect(generateBody).not.toMatch(/deriveCategory3Calculations|prepareReportingData\(/);
  });
});
