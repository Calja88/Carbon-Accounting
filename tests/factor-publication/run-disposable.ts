import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { assertDisposableFactorTarget, disposableFactorEnvironment } from "./disposable-target";

const [receiptPath, command] = process.argv.slice(2);
if (!receiptPath || !["status", "deploy", "check-sql", "test"].includes(command)) throw new Error("Usage: run-disposable <private creation receipt.json> status|deploy|check-sql|test");
const receipt = assertDisposableFactorTarget(JSON.parse(readFileSync(receiptPath, "utf8")));
const root = path.resolve(import.meta.dirname, "../..");
const env = disposableFactorEnvironment(receipt, process.env);
// Prisma's existing assertConsistentMigrationTarget runs again inside each CLI
// invocation with BOTH URLs explicitly set; alternate ambient overrides cleared.
console.log(`Disposable target: ${receipt.projectId} / ${receipt.branchId} / ${receipt.endpointId}`);
let scratch: string | undefined;
let args: string[];
if (command === "test" || command === "check-sql") {
  scratch = mkdtempSync(path.join(tmpdir(), "carbon-factor-schema-"));
  const migrationBytes = readFileSync(path.join(root, "prisma/migrations/20260915160000_official_factor_publication_contracts/migration.sql"));
  const migration = command === "check-sql" ? migrationBytes.toString("utf8") : "";
  const checksum = createHash("sha256").update(migrationBytes).digest("hex");
  const historyCheck = command === "test" ? `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260915160000_official_factor_publication_contracts' AND checksum='${checksum}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'Applied migration checksum mismatch'; END IF; END $$;` : "";
  const assertions = readFileSync(path.join(root, "tests/factor-publication/constraints.sql"), "utf8");
  writeFileSync(path.join(scratch, "check.sql"), `BEGIN;\n${migration}\n${historyCheck}\n${assertions}\nROLLBACK;\n`);
  // db execute in Prisma 6 requires --url or --schema. Use the explicit direct
  // endpoint, never the pooled datasource; spawn arguments are not shell text.
  args = ["node_modules/prisma/build/index.js", "db", "execute", "--url", receipt.directUrl, "--file", path.join(scratch, "check.sql")];
} else args = ["node_modules/prisma/build/index.js", "migrate", command === "status" ? "status" : "deploy"];
const result = spawnSync(process.execPath, args, { cwd: root, env: { ...env, FACTOR_PUBLICATION_TARGET_FILE: path.resolve(receiptPath) }, encoding: "utf8", timeout: 180_000 });
// Defensive redaction even though Prisma ordinarily prints only the datasource host.
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[REDACTED_DATABASE_URL]");
console.log(output);
if (result.error) console.error("Disposable command failed or timed out");
if (scratch) { unlinkSync(path.join(scratch, "check.sql")); rmdirSync(scratch); }
process.exitCode = result.status ?? 1;
