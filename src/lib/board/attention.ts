import type { ActionState, AttentionItem, RecordRef } from "./contracts";
import { isOverdue } from "./metrics";

/** Input must already be authorized for tenant, site, classification AND source resource. */
export interface AuthorizedAction {
  id: string; canonicalActionId: string | null; title: string; state: ActionState;
  requiresVerification: boolean; dueDate: string | null; owner: string; site: string;
  source: RecordRef; blocker: string | null;
}
const OPEN = new Set<ActionState>(["OPEN", "IN_PROGRESS", "BLOCKED", "REOPENED"]);
export function actionCounts(rows: AuthorizedAction[]) {
  const unique = dedupeActions(rows);
  return { open: unique.filter(x => OPEN.has(x.state)).length,
    awaitingVerification: unique.filter(x => x.state === "COMPLETED" && x.requiresVerification).length };
}
/** Adapter must resolve CAPA + ActionItem state consistently; disagreement is surfaced, never silently counted twice. */
export function dedupeActions(rows: AuthorizedAction[]): AuthorizedAction[] {
  const map = new Map<string, AuthorizedAction>();
  for (const row of rows) {
    const key = row.canonicalActionId ?? `${row.source.kind}:${row.id}`;
    const previous = map.get(key);
    if (previous && (previous.state !== row.state || previous.dueDate !== row.dueDate || previous.requiresVerification !== row.requiresVerification)) throw new Error("Conflicting canonical action projection");
    if (!previous) map.set(key, row);
  }
  return [...map.values()];
}
export function actionAttention(rows: AuthorizedAction[], asOfDate: string): AttentionItem[] {
  return dedupeActions(rows).flatMap(row => {
    if (row.state === "VERIFIED" || row.state === "CANCELLED" || (row.state === "COMPLETED" && !row.requiresVerification)) return [];
    const reason = row.state === "COMPLETED" ? "verification" : row.blocker || row.state === "BLOCKED" ? "blocked" : isOverdue(row.dueDate, asOfDate) ? "overdue" : "upcoming";
    return [{ key: `action:${row.canonicalActionId ?? row.id}`, source: row.source, title: row.title,
      implication: reason === "verification" ? "Completion is recorded; independent verification remains due." : row.blocker ?? "Open work needs an owner update and evidence of completion.",
      reason, owner: row.owner, site: row.site, dueDate: row.dueDate,
      nextAction: reason === "verification" ? "Review completion" : "Open action",
      priority: reason === "blocked" ? 0 : reason === "overdue" ? 1 : reason === "verification" ? 2 : 4 }];
  });
}
export function mergeAttention(groups: AttentionItem[][]): AttentionItem[] {
  const unique = new Map<string, AttentionItem>();
  for (const item of groups.flat()) {
    const prior = unique.get(item.key);
    if (prior && (prior.source.revision !== item.source.revision || prior.reason !== item.reason)) throw new Error("Inconsistent attention snapshot");
    if (!prior) unique.set(item.key, item);
  }
  return [...unique.values()].sort((a, b) => a.priority - b.priority || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.key.localeCompare(b.key));
}
