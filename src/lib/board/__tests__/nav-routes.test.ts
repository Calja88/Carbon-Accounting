import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_NAV } from "../navigation";

/**
 * Phase 0 guardrail: every visible nav href must resolve to a real route on
 * this branch — no dead-end "coming soon" links (PHASE0 product reset,
 * item 4). Static hrefs only; a dynamic segment (`[id]`) in a future nav
 * item would need a different check.
 */
function pageFileFor(href: string): string {
  const segments = href.split("/").filter(Boolean);
  return join(process.cwd(), "src", "app", "(app)", ...segments, "page.tsx");
}

describe("BOARD_NAV routes", () => {
  it.each(BOARD_NAV.map((item) => [item.id, item.href] as const))(
    "%s (%s) resolves to an existing page.tsx",
    (_id, href) => {
      expect(existsSync(pageFileFor(href))).toBe(true);
    },
  );
});
