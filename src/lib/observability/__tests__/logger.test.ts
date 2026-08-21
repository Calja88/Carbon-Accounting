/**
 * T83 structured logger tests (Docs/PHASE8_HARDENING_READINESS_SPEC.md §6,
 * §11 "Logs/telemetry pass secret and representative sensitive-data
 * scanning").
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, redact } from "@/lib/observability/logger";

describe("redact", () => {
  it("replaces sensitive field values regardless of nesting", () => {
    const input = {
      user: "alice",
      password: "hunter2",
      nested: { token: "abc123", ok: "fine" },
      list: [{ secret: "shh" }, { fine: "yes" }],
    };
    const result = redact(input) as Record<string, unknown>;
    expect(result.password).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect((result.nested as Record<string, unknown>).ok).toBe("fine");
    expect(((result.list as unknown[])[0] as Record<string, unknown>).secret).toBe("[REDACTED]");
    expect(result.user).toBe("alice");
  });

  it("redacts environmental values by field name", () => {
    const result = redact({ quantity: 42.5, emissionValue: 100 }) as Record<string, unknown>;
    expect(result.quantity).toBe("[REDACTED]");
    expect(result.emissionValue).toBe("[REDACTED]");
  });

  it("leaves non-object values untouched", () => {
    expect(redact("plain string")).toBe("plain string");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});

describe("logEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a structured entry with timestamp, level and message", () => {
    const entry = logEvent({ level: "info", message: "job completed", correlationId: "corr-1", organisationId: "org-1" });
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("job completed");
    expect(entry.correlationId).toBe("corr-1");
    expect(entry.organisationId).toBe("org-1");
    expect(typeof entry.timestamp).toBe("string");
  });

  it("redacts sensitive fields before writing to the sink", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logEvent({ level: "info", message: "login", fields: { token: "abc123" } });
    expect(spy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(spy.mock.calls[0][0] as string);
    expect(written.token).toBe("[REDACTED]");
  });

  it("omits organisationId when not provided", () => {
    const entry = logEvent({ level: "warn", message: "platform event" });
    expect("organisationId" in entry).toBe(false);
  });
});
