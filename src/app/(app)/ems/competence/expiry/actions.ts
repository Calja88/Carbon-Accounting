"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { checkCompetenceExpiry } from "@/lib/ems/competence/expiry-service";

export interface ExpiryActionState {
  error: string | null;
  message: string | null;
}

const emptyState: ExpiryActionState = { error: null, message: null };

export async function runCompetenceExpiryCheckAction(
  _previous: ExpiryActionState,
  _formData: FormData,
): Promise<ExpiryActionState> {
  try {
    const context = await requireOrganisationContext();
    const expiredIds = await checkCompetenceExpiry(context, context.userId);
    revalidatePath("/ems/competence/expiry");
    revalidatePath("/ems/competence/gaps");
    revalidatePath("/ems/competence/assignments");
    return { ...emptyState, message: expiredIds.length === 0 ? "No newly expired competence found." : `${expiredIds.length} assignment(s) marked expired.` };
  } catch (error) {
    if (error instanceof OrganisationAccessError) return { ...emptyState, error: "You must be signed in." };
    if (error instanceof PermissionDeniedError) return { ...emptyState, error: "You don't have permission to do that." };
    throw error;
  }
}
