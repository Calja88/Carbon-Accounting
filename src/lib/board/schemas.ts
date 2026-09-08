import { z } from "zod";
import { dateOnly } from "./metrics";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const boardPeriodSchema = z.object({ from: month, to: month, siteId: z.string().max(128).optional() }).strict().superRefine((value, ctx) => {
  if (value.from > value.to) ctx.addIssue({ code: "custom", message: "End month must follow start month", path: ["to"] });
  const index = (v: string) => Number(v.slice(0, 4)) * 12 + Number(v.slice(5));
  if (index(value.to) - index(value.from) > 23) ctx.addIssue({ code: "custom", message: "Select no more than 24 months", path: ["to"] });
});
export const boardTransitionSchema = z.object({
  recordId: z.string().min(1).max(128), expectedRevision: z.string().min(1).max(128),
  decision: z.enum(["request-review", "complete", "effective", "partially-effective", "ineffective", "close"]),
  rationale: z.string().trim().min(10).max(4000), evidenceIds: z.array(z.string().min(1).max(128)).max(20),
  effectiveDate: z.string().refine(v => { try { dateOnly(v); return true; } catch { return false; } }, "Expected a valid date"),
}).strict(); // No actor, tenant, permission or fourEyes field accepted from the browser.
