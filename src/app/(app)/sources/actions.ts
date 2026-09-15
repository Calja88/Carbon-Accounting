"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  CarbonSourceFrequency,
  SourceConfigError,
  disableSourceForSite,
  enableSourceForSite,
  updateSourceFrequency,
} from "@/lib/carbon/source-config-service";

/**
 * Phase 2A: one server action behind every control on /sources. Simple
 * form posts, no optimistic client state — the saved configuration is
 * whatever the server round-trip returns, so the screen can never show a
 * reporting expectation the database does not hold.
 *
 * Every rejection the server makes deliberately (missing permission,
 * foreign/out-of-scope site, a source that is not configured yet) comes
 * back as a named `?error=` code the page renders as a real message.
 * Anything else is rethrown to the route error boundary rather than being
 * swallowed into a quiet "nothing here" state.
 */
const schema = z.object({
  intent: z.enum(["enable", "disable", "frequency"]),
  siteId: z.string().min(1),
  activityDataPointId: z.string().min(1),
  frequency: z.nativeEnum(CarbonSourceFrequency).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  scope: z.string().optional(),
  show: z.string().optional(),
});

export type SourceConfigErrorCode = "denied" | "scope" | "invalid" | "not_configured";

function backTo(fields: { siteId: string; from?: string; to?: string; scope?: string; show?: string }, error?: SourceConfigErrorCode): string {
  const params = new URLSearchParams({ siteId: fields.siteId });
  if (fields.from) params.set("from", fields.from);
  if (fields.to) params.set("to", fields.to);
  if (fields.scope) params.set("scope", fields.scope);
  if (fields.show) params.set("show", fields.show);
  if (error) params.set("error", error);
  return `/sources?${params.toString()}`;
}

export async function configureSourceAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/sources?error=invalid");
  const input = parsed.data;

  let error: SourceConfigErrorCode | undefined;
  try {
    const context = await requireOrganisationContext();

    if (input.intent === "disable") {
      await disableSourceForSite(context, input);
    } else if (!input.frequency) {
      error = "invalid";
    } else if (input.intent === "enable") {
      await enableSourceForSite(context, { ...input, frequency: input.frequency });
    } else {
      await updateSourceFrequency(context, { ...input, frequency: input.frequency });
    }
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) error = err.reason === "MISSING_PERMISSION" ? "denied" : "scope";
    else if (err instanceof TenantOwnershipError) error = "scope";
    else if (err instanceof SourceConfigError) error = "not_configured";
    else throw err;
  }

  if (!error) revalidatePath("/sources");
  redirect(backTo(input, error));
}
