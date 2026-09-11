import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isVerifiedDemoEnvironment } from "./live-environment";

/** Same manifest/token/connected-role/exact-organisation trust checks as the seed.
 * Runtime reads never accept CI's shared-fixture exception or a name heuristic. */
export async function isVerifiedSyntheticOrganisation(organisationId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  if (process.env.APP_DATA_MODE !== "synthetic") return false;
  const manifest = await db.demoDatabaseManifest.findUnique({ where: { id: "singleton" } });
  if (!manifest || !process.env.BOARD_DEMO_PROVISIONING_TOKEN || manifest.provisioningToken !== process.env.BOARD_DEMO_PROVISIONING_TOKEN) return false;
  const lease = await db.demoFixtureLease.findUnique({ where: { fixtureKey: "BOARD-1" } });
  if (lease?.fixtureOrganisationId !== organisationId || !["BUILDING", "READY"].includes(lease.status)) return false;
  const [identity] = await db.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
  if (identity?.db !== manifest.approvedDatabaseName || identity?.usr !== manifest.approvedRole) return false;
  const ordinaryOrganisationCount = await db.organisation.count({ where: { NOT: { id: organisationId } } });
  return isVerifiedDemoEnvironment({ actualDatabaseId: manifest.databaseId, manifestEnvironmentId: manifest.environmentId, dataClass: "SYNTHETIC", disposable: true, ordinaryOrganisationCount });
}
