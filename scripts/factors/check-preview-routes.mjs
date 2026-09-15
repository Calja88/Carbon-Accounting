/**
 * Unauthenticated route smoke check for a Preview deployment.
 *
 * It answers one narrow question: does each route respond, without a 5xx?
 * It does NOT prove the pages render — a Preview with Vercel deployment
 * protection redirects everything to the SSO gate before the app is reached,
 * so a 302 there says nothing about the app itself. Signed-in visual
 * verification is still a separate, manual step.
 *
 *   node scripts/factors/check-preview-routes.mjs <deployment-url>
 */

const ROUTES = ["/admin/factors/import", "/admin/factors", "/data", "/sources"];

const base = process.argv[2]?.replace(/\/$/, "");
if (!base) {
  console.error("Usage: node scripts/factors/check-preview-routes.mjs <deployment-url>");
  process.exit(2);
}

let failed = false;
let ssoGated = false;

for (const route of ROUTES) {
  const url = `${base}${route}`;
  let line;
  try {
    const res = await fetch(url, { redirect: "manual" });
    const target = res.headers.get("location") ?? "";
    if (target.includes("vercel.com/sso-api")) ssoGated = true;
    const bad = res.status >= 500;
    failed ||= bad;
    line = `${bad ? "FAIL" : "ok  "} ${res.status} ${route}${target ? ` -> ${new URL(target, base).pathname}` : ""}`;
  } catch (err) {
    failed = true;
    line = `FAIL  --- ${route} (${err instanceof Error ? err.message : "request failed"})`;
  }
  console.log(line);
}

if (ssoGated) {
  console.log("\nNote: redirects went to Vercel deployment protection, not the app's own login.");
  console.log("No 5xx at the edge is all this proves. Sign in to verify the pages actually render.");
}

process.exit(failed ? 1 : 0);
