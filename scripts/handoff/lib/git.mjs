/**
 * Thin wrappers around the git CLI. All handoff file selection is derived
 * from git's own view of the repository (tracked files, status, diff) rather
 * than a hand-rolled directory walk, so `.gitignore` and the real state of
 * the working tree are always respected automatically.
 */
import { execFileSync } from "node:child_process";

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 64,
    ...options,
  });
}

export function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

export function currentBranch() {
  try {
    return git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {
    return "(detached)";
  }
}

export function headSha() {
  try {
    return git(["rev-parse", "HEAD"]).trim();
  } catch {
    return "(no commits)";
  }
}

export function isDirty() {
  return git(["status", "--porcelain"]).trim().length > 0;
}

export function statusPorcelain() {
  return git(["status", "--porcelain=v1", "--untracked-files=all"]);
}

export function fullStatusText() {
  return git(["status"]);
}

export function trackedFiles() {
  return git(["ls-files"]).split("\n").filter(Boolean);
}

/** Untracked files that git itself does not already ignore. */
export function untrackedFiles() {
  return git(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
}

/**
 * Resolves a sensible base ref to diff against for a review handoff:
 * an explicit ref if given, else the merge-base with the repo's default
 * remote branch, else HEAD (meaning "only show uncommitted changes").
 */
export function resolveBaseRef(explicitRef) {
  if (explicitRef) {
    git(["rev-parse", "--verify", explicitRef]);
    return explicitRef;
  }
  for (const candidate of ["origin/main", "origin/master"]) {
    try {
      git(["rev-parse", "--verify", candidate]);
      return git(["merge-base", "HEAD", candidate]).trim();
    } catch {
      // candidate branch doesn't exist locally; try the next one
    }
  }
  return "HEAD";
}

/** Name-status of tracked changes between a base ref and the working tree. */
export function diffNameStatus(baseRef) {
  const output = git(["diff", "--name-status", baseRef, "--"]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status, path: rest[rest.length - 1] };
    });
}

export function diffPatch(baseRef) {
  return git(["diff", baseRef, "--"]);
}
