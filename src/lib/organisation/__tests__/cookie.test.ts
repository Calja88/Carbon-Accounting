import { beforeAll, describe, expect, it } from "vitest";
import { decodeOrganisationCookie, encodeOrganisationCookie } from "@/lib/organisation/cookie";

describe("active-organisation cookie", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-value-not-a-real-credential";
  });

  it("round-trips an encoded value", () => {
    const encoded = encodeOrganisationCookie("org_aster");
    expect(decodeOrganisationCookie(encoded)).toBe("org_aster");
  });

  it("returns null for a missing cookie", () => {
    expect(decodeOrganisationCookie(undefined)).toBeNull();
    expect(decodeOrganisationCookie(null)).toBeNull();
    expect(decodeOrganisationCookie("")).toBeNull();
  });

  it("returns null for a malformed value with no signature", () => {
    expect(decodeOrganisationCookie("org_aster")).toBeNull();
  });

  it("rejects a tampered value (organisation id swapped, signature reused)", () => {
    const encoded = encodeOrganisationCookie("org_aster");
    const signature = encoded.slice(encoded.lastIndexOf("."));
    const tampered = `org_birch${signature}`;
    expect(decodeOrganisationCookie(tampered)).toBeNull();
  });

  it("rejects a value with a corrupted signature", () => {
    const encoded = encodeOrganisationCookie("org_aster");
    expect(decodeOrganisationCookie(`${encoded}x`)).toBeNull();
  });
});
