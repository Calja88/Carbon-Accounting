import { execFileSync } from "node:child_process";

// Vercel: exit 0 cancels a build; exit 1 deliberately permits it.
let message = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
if (!message) {
  try { message = execFileSync("git", ["log", "-1", "--format=%B"], { encoding: "utf8" }); } catch { /* Missing Git metadata keeps builds disabled. */ }
}
const deploy = process.env.BOARD_DEMO_FORCE_DEPLOY === "1" || message.includes("[vercel deploy]");
console.log(deploy ? "Deliberate deployment enabled." : "Routine commit: Vercel build skipped; GitHub CI remains enabled.");
process.exit(deploy ? 1 : 0);
