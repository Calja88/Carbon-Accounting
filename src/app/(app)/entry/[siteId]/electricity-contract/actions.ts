"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { upsertSiteEnergyContract } from "@/lib/entries-service";

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
  const session = await auth();
  if (!session?.user) return { error: "You must be signed in.", success: false };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input.", success: false };
  }
  const data = parsed.data;

  try {
    await upsertSiteEnergyContract({
      siteId: data.siteId,
      effectiveFrom: new Date(),
      supplierName: data.supplierName,
      tariffType: data.tariffType,
      regoBacked: data.regoBacked === "yes",
      regoVolumeKwh: data.regoVolumeKwh === "" || data.regoVolumeKwh === undefined ? null : data.regoVolumeKwh,
      enteredByUserId: session.user.id,
    });

    revalidatePath(`/entry/${data.siteId}`);
    return { error: null, success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong.", success: false };
  }
}
