"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { deleteActivityEntry } from "@/lib/entries-service";

/**
 * Deletes an activity entry (and its calculation(s)). Refuses if any of
 * those calculations already fed a generated report — see
 * deleteActivityEntry in entries-service.ts, which is where that check and
 * the actual delete live; this action only handles auth and navigation.
 * Gated the same way entry creation is (any signed-in user) — the
 * corporate side of this app has no graduated role model the way the LCA
 * module does, so deletion isn't given a narrower gate than creation has.
 */
export async function deleteActivityEntryAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("You must be signed in.");

  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return;

  await deleteActivityEntry(entryId);

  revalidatePath("/data/entries");
  revalidatePath("/");
  redirect("/data/entries");
}
