"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { upsertSiteEnergyContract } from "@/lib/entries-service";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { assertSiteAccess, requirePermission } from "@/lib/rbac/authorize";
import { toTenantRepositoryContext } from "@/lib/repositories/carbon-repository";

const schema = z.object({
  siteId: z.string().min(1),
  supplierName: z.string().min(1, "Enter a supplier name."),
  tariffType: z.enum(["STANDARD", "GREEN"]),
  regoBacked: z.enum(["yes", "no"]),
  regoVolumeKwh: z.coerce.number().nonnegative().optional().or(z.literal("")),
});

export interface ContractFormState {
  error: string | null;
  success: boolean;
}

export async function submitContractAction(
  _prevState: ContractFormState,
  formData: FormData,
): Promise<ContractFormState> {
  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) return { error: "You must be signed in.", success: false };
    throw err;
  }

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input.", success: false };
  }
  const data = parsed.data;

  try {
    requirePermission(context, "carbon.contract.manage");
    assertSiteAccess(context, data.siteId);

    await upsertSiteEnergyContract(toTenantRepositoryContext(context), {
      siteId: data.siteId,
      effectiveFrom: new Date(),
      supplierName: data.supplierName,
      tariffType: data.tariffType,
      regoBacked: data.regoBacked === "yes",
      regoVolumeKwh: data.regoVolumeKwh === "" || data.regoVolumeKwh === undefined ? null : data.regoVolumeKwh,
      enteredByUserId: context.userId,
    });

    revalidatePath(`/entry/${data.siteId}`);
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong.", success: false };
  }
}
