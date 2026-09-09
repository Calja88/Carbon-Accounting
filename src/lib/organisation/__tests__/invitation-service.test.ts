import { describe, expect, it } from "vitest";
import {
  assertInvitationAcceptable,
  hashInvitationToken,
  InvitationTokenError,
  invitationTokenHashMatches,
  isInvitationTokenExpired,
  issueInvitationToken,
} from "@/lib/organisation/invitation-service";

describe("invitation token lifecycle", () => {
  it("mints a token whose hash matches hashInvitationToken", () => {
    const issued = issueInvitationToken(new Date("2026-01-01T00:00:00Z"));
    expect(issued.tokenHash).toBe(hashInvitationToken(issued.token));
    expect(issued.token.length).toBeGreaterThan(20);
  });

  it("expires seven days after issue, not before or after", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = issueInvitationToken(now);
    expect(isInvitationTokenExpired(issued.expiresAt, new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000))).toBe(false);
    expect(isInvitationTokenExpired(issued.expiresAt, new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000))).toBe(true);
  });

  it("treats a null expiry as already expired", () => {
    expect(isInvitationTokenExpired(null)).toBe(true);
  });

  it("matches identical hashes and rejects different ones, including different-length input", () => {
    const a = hashInvitationToken("token-a");
    const b = hashInvitationToken("token-b");
    expect(invitationTokenHashMatches(a, a)).toBe(true);
    expect(invitationTokenHashMatches(a, b)).toBe(false);
    expect(invitationTokenHashMatches("ab", a)).toBe(false);
  });

  describe("assertInvitationAcceptable", () => {
    it("passes for a matching, unexpired, INVITED candidate", () => {
      const issued = issueInvitationToken(new Date("2026-01-01T00:00:00Z"));
      const candidate = { status: "INVITED" as const, inviteTokenHash: issued.tokenHash, inviteTokenExpiresAt: issued.expiresAt };
      expect(() => assertInvitationAcceptable(candidate, issued.token, new Date("2026-01-02T00:00:00Z"))).not.toThrow();
    });

    it("rejects a missing candidate", () => {
      expect(() => assertInvitationAcceptable(null, "whatever-token")).toThrow(InvitationTokenError);
    });

    it("rejects the wrong token even against a real candidate", () => {
      const issued = issueInvitationToken();
      const candidate = { status: "INVITED" as const, inviteTokenHash: issued.tokenHash, inviteTokenExpiresAt: issued.expiresAt };
      expect(() => assertInvitationAcceptable(candidate, "not-the-real-token")).toThrow(InvitationTokenError);
    });

    it("rejects an already-accepted (ACTIVE) membership", () => {
      const issued = issueInvitationToken();
      const candidate = { status: "ACTIVE" as const, inviteTokenHash: issued.tokenHash, inviteTokenExpiresAt: issued.expiresAt };
      expect(() => assertInvitationAcceptable(candidate, issued.token)).toThrow(InvitationTokenError);
    });

    it("rejects an expired token", () => {
      const issued = issueInvitationToken(new Date("2026-01-01T00:00:00Z"));
      const candidate = { status: "INVITED" as const, inviteTokenHash: issued.tokenHash, inviteTokenExpiresAt: issued.expiresAt };
      expect(() => assertInvitationAcceptable(candidate, issued.token, new Date("2026-02-01T00:00:00Z"))).toThrow(
        InvitationTokenError,
      );
    });
  });
});
