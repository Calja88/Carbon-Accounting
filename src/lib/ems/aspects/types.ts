/**
 * Process/activity profile shared types (task T30,
 * Docs/PHASE3_ASPECTS_OPERATIONS_SPEC.md §2). Re-exports the
 * Prisma-generated enums under this module's own path so callers never
 * import `@prisma/client` directly for these.
 */

export type { ProcessActivityType, EmsLifecycleStage, EmsOperatingCondition, ActivityProcessStatus } from "@prisma/client";
