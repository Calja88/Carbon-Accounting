import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Best-effort extraction of a task's own section out of the repo's task
 * catalogue, so TASK.md doesn't start from nothing when the task is already
 * documented. Falls back to a stub the human/Claude can fill in.
 */
export function extractTaskSection(repoRoot, taskId) {
  const candidateFiles = ["Docs/CLAUDE_IMPLEMENTATION_TASKS.md", "Docs/CLAUDE_HANDOFF_INDEX.md"];

  for (const rel of candidateFiles) {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    const lines = text.split("\n");
    const headingRegex = /^#{1,4}\s/;
    const idRegex = new RegExp(`\\b${taskId}\\b`);

    const startIdx = lines.findIndex((line) => headingRegex.test(line) && idRegex.test(line));
    if (startIdx === -1) continue;

    const startLevel = lines[startIdx].match(/^#+/)[0].length;
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#+)\s/);
      if (m && m[1].length <= startLevel) {
        endIdx = i;
        break;
      }
    }
    return { source: rel, content: lines.slice(startIdx, endIdx).join("\n").trim() };
  }
  return null;
}

export function buildTaskMd(taskId, extracted) {
  if (extracted) {
    return [
      `# Task ${taskId}`,
      ``,
      `_Extracted from \`${extracted.source}\` in the repository. Verify it still matches what was_`,
      `_actually implemented before sending to Astra._`,
      ``,
      extracted.content,
      ``,
    ].join("\n");
  }
  return [
    `# Task ${taskId}`,
    ``,
    `No matching section was found in the repository's task documentation for "${taskId}".`,
    `Fill in manually:`,
    ``,
    `Objective:`,
    ``,
    `Scope:`,
    ``,
    `Out of scope:`,
    ``,
  ].join("\n");
}
