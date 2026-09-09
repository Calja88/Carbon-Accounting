import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrganisationContext, type OrganisationContext, type PermissionCode } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/ems-repository";
import { lockNonconformity } from "@/lib/repositories/row-locks";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

type Target = { nonconformityId: string } | { correctiveActionId: string } | { containmentId: string } | { rootCauseAnalysisId: string };
/** Lock order: organisation policy guard, parent NC, then children. All state reads happen after the parent lock. */
export async function withLockedNonconformity<T>(context: OrganisationContext, target: Target, permission: PermissionCode,
  operation: (tx: Prisma.TransactionClient, ctx: ReturnType<typeof toTenantRepositoryContext>, context: OrganisationContext) => Promise<T>): Promise<T> {
  requirePermission(context, permission);
  return prisma.$transaction(async tx => {
    const org = context.organisationId;
    // Also serializes against policy creation when no policy row exists yet.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${org} FOR SHARE`;
    let id: string;
    if ("nonconformityId" in target) id = target.nonconformityId;
    else {
      const child = "correctiveActionId" in target
        ? await tx.correctiveAction.findFirst({ where: { organisationId: org, id: target.correctiveActionId }, select: { nonconformityId: true } })
        : "containmentId" in target
        ? await tx.containmentRecord.findFirst({ where: { organisationId: org, id: target.containmentId }, select: { nonconformityId: true } })
        : await tx.rootCauseAnalysis.findFirst({ where: { organisationId: org, id: target.rootCauseAnalysisId }, select: { nonconformityId: true } });
      if (!child) throw new TenantOwnershipError();
      id = child.nonconformityId;
    }
    await lockNonconformity(tx, toTenantRepositoryContext(context), id);
    const current = await resolveOrganisationContext(tx, { userId: context.userId, requestedOrganisation: org, correlationId: context.correlationId });
    requirePermission(current, permission);
    return operation(tx, toTenantRepositoryContext(current), current);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });
}
