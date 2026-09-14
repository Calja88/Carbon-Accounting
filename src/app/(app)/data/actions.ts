"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import { resolveMonthRange } from "@/lib/report-period";
import {
  CollectionPlanError,
  excludeCollectionRequirement,
  generateCollectionPlan,
  reopenCollectionRequirement,
  reviewCollectionRequirement,
} from "@/lib/carbon/collection-plan-service";

/**
 * Phase 2B-ii: one server action behind every control on /data. Plain form
 * posts, no optimistic client state — what the screen shows after a round
 * trip is what the database actually holds, so the page can never display a
 * review or exclusion that did not happen.
 *
 * Deliberate rejections (missing permission, out-of-scope site, nothing to
 * review yet) come back as a named `?error=` code the page renders as a real
 * message. Anything else is rethrown to the route error boundary rather than
 * being swallowed into a quiet success.
 */
const scopeFields = {
  from: z.string().optional(),
  to: z.string().optional(),
  siteId: z.string().optional(),
  scope: z.string().optional(),
  status: z.string().optional(),
  cell: z.string().optional(),
};

const generateSchema = z.object({ ...scopeFields });
const decisionSchema = z.object({
  ...scopeFields,
  requirementId: z.string().min(1),
  intent: z.enum(["review", "exclude", "reopen"]),
  reason: z.string().optional(),
});

export type DataActionErrorCode = "denied" | "scope" | "invalid" | "rejected";

type ScopeValues = z.infer<typeof generateSchema>;

function backTo(fields: ScopeValues, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...fields, ...extra })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/data?${query}` : "/data";
}

export async function generateCollectionPlanAction(formData: FormData): Promise<void> {
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/data?error=invalid");
  const input = parsed.data;
  const range = resolveMonthRange(input.from, input.to);

  let error: DataActionErrorCode | undefined;
  let summary: string | undefined;
  try {
    const context = await requireOrganisationContext();
    const result = await generateCollectionPlan(context, {
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      siteId: input.siteId || undefined,
    });
    // Reported verbatim rather than as a generic "done": "0 new" is a real
    // and useful outcome, and so is a skipped ad-hoc source.
    summary = `${result.created}:${result.alreadyPresent}:${result.skippedAdHoc}`;
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) error = err.reason === "MISSING_PERMISSION" ? "denied" : "scope";
    else if (err instanceof TenantOwnershipError) error = "scope";
    else if (err instanceof CollectionPlanError) error = "rejected";
    else throw err;
  }

  if (!error) revalidatePath("/data");
  redirect(backTo(input, error ? { error } : summary ? { generated: summary } : {}));
}

export async function decideRequirementAction(formData: FormData): Promise<void> {
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/data?error=invalid");
  const { requirementId, intent, reason, ...scope } = parsed.data;

  let error: DataActionErrorCode | undefined;
  try {
    const context = await requireOrganisationContext();
    if (intent === "review") {
      await reviewCollectionRequirement(context, requirementId);
    } else if (intent === "reopen") {
      await reopenCollectionRequirement(context, requirementId);
    } else if (!reason?.trim()) {
      error = "invalid";
    } else {
      await excludeCollectionRequirement(context, requirementId, { reason });
    }
  } catch (err) {
    if (err instanceof OrganisationAccessError) redirect("/login");
    if (err instanceof PermissionDeniedError) error = err.reason === "MISSING_PERMISSION" ? "denied" : "scope";
    else if (err instanceof TenantOwnershipError) error = "scope";
    else if (err instanceof CollectionPlanError) error = "rejected";
    else throw err;
  }

  if (!error) revalidatePath("/data");
  redirect(backTo(scope, error ? { error } : {}));
}
