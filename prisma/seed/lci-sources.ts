/**
 * Seeds the LCI/PCF source governance registry from the staged manifest.
 * Idempotent (upsert by source_id) — safe to run repeatedly. This is a
 * convenience for local `npm run db:seed`; production databases don't need
 * it run manually because `ensureLciSourcesInitialized` (src/lib/lci/source-registry.ts)
 * self-initialises the same rows the first time the Admin -> LCI Data
 * Sources page loads, mirroring the AI settings/catalogue self-init.
 */
import { readSourceManifest, upsertLciSourcesFromManifest } from "../../src/lib/lci/source-registry";

export async function seedLciSources() {
  const manifest = await readSourceManifest();
  const result = await upsertLciSourcesFromManifest(manifest);
  console.log(`  Upserted ${result.upserted} LCI source registry rows (manifest v${result.manifestVersion}).`);
  return result;
}

if (require.main === module) {
  seedLciSources()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
