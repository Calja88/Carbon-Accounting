"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import { PermissionDeniedError } from "@/lib/rbac/authorize";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";
import {
  PersonProfileError,
  createPersonProfile,
  updatePersonProfile,
  setPersonSensitiveProfile,
  deactivatePersonProfile,
  reactivatePersonProfile,
} from "@/lib/ems/competence/person-service";
import {
  createPersonProfileFormSchema,
  updatePersonProfileFormSchema,
  setPersonSensitiveProfileFormSchema,
} from "@/lib/ems/competence/person-schemas";

export interface PersonActionState {
  error: string | null;
  message: string | null;
}

const emptyState: PersonActionState = { error: null, message: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof PermissionDeniedError) return "You don't have permission to do that.";
  if (error instanceof TenantOwnershipError) return "That record could not be found in this organisation or scope.";
  if (error instanceof PersonProfileError) return error.message;
  throw error;
}

function revalidatePeople(personId?: string) {
  revalidatePath("/ems/competence/people");
  if (personId) revalidatePath(`/ems/competence/people/${personId}`);
}

export async function createPersonProfileAction(_previous: PersonActionState, formData: FormData): Promise<PersonActionState> {
  try {
    const context = await requireOrganisationContext();
    const parsed = createPersonProfileFormSchema.safeParse({
      personType: formData.get("personType"),
      displayName: formData.get("displayName"),
      membershipId: formData.get("membershipId"),
      entityId: formData.get("entityId"),
      siteId: formData.get("siteId"),
      contactEmail: formData.get("contactEmail"),
      contactPhone: formData.get("contactPhone"),
      notes: formData.get("notes"),
    });
    if (!parsed.success) return { ...emptyState, error: parsed.error.issues[0]?.message ?? "Check the person details." };
    const hasSensitive = Boolean(parsed.data.contactEmail || parsed.data.contactPhone || parsed.data.notes);
    await createPersonProfile(context, {
      personType: parsed.data.personType,
      displayName: parsed.data.displayName || null,
      membershipId: parsed.data.membershipId || null,
      entityId: parsed.data.entityId || null,
      siteId: parsed.data.siteId || null,
      sensitive: hasSensitive
        ? { contactEmail: parsed.data.contactEmail || null, contactPhone: parsed.data.contactPhone || null, notes: parsed.data.notes || null }
        : null,
      actorUserId: context.userId,
    });
    revalidatePeople();
    return { ...emptyState, message: "Person profile created." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function updatePersonProfileAction(_previous: PersonActionState, formData: FormData): Promise<PersonActionState> {
  try {
    const context = await requireOrganisationContext();
    const personId = String(formData.get("personId") ?? "");
    const parsed = updatePersonProfileFormSchema.safeParse({
      displayName: formData.get("displayName"),
      entityId: formData.get("entityId"),
      siteId: formData.get("siteId"),
    });
    if (!personId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a person." : parsed.error.issues[0]?.message ?? "Check the person details." };
    }
    await updatePersonProfile(context, personId, {
      displayName: parsed.data.displayName || null,
      entityId: parsed.data.entityId || null,
      siteId: parsed.data.siteId || null,
      actorUserId: context.userId,
    });
    revalidatePeople(personId);
    return { ...emptyState, message: "Person profile updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function setPersonSensitiveProfileAction(_previous: PersonActionState, formData: FormData): Promise<PersonActionState> {
  try {
    const context = await requireOrganisationContext();
    const personId = String(formData.get("personId") ?? "");
    const parsed = setPersonSensitiveProfileFormSchema.safeParse({
      contactEmail: formData.get("contactEmail"),
      contactPhone: formData.get("contactPhone"),
      notes: formData.get("notes"),
    });
    if (!personId || !parsed.success) {
      return { ...emptyState, error: parsed.success ? "Choose a person." : parsed.error.issues[0]?.message ?? "Check the contact details." };
    }
    await setPersonSensitiveProfile(context, personId, {
      contactEmail: parsed.data.contactEmail || null,
      contactPhone: parsed.data.contactPhone || null,
      notes: parsed.data.notes || null,
      actorUserId: context.userId,
    });
    revalidatePeople(personId);
    return { ...emptyState, message: "Restricted contact detail updated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function deactivatePersonProfileAction(_previous: PersonActionState, formData: FormData): Promise<PersonActionState> {
  try {
    const context = await requireOrganisationContext();
    const personId = String(formData.get("personId") ?? "");
    if (!personId) return { ...emptyState, error: "Choose a person." };
    await deactivatePersonProfile(context, personId, context.userId);
    revalidatePeople(personId);
    return { ...emptyState, message: "Person profile deactivated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}

export async function reactivatePersonProfileAction(_previous: PersonActionState, formData: FormData): Promise<PersonActionState> {
  try {
    const context = await requireOrganisationContext();
    const personId = String(formData.get("personId") ?? "");
    if (!personId) return { ...emptyState, error: "Choose a person." };
    await reactivatePersonProfile(context, personId, context.userId);
    revalidatePeople(personId);
    return { ...emptyState, message: "Person profile reactivated." };
  } catch (error) {
    return { ...emptyState, error: friendlyError(error) };
  }
}
