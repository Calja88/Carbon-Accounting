import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { assertDisposableDatabase } from "./disposable";
async function main() {
assertDisposableDatabase();
const db = new PrismaClient();
try {
  const tables = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
  if (Number(tables[0].count) !== 0) throw new Error("Migration proof must begin with an empty database. Recreate the disposable service.");
  mkdirSync("artifacts/checkpoint-a", { recursive: true });
  const deploy = () => execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { encoding: "utf8", env: process.env });
  writeFileSync("artifacts/checkpoint-a/migrate-first.txt", deploy());
  const history = () => db.$queryRaw`SELECT id, checksum, migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name, id`;
  const first = JSON.stringify(await history());
  writeFileSync("artifacts/checkpoint-a/migrate-second.txt", deploy());
  const second = JSON.stringify(await history());
  if (first !== second) throw new Error("Second migrate deploy changed migration history.");
  writeFileSync("artifacts/checkpoint-a/migration-history.json", first + "\n");
  console.log("PASS: cumulative migrations applied to an empty database; second deployment left history identical.");
} finally { await db.$disconnect(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
