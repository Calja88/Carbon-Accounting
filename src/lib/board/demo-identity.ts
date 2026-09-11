import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isVerifiedDemoEnvironment } from "./live-environment";
import { logEvent } from "@/lib/observability/logger";

/** Same manifest/token/connected-role/exact-organisation trust checks as the seed.
 * Runtime reads never accept CI's shared-fixture exception or a name heuristic. */
export async function isVerifiedSyntheticOrganisation(organisationId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  if (process.env.APP_DATA_MODE !== "synthetic") return false;
  // APP_DATA_MODE=synthetic pointed at a database that carries no fixture
  // tables makes every query below throw. That is a misconfiguration of the
  // optional demo, never a reason to take down the app shell for an
  // ordinary organisation — fail closed (no disclosure) and log it.
  try {
    return await verify(organisationId, db);
  } catch (error) {
    logEvent({
      level: "error",
      message: "synthetic-fixture verification failed; treating organisation as ordinary",
      organisationId,
      fields: { errorName: error instanceof Error ? error.name : typeof error, errorMessage: error instanceof Error ? error.message : String(error) },
    });
    return false;
  }
}

async function verify(organisationId: string, db: Prisma.TransactionClient): Promise<boolean> {
  const manifest = await db.demoDatabaseManifest.findUnique({ where: { id: "singleton" } });
  if (!manifest || !process.env.BOARD_DEMO_PROVISIONING_TOKEN || manifest.provisioningToken !== process.env.BOARD_DEMO_PROVISIONING_TOKEN) return false;
  const lease = await db.demoFixtureLease.findUnique({ where: { fixtureKey: "BOARD-1" } });
  if (lease?.fixtureOrganisationId !== organisationId || !["BUILDING", "READY"].includes(lease.status)) return false;
  const [identity] = await db.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
  if (identity?.db !== manifest.approvedDatabaseName || identity?.usr !== manifest.approvedRole) return false;
  const ordinaryOrganisationCount = await db.organisation.count({ where: { NOT: { id: organisationId } } });
  return isVerifiedDemoEnvironment({ actualDatabaseId: manifest.databaseId, manifestEnvironmentId: manifest.environmentId, dataClass: "SYNTHETIC", disposable: true, ordinaryOrganisationCount });
}
