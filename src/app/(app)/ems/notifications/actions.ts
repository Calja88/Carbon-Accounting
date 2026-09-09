"use server";

import { revalidatePath } from "next/cache";
import { requireOrganisationContext, OrganisationAccessError } from "@/lib/organisation/session";
import {
  NotificationError,
  acknowledgeNotification,
  dismissNotification,
} from "@/lib/notifications/notification-service";
import { TenantOwnershipError } from "@/lib/repositories/tenant-scope";

export interface NotificationActionState {
  error: string | null;
}

const emptyState: NotificationActionState = { error: null };

function friendlyError(error: unknown): string {
  if (error instanceof OrganisationAccessError) return "You must be signed in.";
  if (error instanceof TenantOwnershipError) return "That notification could not be found in this organisation.";
  if (error instanceof NotificationError) return error.message;
  throw error;
}

export async function acknowledgeNotificationAction(
  _previous: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  try {
    const context = await requireOrganisationContext();
    const notificationId = String(formData.get("notificationId") ?? "");
    if (!notificationId) return { error: "Missing notification." };
    await acknowledgeNotification(context, notificationId);
    revalidatePath("/ems/notifications");
    return emptyState;
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function dismissNotificationAction(
  _previous: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  try {
    const context = await requireOrganisationContext();
    const notificationId = String(formData.get("notificationId") ?? "");
    if (!notificationId) return { error: "Missing notification." };
    await dismissNotification(context, notificationId);
    revalidatePath("/ems/notifications");
    return emptyState;
  } catch (error) {
    return { error: friendlyError(error) };
  }
}
