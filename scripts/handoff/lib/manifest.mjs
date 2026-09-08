import { EXCLUSION_SUMMARY } from "./exclude.mjs";

/**
 * Builds MANIFEST.md content. Deliberately only claims what the mechanism
 * here actually checked, not blanket "this is safe" assurance.
 */
export function buildManifest({
  type,
  taskId,
  timestampUtc,
  branch,
  headSha,
  dirty,
  includedFiles,
  extraExclusionNotes = [],
}) {
  const lines = [
    `# AI Handoff Manifest`,
    ``,
    `- Handoff type: ${type}`,
    ...(taskId ? [`- Task ID: ${taskId}`] : []),
    `- Generated (UTC): ${timestampUtc}`,
    `- Branch: ${branch}`,
    `- HEAD commit: ${headSha}`,
    `- Working tree at generation time: ${dirty ? "dirty (uncommitted changes present)" : "clean"}`,
    `- File count: ${includedFiles.length}`,
    ``,
    `## Included files`,
    ``,
    ...includedFiles.map((f) => `- ${f}`),
    ``,
    `## Explicit security exclusions applied`,
    ``,
    ...EXCLUSION_SUMMARY.map((e) => `- ${e}`),
    ...extraExclusionNotes.map((e) => `- ${e}`),
    ``,
    `## Secret scan`,
    ``,
    `Every included text file was scanned for likely credentials (connection strings, API keys, ` +
      `tokens, private keys, generic secret assignments) before this bundle was written. No matches ` +
      `were found — generation would have aborted otherwise. This is a pattern-based defensive check, ` +
      `not a formal security guarantee; it can miss secrets that don't match a known shape.`,
    ``,
    `## Database data statement`,
    ``,
    `This package was generated entirely from the local git working tree and repository history. No ` +
      `live database (Neon or otherwise) was queried, and no database export, dump, or record data was ` +
      `intentionally included.`,
    ``,
  ];
  return lines.join("\n");
}
