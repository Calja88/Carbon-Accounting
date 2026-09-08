/**
 * Phase 1 tenancy (T19) — stubbed invitation-token lifecycle.
 *
 * "Stubbed" per the task packet: no email is ever sent. Issuing or
 * resending an invitation mints a token, returns it once in plaintext so
 * the admin UI can show a copyable accept link, and persists only its
 * SHA-256 hash plus an expiry. Accepting an invitation looks the token up
 * by hash, never by the plaintext value, and never logs or stores the
 * plaintext anywhere.
 *
 * This module only knows about tokens. Membership creation/state changes
 * live in the admin actions that call it, so token generation stays testable
 * without a database.
 */

import { randomBytes, createHash, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface IssuedInvitationToken {
  /** Shown once to the inviting admin; never persisted. */
  token: string;
  /** Persisted in place of the token. */
  tokenHash: string;
  expiresAt: Date;
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mints a fresh invitation token (used both for a new invite and for "resend"). */
export function issueInvitationToken(now: Date = new Date()): IssuedInvitationToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
  };
}

export function isInvitationTokenExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Constant-time comparison of a hash the caller derived from a
 * caller-supplied token against the persisted hash, so a mistaken switch to
 * plain `===` down the line can't reintroduce a timing side-channel.
 */
export function invitationTokenHashMatches(candidateHash: string, storedHash: string): boolean {
  const a = Buffer.from(candidateHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type InvitationValidationError =
  | "NOT_FOUND"
  | "EXPIRED"
  | "NOT_INVITED";

export class InvitationTokenError extends Error {
  readonly reason: InvitationValidationError;

  constructor(reason: InvitationValidationError) {
    super(`Invitation token invalid: ${reason}`);
    this.name = "InvitationTokenError";
    this.reason = reason;
  }
}

export interface InvitationCandidate {
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  inviteTokenHash: string | null;
  inviteTokenExpiresAt: Date | null;
}

/**
 * Validates a plaintext token against the membership row it was looked up
 * against (by hash, at the call site). Throws the same error family
 * whether the row is missing, expired, already accepted, or in a state
 * that no longer accepts invitations — callers should not distinguish
 * "wrong token" from "already used" in what they show the visitor.
 */
export function assertInvitationAcceptable(
  candidate: InvitationCandidate | null,
  token: string,
  now: Date = new Date(),
): void {
  if (!candidate || !candidate.inviteTokenHash) {
    throw new InvitationTokenError("NOT_FOUND");
  }
  const candidateHash = hashInvitationToken(token);
  if (!invitationTokenHashMatches(candidateHash, candidate.inviteTokenHash)) {
    throw new InvitationTokenError("NOT_FOUND");
  }
  if (candidate.status !== "INVITED") {
    throw new InvitationTokenError("NOT_INVITED");
  }
  if (isInvitationTokenExpired(candidate.inviteTokenExpiresAt, now)) {
    throw new InvitationTokenError("EXPIRED");
  }
}
