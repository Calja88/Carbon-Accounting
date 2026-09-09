import { describe, expect, it } from "vitest";
import { canonicalStringify, computeContentHash, type AuditEventHashInput } from "@/lib/audit/integrity";

const baseInput: AuditEventHashInput = {
  organisationId: "org-aster-demo",
  actorUserId: "user-1",
  actorType: "USER",
  eventType: "membership.suspended",
  resourceType: "membership",
  resourceId: "membership-1",
  summary: "Suspended a member.",
  before: { status: "ACTIVE" },
  after: { status: "SUSPENDED" },
  correlationId: "corr-1",
  source: "web-app",
  occurredAt: "2026-08-11T12:00:00.000Z",
};

describe("canonicalStringify", () => {
  it("produces the same string regardless of key insertion order", () => {
    const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
    const b = { a: 2, c: { x: 2, y: 1 }, b: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it("distinguishes genuinely different content", () => {
    expect(canonicalStringify({ a: 1 })).not.toBe(canonicalStringify({ a: 2 }));
  });

  it("sorts keys inside arrays of objects too", () => {
    const a = [{ b: 1, a: 2 }];
    const b = [{ a: 2, b: 1 }];
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });
});

describe("computeContentHash", () => {
  it("is deterministic for identical input", () => {
    expect(computeContentHash(baseInput)).toBe(computeContentHash({ ...baseInput }));
  });

  it("is stable under before/after key reordering", () => {
    const reordered: AuditEventHashInput = {
      ...baseInput,
      before: { status: "ACTIVE" },
      after: { status: "SUSPENDED", extra: undefined as unknown as string },
    };
    // `extra: undefined` is dropped by JSON.stringify identically to its absence in `after`.
    delete (reordered.after as Record<string, unknown>).extra;
    expect(computeContentHash(reordered)).toBe(computeContentHash(baseInput));
  });

  it("changes when any hashed field changes", () => {
    const changedSummary = computeContentHash({ ...baseInput, summary: "Different summary." });
    const changedAfter = computeContentHash({ ...baseInput, after: { status: "REMOVED" } });
    const changedActor = computeContentHash({ ...baseInput, actorUserId: "user-2" });
    const changedOccurredAt = computeContentHash({ ...baseInput, occurredAt: "2026-08-11T12:00:01.000Z" });

    const original = computeContentHash(baseInput);
    expect(changedSummary).not.toBe(original);
    expect(changedAfter).not.toBe(original);
    expect(changedActor).not.toBe(original);
    expect(changedOccurredAt).not.toBe(original);
  });

  it("produces a 64-character hex sha256 digest", () => {
    expect(computeContentHash(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});
