/**
 * Seeds *only* the starter methodology profile — no emission factor values of
 * any kind.
 *
 * The full seed (`npm run db:seed`) also inserts the illustrative placeholder
 * life-cycle factors, which exist so the engine can be exercised end to end in
 * development. Those are deliberately not wanted in a database that real
 * assessments will be built in, even though the validation engine blocks them
 * from reaching a reported figure.
 *
 * This entry point exists so a production database can be given the one thing
 * the product LCA module genuinely needs to function — a methodology profile
 * defining allocation, recycling, electricity, biogenic and offset treatment —
 * without also being given numbers nobody sourced.
 *
 * Idempotent: re-running it changes nothing.
 *
 *   DATABASE_URL="postgres://…" npx tsx prisma/seed/lca-methodology-only.ts
 */

import { PrismaClient } from "@prisma/client";
import { seedLcaMethodology } from "./lca";

const prisma = new PrismaClient();

async function main() {
  const before = await prisma.lcaMethodologyProfile.count();
  await seedLcaMethodology(prisma);
  const after = await prisma.lcaMethodologyProfile.count();

  const profile = await prisma.lcaMethodologyProfile.findFirst({ where: { isDefault: true } });

  if (after > before) {
    console.log(`Created methodology profile: ${profile?.name} ${profile?.version}`);
  } else {
    console.log(`Methodology profile already present: ${profile?.name} ${profile?.version} — nothing changed.`);
  }
  console.log(
    "Review every field on /methodologies before an assessment built on it is issued: each one is read by the calculation engine, not just by a reader.",
  );

  const factorCount = await prisma.emissionFactor.count({ where: { category: { startsWith: "lca_" } } });
  console.log(
    factorCount === 0
      ? "No life-cycle emission factors are loaded. Import them through Admin → Emission factors, or enter sourced factors per inventory line."
      : `${factorCount} life-cycle emission factor(s) already in the library.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
