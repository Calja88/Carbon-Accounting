# Phase 1 Adversarial Tenant-Isolation Test Matrix

Use two entirely synthetic tenants:

- Organisation A: `Aster Demo`, Entity `Aster Manufacturing`, Site `Aster North`;
- Organisation B: `Birch Demo`, Entity `Birch Services`, Site `Birch South`.

Create users: A-only contributor, B-only contributor, dual-member user, A Sustainability Lead, A Organisation Administrator, suspended A member, and unauthenticated visitor. Use fictional environmental values only where a test requires a numeric row.

## 1. Mandatory access matrix

For every row below, test page/service read, mutation, direct-ID access, nested-parent substitution, list/search, count/aggregate where relevant, export/download, and error-response leakage.

| Resource root | A user → A record | A user → B record | Dual member in A context → B record | Suspended member | Key nested-ownership attack |
|---|---:|---:|---:|---:|---|
| Entity | Allow in scope | Deny/not found | Deny/not found | Deny | B Entity ID submitted to A action |
| Site | Allow in scope | Deny/not found | Deny/not found | Deny | A organisation + B Entity/Site combination |
| Activity entry | Permission based | Deny/not found | Deny/not found | Deny | A Site with B factor option/reference misuse |
| Energy contract | Permission based | Deny/not found | Deny/not found | Deny | Foreign Site ID in create/update |
| Commuting survey | Permission based | Deny/not found | Deny/not found | Deny | Foreign response/entry link |
| Calculation | View based | Deny/not found | Deny/not found | Deny | Foreign ActivityEntry calculation ID |
| Report snapshot | View based | Deny/not found | Deny/not found | Deny | Mixed-tenant calculations in snapshot generation |
| Corporate document | View/manage based | Deny/not found | Deny/not found | Deny | Foreign Site or extraction acceptance |
| Product/version | Permission based | Deny/not found | Deny/not found | Deny | Foreign Entity/manufacturing location |
| Supplier/PCF | Permission based | Deny/not found | Deny/not found | Deny | Attach B supplier PCF to A inventory |
| LCA methodology | Visibility based | Deny tenant-owned | Deny tenant-owned | Deny | Use B method in A assessment |
| LCA assessment | Permission based | Deny/not found | Deny/not found | Deny | Foreign ProductVersion/Entity |
| LCA process/inventory | Permission based | Deny/not found | Deny/not found | Deny | Child ID from B under A assessment route |
| LCA evidence/blob | Permission based | Deny/not found | Deny/not found | Deny | Guess storage/evidence ID |
| LCA run/result/version | View based | Deny/not found | Deny/not found | Deny | Export B run through A assessment route |
| AI interaction/suggestion | Own/permission based | Deny/not found | Deny/not found | Deny | B target ID supplied to A assistant |
| Organisation settings | Permission based | Deny/not found | Deny/not found | Deny | Slug/ID swap |
| Membership/role | Permission based | Deny/not found | Deny/not found | Deny | Assign A member to B role ID |

## 2. Export and download tests

Test response body, filename, headers, caching and timing where practical.

| Endpoint | Required negative tests |
|---|---|
| Corporate audit-trail CSV | B snapshot ID; A snapshot with injected B calculation link; suspended member |
| Corporate report page/print | B report ID; counts and labels contain no B data |
| Source-document file | B document ID; B extraction ID; content disposition reveals no filename |
| LCA evidence download | B evidence ID and guessed blob key |
| LCA calculation-register CSV | B assessment/run/result IDs in all route positions |
| LCA JSON export | B assessment ID; shared factor metadata must not reveal B supplier-owned set |
| PACT export | B assessment/supplier PCF; only authorised issued version |
| AI usage/audit export | A admin cannot see B interactions/costs/models unless explicit platform operator role exists |

All denial responses should be 404 or the application's consistent non-disclosing equivalent. Do not return “record exists but belongs to another organisation.”

## 3. Permission-specific tests

| Scenario | Expected |
|---|---|
| A Organisation Administrator attempts compliance-obligation approval with default grants | Denied |
| A Sustainability Lead approves exact draft version | Allowed and audited |
| Approval permission revoked after page load, before action submission | Denied from fresh DB check |
| Suspended Sustainability Lead with cached session submits approval | Denied |
| Contributor edits approved obligation | Creates draft successor only; cannot mutate approved row |
| User changes signed/unsigned organisation selector to B | Membership resolution denies |
| User has Entity A1 scope but accesses Entity A2 in same Organisation | Denied |
| User has Site A1 scope and attempts Entity-wide aggregate | Aggregate contains A1 only |
| Organisation-wide role plus restricted membership | Membership restriction wins |
| Multiple roles where one grants permission | Allowed only within membership scope |
| Role deactivated after assignment | Grants no permission |
| Permission removed from role | Next sensitive action denied without re-login |
| Last role-management principal removal | Blocked or explicit audited recovery workflow |

## 4. Mixed-tenant referential attacks

Every mutation that accepts two or more resource IDs needs at least one mixed-tenant test:

- B Site under A Entity;
- B ActivityDataPoint is not applicable because catalogue is global, but B-owned factor set under A entry must fail;
- B document accepted into A ActivityEntry;
- B corporate entry cited by A LCA inventory;
- B supplier attached to A product/assessment;
- B process as parent of A process;
- B factor attached to A inventory item when factor visibility is organisation-only;
- B evidence attached to A assessment;
- B methodology used by A assessment;
- B role assigned to A membership; and
- B Entity/Site scope assigned to A membership.

The database should reject invalid composite relations even if application validation is bypassed.

## 5. Aggregate and inference tests

- Dashboard totals for A remain unchanged when B records are added.
- A data-quality completeness denominator excludes B sites/data points.
- Prior-year and monthly comparisons exclude B.
- “awaiting factor” counts and recalculation jobs are tenant scoped.
- Supplier/material/hotspot LCA analysis excludes B.
- Search pagination totals exclude B.
- Existence checks, duplicate-name errors and unique constraints do not reveal B names.
- Notification counts exclude B.
- AI usage/rate-limit totals use intended user+organisation policy and reveal no B prompt/target metadata.
- Timing/error messages are reasonably consistent for missing and foreign IDs.

## 6. Background job tests

- A job payload requires explicit Organisation ID unless declared platform-global.
- Worker validates Organisation is active before processing tenant work.
- Retried A job cannot acquire or modify B rows through stale IDs.
- Global official-factor or legal-source job writes only platform reference data/events; tenant review-queue fan-out applies membership/organisation rules.
- Report generation job snapshots one Organisation only.
- Document extraction job rechecks document ownership and membership/actor intent.
- Revoked actor does not make a queued approval valid; approvals are never performed asynchronously without fresh permission checks.

## 7. AI isolation tests

- Carbon context includes only selected Organisation's sites, entries, calculations and completeness.
- LCA assistant refuses a foreign assessment ID.
- Document extraction refuses a foreign document ID before reading bytes.
- Factor suggestion includes platform factors plus selected Organisation's allowed factor sets, never another tenant's supplier set.
- Conversation history/context cannot switch Organisation through prompt text.
- Prompt-injection content cannot request cross-tenant lookup.
- Audit output stores no raw environmental source document or secret.

## 8. Migration tests

- Dry-run performs zero writes.
- Repeated apply is idempotent.
- Orphan Entity/Site/user mapping aborts with counts only.
- Duplicate names across different Organisations are allowed.
- Duplicate names within the same scoped constraint are rejected.
- Contract migration rejects null ownership.
- Contract migration rejects child/parent Organisation mismatch.
- Roll-forward from expand to contract preserves existing carbon/LCA result values under synthetic fixtures.
- Rollback plan never drops newly attributed tenant ownership silently.

## 9. RLS spike tests

- Missing `app.organisation_id` returns zero rows/denies writes.
- A transaction context sees A only.
- Reused pooled connection followed by B transaction sees B only.
- Failed/rolled-back A transaction does not leak context.
- Direct application role cannot disable RLS.
- Migration owner can migrate but is not used by runtime.
- Background platform job uses an explicit privileged path with separate credentials and audit; it is unavailable to request handlers.

## 10. CI gate

Phase 1 cannot complete unless:

- every resource row has at least one passing foreign-ID negative test;
- every export/download has a foreign-ID test;
- every multi-ID mutation has a mixed-tenant test;
- current carbon/LCA golden tests remain green;
- static unscoped-Prisma check passes; and
- tests contain synthetic names/values only.
