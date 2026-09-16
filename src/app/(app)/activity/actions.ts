"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { isReportingPeriodClosedError } from "@/lib/carbon/reporting-period-guard";
import {
  ActivityRecordNotFoundError,
  ActivityRecordProtectedError,
  deleteActivityEntry,
  updateActivityEntryNotes,
} from "@/lib/carbon/activity-register-service";

/**
 * Phase 4-iii-b: one server action behind each control on the Activity Data
 * Register. Plain form posts, no optimistic client state — what the register
 * shows after the round trip is what the database actually holds.
 *
 * Every rejection the domain can produce comes back as its own named code the
 * page renders as a real sentence. Nothing here is collapsed into "something
 * went wrong", and nothing is swallowed into a quiet success: an unrecognised
 * failure is rethrown to the route error boundary.
 */
export type ActivityActionErrorCode =
  | "closed"
  | "protected"
  | "denied"
  | "missing"
  | "invalid";

const backSchema = { back: z.string().optional() };

const notesSchema = z.object({ ...backSchema, entryId: z.string().min(1), notes: z.string().max(2000) });
const deleteSchema = z.object({ ...backSchema, entryId: z.string().min(1), confirm: z.string().optional() });

/**
 * Only ever returns to this application's own register — the `back` field
 * travels through a form post, so it is treated as untrusted input.
 */
function safeBack(back: string | undefined, fallback: string): string {
  if (!back || !back.startsWith("/activity")) return fallback;
  return back.includes("\\") || back.startsWith("//") ? fallback : back;
}

function withCode(target: string, key: string, value: string): string {
  const [path, query = ""] = target.split("?");
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}

/** Maps a thrown domain failure to the code the page knows how to say out loud. */
function codeFor(error: unknown): ActivityActionErrorCode | null {
  if (isReportingPeriodClosedError(error)) return "closed";
  if (error instanceof ActivityRecordProtectedError) {
    return error.blockers.includes("permission") ? "denied" : "protected";
  }
  if (error instanceof ActivityRecordNotFoundError || error instanceof TenantOwnershipError) return "missing";
  if (error instanceof PermissionDeniedError) return "denied";
  return null;
}

export async function updateActivityNotesAction(formData: FormData): Promise<void> {
  const parsed = notesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(withCode("/activity", "error", "invalid"));

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  const target = safeBack(parsed.data.back, `/activity/${parsed.data.entryId}`);
  try {
    await updateActivityEntryNotes(context, parsed.data.entryId, parsed.data.notes);
  } catch (err) {
    const code = codeFor(err);
    if (!code) throw err;
    redirect(withCode(target, "error", code));
  }

  revalidatePath("/activity");
  revalidatePath(`/activity/${parsed.data.entryId}`);
  redirect(withCode(target, "saved", "notes"));
}

export async function deleteActivityEntryAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse(Object.fromEntries(formData));
  // Deletion is irreversible, so the typed confirmation is required by the
  // server too — not only by the dialog that collected it.
  if (!parsed.success || parsed.data.confirm !== "DELETE") {
    redirect(withCode(`/activity/${parsed.success ? parsed.data.entryId : ""}`, "error", "invalid"));
  }

  let context;
  try {
    context = await requireOrganisationContext();
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    throw err;
  }

  const listTarget = safeBack(parsed.data.back, "/activity");
  let deleted: { code: string; siteName: string };
  try {
    deleted = await deleteActivityEntry(context, parsed.data.entryId);
  } catch (err) {
    const code = codeFor(err);
    if (!code) throw err;
    // A refusal keeps the user on the record that was refused, where the
    // reason is shown next to the record it is about.
    redirect(withCode(`/activity/${parsed.data.entryId}`, "error", code));
  }

  revalidatePath("/activity");
  redirect(withCode(listTarget, "deleted", `${deleted.code} — ${deleted.siteName}`));
}
