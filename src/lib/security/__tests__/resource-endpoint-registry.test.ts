/**
 * CI gate for the T80 resource/endpoint registry
 * (Docs/PHASE8_HARDENING_READINESS_SPEC.md §3: "Build a machine-readable
 * resource/endpoint registry so adding a new customer-owned route without
 * an isolation test fails CI").
 *
 * Two independent failure modes, both caught here:
 *
 *  1. A new `findTenant*`/`require*InScope`/`getAuditEvent`/
 *     `findActiveTenantMembership` export appears in one of the six tenant
 *     repository modules but nobody added it to
 *     `RESOURCE_ENDPOINT_REGISTRY` — the registry silently stops being
 *     "every customer-owned resource root".
 *  2. A registry entry's function name never actually appears as a call in
 *     its declared `testFile` — the registry claims coverage that doesn't
 *     exist.
 *
 * This is a structural/text check, not a live-database test, matching the
 * repository's existing convention for static guardrail checks (Phase 0
 * spec §T03's unscoped-Prisma allowlist).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESOURCE_ENDPOINT_REGISTRY,
  REGISTRY_SOURCE_MODULES,
  assertRegistryKeysUnique,
  type ResourceEndpointEntry,
} from "@/lib/security/resource-endpoint-registry";

const ROOT = join(__dirname, "..", "..", "..", "..");

/**
 * Accessor export names that are NOT customer-owned resource roots and must
 * never be treated as registry gaps: context/derivation helpers, filter
 * builders, and mutability guards that take a already-loaded record rather
 * than resolving one by id.
 */
const NON_RESOURCE_EXPORTS = new Set([
  "toTenantRepositoryContext",
  "systemTenantRepositoryContext",
  "tenantWhere",
  "assertSiteOwnership",
  "accessibleSiteFilter",
  "accessibleActivityEntryFilter",
  "accessibleEntityFilter",
  "accessibleAssessmentFilter",
  "accessibleProductFilter",
  "accessibleSupplierFilter",
  "assertMethodologyProfileMutable",
  "findVisibleMethodologyProfile",
  "findProcessProfileTemplate",
  "recordAuditEvent",
  "recordAuditEvents",
  "listAuditEvents",
]);

/** Exported `export async function <name>(` / `export function <name>(` declarations in a module's source text. */
function exportedFunctionNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function isResourceAccessorName(name: string): boolean {
  if (NON_RESOURCE_EXPORTS.has(name)) return false;
  return (
    name.startsWith("findTenant") ||
    name.startsWith("requireTenant") ||
    name === "requireEntityInScope" ||
    name === "requireSiteInScope" ||
    name === "requireAssessmentInScope" ||
    name === "requireProductInScope" ||
    name === "requireSupplierInScope" ||
    name === "getAuditEvent" ||
    name === "findActiveTenantMembership"
  );
}

describe("resource-endpoint-registry: registry hygiene", () => {
  it("has no duplicate keys", () => {
    expect(() => assertRegistryKeysUnique()).not.toThrow();
  });

  it("is non-empty", () => {
    expect(RESOURCE_ENDPOINT_REGISTRY.length).toBeGreaterThan(50);
  });
});

describe.each(Object.entries(REGISTRY_SOURCE_MODULES))(
  "resource-endpoint-registry: %s completeness",
  (moduleKey, relativePath) => {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    const exported = exportedFunctionNames(source).filter(isResourceAccessorName);
    const registeredForModule = new Set(
      RESOURCE_ENDPOINT_REGISTRY.filter((entry) => entry.module === moduleKey && entry.contextShape !== "service").map(
        (entry) => entry.fn,
      ),
    );

    it("has at least one resource accessor export to register", () => {
      expect(exported.length).toBeGreaterThan(0);
    });

    it.each(exported)("registers %s in RESOURCE_ENDPOINT_REGISTRY", (fn) => {
      expect(
        registeredForModule.has(fn),
        `${moduleKey}.${fn} is exported but missing from RESOURCE_ENDPOINT_REGISTRY. ` +
          `Every customer-owned resource accessor must be registered so it gets an isolation test (T80).`,
      ).toBe(true);
    });

    it("never registers a function this module does not actually export", () => {
      const exportedSet = new Set(exported);
      for (const fn of registeredForModule) {
        expect(exportedSet.has(fn), `RESOURCE_ENDPOINT_REGISTRY names ${moduleKey}.${fn}, but that export does not exist.`).toBe(
          true,
        );
      }
    });
  },
);

describe("resource-endpoint-registry: every entry is actually tested", () => {
  const testFileCache = new Map<string, string>();
  function readTestFile(path: string): string {
    const cached = testFileCache.get(path);
    if (cached !== undefined) return cached;
    const content = readFileSync(join(ROOT, path), "utf8");
    testFileCache.set(path, content);
    return content;
  }

  it.each(RESOURCE_ENDPOINT_REGISTRY)("$key ($fn) is referenced by its declared test file", (entry: ResourceEndpointEntry) => {
    const content = readTestFile(entry.testFile);
    const calledName = entry.fn.includes(":") ? entry.fn.split(":")[1] : entry.fn;
    // Loose on purpose: a direct call (`findTenantX(`), a property-access
    // call (`ems.findTenantX(`), and a table-driven reference (the name as a
    // string literal, e.g. `fn: "findTenantX"`) are all legitimate ways this
    // repository's tests exercise a resource accessor. What this check
    // actually guards against is the function's name never appearing in the
    // file at all — i.e. nobody wrote it a test.
    const isReferenced = new RegExp(`\\b${calledName}\\b`).test(content);
    expect(
      isReferenced,
      `${entry.testFile} never references ${calledName} — ${entry.key} has no cross-tenant negative test (T80 requires one per customer-owned root).`,
    ).toBe(true);
  });
});
