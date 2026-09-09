/**
 * Phase 1 tenancy (T13) — the active-organisation selector cookie.
 *
 * Per PHASE1_TENANCY_RBAC_SPEC.md §7: "The selected organisation may be
 * stored in an HTTP-only signed cookie containing only an organisation
 * identifier. It is not authority." The signature only proves the value
 * wasn't tampered with in transit; every read still re-validates the value
 * against a real ACTIVE membership before it is trusted (see
 * `resolveOrganisationContext`).
 */

import { createHmac, timingSafeEqual } from "crypto";

export const ACTIVE_ORGANISATION_COOKIE = "paragon_active_org";

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) {
    throw new Error("NEXTAUTH_SECRET must be set to sign the organisation-selection cookie.");
  }
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Encodes an organisation id/slug as `value.signature` for the cookie. */
export function encodeOrganisationCookie(organisation: string): string {
  return `${organisation}.${sign(organisation)}`;
}

/**
 * Decodes and verifies a cookie value produced by `encodeOrganisationCookie`.
 * Returns `null` for missing, malformed, or tampered input — callers must
 * treat that identically to "no organisation requested", never as an error.
 */
export function decodeOrganisationCookie(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const separatorIndex = raw.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const value = raw.slice(0, separatorIndex);
  const signature = raw.slice(separatorIndex + 1);
  const expected = sign(value);

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (signatureBuf.length !== expectedBuf.length || !timingSafeEqual(signatureBuf, expectedBuf)) {
    return null;
  }
  return value;
}
