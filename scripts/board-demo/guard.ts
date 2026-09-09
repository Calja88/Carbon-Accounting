/** No connection is opened here. The adapter must independently read identity from the connected DB. */
export interface DemoEnvironment {
  dataMode: string | undefined; deploymentClass: string | undefined;
  configuredDatabaseId: string | undefined; allowedDatabaseId: string | undefined;
  configuredEnvironmentId: string | undefined;
}
export interface DemoDatabaseIdentity {
  actualDatabaseId: string; manifestEnvironmentId: string;
  dataClass: "SYNTHETIC" | "OTHER"; disposable: boolean;
  ordinaryOrganisationCount: number;
}
export function assertDemoTarget(env: DemoEnvironment, db: DemoDatabaseIdentity): void {
  if (env.dataMode !== "synthetic" || env.deploymentClass !== "private-demo") throw new Error("Not an isolated demo deployment");
  if (!env.configuredDatabaseId || !env.allowedDatabaseId || env.configuredDatabaseId !== env.allowedDatabaseId || db.actualDatabaseId !== env.allowedDatabaseId) throw new Error("Demo database identity mismatch");
  if (!env.configuredEnvironmentId || db.manifestEnvironmentId !== env.configuredEnvironmentId) throw new Error("Demo environment manifest mismatch");
  if (db.dataClass !== "SYNTHETIC" || !db.disposable || db.ordinaryOrganisationCount !== 0) throw new Error("Database contains or may contain ordinary records");
}
