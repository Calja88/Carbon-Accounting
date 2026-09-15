import type { OrganisationContext } from "@/lib/organisation/context";
import { requirePermission } from "@/lib/rbac/authorize";
import { prisma } from "@/lib/prisma";
import { visibleFactorSetFilter } from "@/lib/factor-sets-service";
import { parseUkGovFactors } from "./parse-uk-gov-factors";
import { validateFactorImport } from "./validate-factor-import";
import type { DatasetMetadata, ExistingFactor } from "./types";

/** Backend entry point. Context must be resolved by the server session, never
 * deserialised from upload input. This is not a Server Action or write API. */
export async function previewUkGovFactorImport(context: OrganisationContext, input: {
  buffer: ArrayBuffer | Uint8Array;
  sourceFileName: string;
  metadata?: Partial<DatasetMetadata>;
  existingFactorSetId?: string;
}) {
  requirePermission(context, "carbon.factor.manage");
  let existing: ExistingFactor[] | undefined;
  if (input.existingFactorSetId) {
    const set = await prisma.emissionFactorSet.findFirst({
      where: { id: input.existingFactorSetId, ...visibleFactorSetFilter(context) },
      select: { factors: { select: { category: true, subtypeKey: true, basis: true, scope: true, region: true, unit: true, co2eFactor: true } } },
    });
    if (!set) throw new Error("Factor dataset is unavailable.");
    existing = set.factors.map((row) => ({ ...row, co2eFactor: row.co2eFactor.toString() }));
  }
  const parsed = await parseUkGovFactors(input.buffer, input.sourceFileName, input.metadata);
  return validateFactorImport(parsed, existing);
}
