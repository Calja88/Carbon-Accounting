/**
 * Email delivery adapter interface (task T24 scope: "add a delivery adapter
 * for email later, but do not implement real email sending now").
 *
 * `NoopEmailDeliveryAdapter` is the only implementation shipped in T24. It
 * never contacts a mail provider, never reads secrets, and exists purely so
 * a later task can add a real adapter behind this same interface without
 * touching `notification-service.ts` call sites.
 */

export interface EmailDeliveryRequest {
  notificationId: string;
  recipientMembershipId: string;
  title: string;
  body: string;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  reason: string;
}

export interface EmailDeliveryAdapter {
  send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult>;
}

/** Always reports "not sent" — no network call, no provider configuration read. */
export class NoopEmailDeliveryAdapter implements EmailDeliveryAdapter {
  async send(): Promise<EmailDeliveryResult> {
    return { delivered: false, reason: "Email delivery is not implemented yet (T24 in-app only)." };
  }
}

export const emailDeliveryAdapter: EmailDeliveryAdapter = new NoopEmailDeliveryAdapter();
