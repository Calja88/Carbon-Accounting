# Phase 1 File-by-File Refactor Map

**Repository assessed:** extracted archive under `working/Carbon-Accounting-claude-paragon-id-uk-carbon-mvp-1h1uvb`  
**Purpose:** stop each implementation session rediscovering where tenancy can leak. This map covers files with direct Prisma access plus exposed actions/routes. Re-run the static inventory after every packet because line numbers and imports will change.

## 1. New infrastructure files

Create these before domain refactors:

```text
src/lib/auth/organisation-context.ts
src/lib/auth/permissions.ts
src/lib/auth/permission-catalogue.ts
src/lib/auth/resource-scope.ts
src/lib/repositories/context.ts
src/lib/repositories/platform-reference-repository.ts
src/lib/repositories/organisation-repository.ts
src/lib/repositories/carbon-repository.ts
src/lib/repositories/lca-repository.ts
src/lib/repositories/document-repository.ts
src/lib/repositories/ai-repository.ts
src/lib/audit/audit-service.ts
src/lib/audit/audit-types.ts
src/lib/__tests__/tenant-fixtures.ts
src/lib/__tests__/tenant-isolation.test.ts
scripts/check-unscoped-prisma.mjs
scripts/backfill-organisation-tenancy.mjs
docs/architecture/adr-*.md
```

Exact splitting may follow existing style, but public domain methods must take organisation context first and routes/actions must not import Prisma directly after their batch is complete.

## 2. Authentication and application shell — Batch A

| File | Current issue | Required change | Critical tests |
|---|---|---|---|
| `src/auth.ts` | JWT carries one global `role` | JWT identifies user only; selected organisation is not authority; current permissions resolved from DB | Role revoked without re-login; suspended membership |
| `src/lib/admin.ts` | `ADMIN` means global admin | Replace with permission-specific organisation checks; platform operator, if ever needed, is separate | Org admin cannot access another org/platform controls |
| `src/lib/lca/permissions.ts` | Hard-coded global LCA roles | Delegate to permission service and organisation scope; preserve locked-status logic | LCA grants and current permission revocation |
| `src/app/(app)/layout.tsx` | Shows one global role; no org context | Resolve organisation context, render switcher, scope AI availability | Inaccessible selected org fallback/deny |
| `src/app/(app)/nav-links.tsx` | Admin nav from global boolean | Render from permission set; hiding is UX only | Direct route remains server-protected |
| `src/proxy.ts` | Authentication only | Keep authentication routing; do not put DB authorisation in proxy | Unauthenticated redirects; API auth remains public |
| `src/types/next-auth.d.ts` | Global role typing | Deprecate role claim; type user ID and non-authoritative session fields | Typecheck |

Do not add an organisation ID URL/query parameter that bypasses membership resolution. Prefer a signed HTTP-only selection cookie and server validation.

## 3. Corporate carbon services — Batch B

Refactor these service entry points before their pages/actions:

| File | Tenant-owned reads/writes | Required signature direction |
|---|---|---|
| `src/lib/analytics-service.ts` | Sites/calculations and period aggregates | `buildAnalyticsSnapshot(ctx, periodStart, periodEnd)` |
| `src/lib/data-quality.ts` | Sites, entries, contracts, data completeness | `scanDataQuality(ctx, ...)`; apply Entity/Site scopes to denominator and results |
| `src/lib/entry-status.ts` | Site entry/survey/contract status | `getSiteQuantityStatus(ctx, siteId)` and assert Site access |
| `src/lib/entries-service.ts` | Entries, calculations, surveys, contracts, recalculation/derivation | Context on every public function; background functions require explicit organisation or controlled platform fan-out |
| `src/lib/explain-calculation.ts` | Calculation detail | `explainCalculation(ctx, calculationId)` with tenant predicate in initial query |
| `src/lib/report-service.ts` | Entity/site/calculation/entry report payload | `buildReportPayload(ctx, period)`; reject mixed-tenant snapshot inputs |
| `src/lib/documents-service.ts` | Source documents, extractions, accepted entries | Context on upload/list/get/content/accept/reject; composite ownership checks |
| `src/lib/factor-sets-service.ts` | Imported factor sets | Split platform official factor administration from organisation-owned supplier/LCA factors |

Pure deterministic files such as `calc-engine.ts`, `commuting.ts`, `units.ts`, `plausibility.ts`, `csv.ts`, `expensein-import.ts`, and classification rules should not gain tenant knowledge.

## 4. Corporate pages and actions — Batch C

Remove direct Prisma imports and resolve context once per server boundary.

```text
src/app/(app)/page.tsx
src/app/(app)/entry/page.tsx
src/app/(app)/entry/[siteId]/page.tsx
src/app/(app)/entry/[siteId]/[code]/page.tsx
src/app/(app)/entry/[siteId]/[code]/actions.ts
src/app/(app)/entry/[siteId]/[code]/survey-actions.ts
src/app/(app)/entry/[siteId]/business-travel-import/page.tsx
src/app/(app)/entry/[siteId]/business-travel-import/actions.ts
src/app/(app)/entry/[siteId]/electricity-contract/page.tsx
src/app/(app)/entry/[siteId]/electricity-contract/actions.ts
src/app/(app)/calculations/[id]/page.tsx
src/app/(app)/calculations/[id]/actions.ts
src/app/(app)/reports/page.tsx
src/app/(app)/reports/actions.ts
src/app/(app)/reports/[id]/page.tsx
src/app/(app)/reports/[id]/calculations/page.tsx
src/app/(app)/documents/page.tsx
src/app/(app)/documents/[id]/page.tsx
src/app/(app)/documents/actions.ts
```

Boundary rule: each action resolves context, checks permission, parses/validates input, and calls a tenant-aware service. It does not perform a second parallel authorisation scheme.

## 5. Corporate exports/downloads — Batch D, highest IDOR priority

| File | Required protection |
|---|---|
| `src/app/(app)/reports/[id]/audit-trail.csv/route.ts` | Tenant-scoped snapshot lookup; ensure every linked calculation has same organisation; non-disclosing 404 |
| `src/app/api/documents/[id]/file/route.ts` | Tenant-scoped metadata lookup before bytes; permission/classification check; do not reveal foreign filename/MIME/size |
| `src/app/api/admin/factor-template.csv/route.ts` | Permission check; template may be global but admin identity is organisation-specific |

CSV/print/export tests must inspect content, not only status codes.

## 6. Product/LCA service layer — Batch E

| File | Tenant risk | Required change |
|---|---|---|
| `src/lib/lca/assessment-service.ts` | Lists and loads by IDs; version issue/revision | Context on list/get/create/clone/status/version/product functions; composite Entity/Product relationships |
| `src/lib/lca/model-service.ts` | Child IDs can be swapped across assessments | Context and ownership assertion on every process/output/item/leg/route operation |
| `src/lib/lca/calculation-service.ts` | Loads assessment/run/result directly | Context on DB orchestration; keep pure conversion/engine helpers tenant-free |
| `src/lib/lca/registers-service.ts` | Assumptions/exclusions/verification/corporate links | Context; corporate ActivityEntry and LCA item must share organisation |
| `src/lib/lca/evidence-service.ts` | Evidence and blob lookup by ID | Context on metadata/storage retrieval/deletion; no guessed-key access |
| `src/lib/lca/audit-service.ts` | Assessment-based events | Add organisation context/column without replacing LCA audit semantics |
| `src/lib/lca/report-service.ts` | Cross-assessment report queries | Context on every report query and scenario comparison |
| `src/lib/lca/readiness-service.ts` | Reads verification/assessment data | Context propagated from caller |
| `src/lib/lca/validation-service.ts` | DB wrapper loads related data | Keep pure validator tenant-free; `runValidation(ctx, assessmentId)` scoped |
| `src/lib/lca/factor-library.ts` | Global and tenant factor mixture | Explicit platform + selected organisation visibility resolver |
| `src/lib/lca/supplier-service.ts` | Supplier/PCF/items direct IDs | Context and composite supplier/entity/item checks |
| `src/lib/lca/import/inventory-import-service.ts` | Assessment, process, supplier, factors | Context; preview and commit use identical tenant-visible catalogue |

Do not add organisation parameters to the pure LCA engine, analysis, units, decimal helpers, PACT types/adapter, or deterministic validation functions.

## 7. Product/LCA actions and pages — Batch F

### Actions

```text
src/app/(app)/assessments/actions.ts
src/app/(app)/assessments/[id]/evidence/actions.ts
src/app/(app)/assessments/[id]/import/actions.ts
src/app/(app)/assessments/[id]/inventory/actions.ts
src/app/(app)/assessments/[id]/model/actions.ts
src/app/(app)/assessments/[id]/registers/actions.ts
src/app/(app)/assessments/[id]/review/actions.ts
src/app/(app)/methodologies/actions.ts
src/app/(app)/products/actions.ts
src/app/(app)/suppliers/actions.ts
```

### Pages/layouts with direct Prisma access

```text
src/app/(app)/assessments/page.tsx
src/app/(app)/assessments/[id]/layout.tsx
src/app/(app)/assessments/[id]/page.tsx
src/app/(app)/assessments/[id]/audit/page.tsx
src/app/(app)/assessments/[id]/evidence/page.tsx
src/app/(app)/assessments/[id]/goal-scope/page.tsx
src/app/(app)/assessments/[id]/import/page.tsx
src/app/(app)/assessments/[id]/inventory/page.tsx
src/app/(app)/assessments/[id]/inventory/[itemId]/page.tsx
src/app/(app)/assessments/[id]/model/page.tsx
src/app/(app)/assessments/[id]/registers/page.tsx
src/app/(app)/assessments/[id]/review/page.tsx
src/app/(app)/assessments/[id]/scenarios/page.tsx
src/app/(app)/assessments/[id]/versions/page.tsx
src/app/(app)/methodologies/page.tsx
src/app/(app)/products/page.tsx
src/app/(app)/products/[productId]/page.tsx
src/app/(app)/suppliers/page.tsx
```

Replace direct queries with tenant-aware service functions. A parent route `[id]` does not make child IDs safe: validate that `[itemId]`, result, version, evidence, process, and register IDs belong to the already-scoped assessment.

## 8. LCA exports/downloads — Batch G, highest IDOR priority

```text
src/app/api/lca/assessments/[id]/calculation-register.csv/route.ts
src/app/api/lca/assessments/[id]/export.json/route.ts
src/app/api/lca/assessments/[id]/pact.json/route.ts
src/app/api/lca/evidence/[id]/route.ts
src/app/api/lca/inventory-template.csv/route.ts
```

The inventory template can remain platform-global if it contains no tenant data. Every assessment/evidence export starts with context plus tenant predicate and validates nested run/version/result ownership.

## 9. AI layer — Batch H

| File | Current direct access | Required change |
|---|---|---|
| `src/lib/ai/authorization.ts` | Resolves user and broad sites; checks assessment/document | Build `AiActor` from OrganisationContext and current Entity/Site scope |
| `src/lib/ai/scope.ts` | In-memory Entity/Site checks | Include organisation ID; deny mismatched tenant before filter |
| `src/lib/ai/carbon-context.ts` | Factors and data-point/context queries | Context first; platform factors plus selected organisation only |
| `src/lib/ai/audit.ts` | Interactions and usage/pruning | Organisation-scoped usage; platform retention job fans out safely |
| `src/lib/ai/catalog-store.ts` | Singleton settings/catalogue | Separate platform model catalogue from organisation settings |
| `src/lib/ai/config.ts` | Singleton AI configuration | Resolve organisation overrides; environment API key stays server-global secret |
| `src/lib/ai/rate-limit.ts` | User-only counts | Adopt explicit user+organisation policy and scoped reporting |
| `src/lib/ai/services/classify.ts` | Data-point lookup | Platform reference is safe; accepted suggestion still tenant-scoped |
| `src/lib/ai/services/extract.ts` | Document/extraction updates | Assert document tenant before reading bytes and again before writes |
| `src/lib/ai/services/factor-suggest.ts` | Factor search | Platform factors plus current organisation-owned factors only |
| `src/app/(app)/admin/ai/actions.ts` | Global admin/singleton settings | `ai.settings.manage` for selected organisation; platform catalogue refresh separately privileged if exposed |
| `src/app/api/ai/chat/route.ts` | Assistant entry boundary | Resolve organisation context before assembling any context |
| `src/app/api/ai/status/route.ts` | Availability/config status | Return selected organisation availability without secret/config leakage |

Do not change prompt-injection fencing, schema validation, provider interface, or deterministic no-invention rules except to add Organisation context where needed.

## 10. Factor administration — Batch I

```text
src/app/(app)/admin/factors/actions.ts
src/app/(app)/admin/factors/page.tsx
src/app/(app)/admin/factors/upload/page.tsx
src/app/(app)/admin/factors/[id]/page.tsx
src/lib/factor-sets-service.ts
src/lib/lca/factor-library.ts
```

Make visibility explicit:

- official DEFRA/DESNZ and approved global reference sets: PLATFORM;
- supplier-specific and customer-created LCA sets: ORGANISATION;
- a tenant can view platform sets but cannot mutate them;
- organisation factor managers cannot see or mutate other tenants' sets;
- creation/import assigns owner from context, not form input;
- factor resolution never allows an organisation-owned set from another tenant.

If platform factor administration is needed, introduce a separate platform-operator control plane/permission rather than treating every Organisation Administrator as platform admin.

## 11. Search checklist for each completed batch

Run these conceptual checks after refactoring a batch:

1. No direct `prisma.` imports remain in completed route/action/page files.
2. Every public service reading customer records takes context first.
3. Every initial lookup combines record ID and organisation ID.
4. Every nested connect/update/delete validates parent organisation.
5. Every list/count/aggregate includes tenant and membership resource scope.
6. Every cache key includes organisation where data is tenant-specific.
7. Every revalidation path cannot reveal/update another tenant's route.
8. Every export/download has an adversarial foreign-ID test.
9. Every background/global function either accepts one organisation or uses an audited platform fan-out.
10. Pure calculation/validation code remains tenant-agnostic and unchanged.

## 12. Suggested PR boundaries

```text
PR-01  Schema expand + idempotent role templates
PR-02  Context/permission/repository primitives + tests
PR-03  Structural dry-run/apply backfill command
PR-04  Auth shell and organisation switcher
PR-05  Corporate services
PR-06  Corporate pages/actions
PR-07  Corporate exports/documents
PR-08  LCA services
PR-09  LCA pages/actions
PR-10  LCA exports/evidence
PR-11  AI scoping/settings
PR-12  Factor visibility/administration
PR-13  Membership/role administration UI
PR-14  Contract constraints and legacy-authorisation removal
PR-15  RLS spike (non-production vertical slice)
```

Each PR should shrink the temporary direct-Prisma allowlist. Do not combine the schema backfill, all domain refactors, and contract constraints into one migration/PR.
