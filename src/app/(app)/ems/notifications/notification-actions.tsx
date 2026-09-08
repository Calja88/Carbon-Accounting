"use client";

import { useActionState } from "react";
import { acknowledgeNotificationAction, dismissNotificationAction, type NotificationActionState } from "./actions";

const emptyState: NotificationActionState = { error: null };

export function AcknowledgeButton({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState(acknowledgeNotificationAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Acknowledge
      </button>
      {state.error && (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function DismissButton({ notificationId }: { notificationId: string }) {
  const [state, formAction, pending] = useActionState(dismissNotificationAction, emptyState);
  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="notificationId" value={notificationId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Dismiss
      </button>
      {state.error && (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      )}
    </form>
  );
}
