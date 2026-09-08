/**
 * Structured logger (task T83, Docs/PHASE8_HARDENING_READINESS_SPEC.md §6
 * "Observability": "structured logs with correlation/organisation-safe
 * identifiers and redaction" and "no environmental values, evidence text,
 * personal certificate data, tokens or prompts in logs").
 *
 * Deliberately a thin wrapper over `console`, not a logging library — this
 * repository has no existing logging dependency, and T83's job is
 * redaction/shape discipline, not picking a log shipper. A later task can
 * swap the sink without touching call sites, because every call site goes
 * through `logEvent`, never `console.*` directly.
 */

/** Field names whose *value* is always replaced with `"[REDACTED]"`, regardless of nesting depth. */
const REDACTED_FIELD_NAMES = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "inviteTokenHash".toLowerCase(),
  "secret",
  "apikey",
  "openrouterapikey",
  "authorization",
  "cookie",
  "prompt",
  "completion",
  "evidencetext",
  "value",
  "quantity",
  "emissionvalue",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively replaces any field whose key (case-insensitive) is in
 * `REDACTED_FIELD_NAMES` with `"[REDACTED]"`. Arrays are walked element by
 * element; everything else is returned unchanged. Depth-limited so a
 * pathological/circular payload cannot hang the logger.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    result[key] = REDACTED_FIELD_NAMES.has(key.toLowerCase()) ? "[REDACTED]" : redact(fieldValue, depth + 1);
  }
  return result;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEventInput {
  level: LogLevel;
  message: string;
  /** Ties this entry to a request/job run — never a raw session/auth token. */
  correlationId?: string;
  /** Present only when the event is tenant-scoped; never a browser-supplied value the caller hasn't already validated. */
  organisationId?: string | null;
  /** Any additional structured fields. Passed through `redact()` before writing. */
  fields?: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  organisationId?: string | null;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function minLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  return configured && configured in LEVEL_ORDER ? configured : "info";
}

const SINKS: Record<LogLevel, (entry: string) => void> = {
  debug: (entry) => console.debug(entry),
  info: (entry) => console.info(entry),
  warn: (entry) => console.warn(entry),
  error: (entry) => console.error(entry),
};

/** Builds and writes one structured, redacted JSON log line. Returns the entry (pre-serialisation) so tests/callers can assert on shape without parsing stdout. */
export function logEvent(input: LogEventInput): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level: input.level,
    message: input.message,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.organisationId !== undefined ? { organisationId: input.organisationId } : {}),
    ...((redact(input.fields ?? {}) as Record<string, unknown>) ?? {}),
  };

  if (LEVEL_ORDER[input.level] >= LEVEL_ORDER[minLevel()]) {
    SINKS[input.level](JSON.stringify(entry));
  }
  return entry;
}
