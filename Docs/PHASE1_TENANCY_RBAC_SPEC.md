# Phase 1 Build Specification — Multi-Organisation Tenancy and Configurable RBAC

This specification removes design discretion from implementation tasks T10–T1B. It is a target contract, not an applied migration. The implementation agent may adjust Prisma syntax only where required by Prisma validation; semantic changes require an ADR.

## 1. Fixed decisions

1. `Organisation` is the SaaS tenant/customer.
2. Existing `Entity` remains an operating/legal company inside an Organisation.
3. Existing `Site` remains a facility or office inside an Entity.
4. `User` is a global identity and may belong to several Organisations.
5. Authorisation comes from active Organisation membership and current database grants, never from the legacy JWT `role` claim.
6. Roles are organisation-owned. System templates are copied into each Organisation, so role assignments never point to a global mutable role.
7. Permission definitions are global immutable catalogue entries; permission grants are organisation-owned through roles.
8. Entity/site scope is optional. An active membership with no restrictions has organisation-wide scope; restricted membership has explicit Entity and/or Site grants.
9. Organisation administrators may manage roles but do not approve compliance obligations by default.
10. Only the Sustainability Lead template initially receives `ems.compliance_obligation.approve`.
11. Platform-global reference data is explicit. Customer data must never rely on “nullable organisation means maybe global” without a visibility discriminator.
12. Application scoping and composite constraints ship before RLS. RLS is a defence-in-depth phase after a Neon/Prisma spike.

## 2. Core Prisma contract

Names below are normative. CUIDs match the existing schema. All date fields use UTC `DateTime`.

```prisma
enum OrganisationStatus {
  ACTIVE
  SUSPENDED
  CLOSED
}

enum MembershipStatus {
  INVITED
  ACTIVE
  SUSPENDED
  REMOVED
}

enum MembershipAccessMode {
  ORGANISATION_WIDE
  RESTRICTED
}

enum RoleTemplateKey {
  SUSTAINABILITY_LEAD
  EMS_CONTRIBUTOR
  SITE_MANAGER
  AUDITOR
  FINANCE_READ_ONLY
  ORGANISATION_ADMINISTRATOR
}

enum ReferenceVisibility {
  PLATFORM
  ORGANISATION
}

model Organisation {
  id                  String             @id @default(cuid())
  name                String
  slug                String             @unique
  status              OrganisationStatus @default(ACTIVE)
  timezone            String             @default("Europe/London")
  locale              String             @default("en-GB")
  defaultJurisdiction String             @default("GB-UKM")
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  entities     Entity[]
  memberships  OrganisationMembership[]
  roles         RoleDefinition[]

  @@index([status])
}

model OrganisationMembership {
  id             String               @id @default(cuid())
  organisationId String
  userId         String
  status         MembershipStatus     @default(INVITED)
  accessMode     MembershipAccessMode @default(ORGANISATION_WIDE)
  invitedAt      DateTime             @default(now())
  activatedAt    DateTime?
  suspendedAt    DateTime?
  removedAt      DateTime?
  lastAccessedAt DateTime?
  createdAt      DateTime             @default(now())
  updatedAt      DateTime             @updatedAt

  organisation Organisation @relation(fields: [organisationId], references: [id])
  user         User         @relation(fields: [userId], references: [id])
  roles        MembershipRole[]
  entityScopes MembershipEntityScope[]
  siteScopes   MembershipSiteScope[]

  @@unique([organisationId, userId])
  @@unique([organisationId, id])
  @@index([userId, status])
}

model PermissionDefinition {
  code        String   @id
  domain      String
  description String
  isSensitive Boolean  @default(false)
  createdAt   DateTime @default(now())

  rolePermissions RolePermission[]
}

model RoleDefinition {
  id             String           @id @default(cuid())
  organisationId String
  name           String
  description    String?
  templateKey    RoleTemplateKey?
  isSystemSeeded Boolean          @default(false)
  isActive       Boolean          @default(true)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  organisation Organisation @relation(fields: [organisationId], references: [id])
  permissions  RolePermission[]
  memberships  MembershipRole[]

  @@unique([organisationId, name])
  @@unique([organisationId, id])
  @@unique([organisationId, templateKey])
}

model RolePermission {
  organisationId String
  roleId         String
  permissionCode String
  grantedAt      DateTime @default(now())
  grantedByUserId String?

  role       RoleDefinition       @relation(fields: [organisationId, roleId], references: [organisationId, id])
  permission PermissionDefinition @relation(fields: [permissionCode], references: [code])

  @@id([roleId, permissionCode])
  @@index([organisationId, permissionCode])
}

model MembershipRole {
  organisationId String
  membershipId   String
  roleId         String
  assignedAt     DateTime @default(now())
  assignedByUserId String?

  membership OrganisationMembership @relation(fields: [organisationId, membershipId], references: [organisationId, id])
  role       RoleDefinition           @relation(fields: [organisationId, roleId], references: [organisationId, id])

  @@id([membershipId, roleId])
  @@index([organisationId, roleId])
}

model MembershipEntityScope {
  organisationId String
  membershipId   String
  entityId       String

  membership OrganisationMembership @relation(fields: [organisationId, membershipId], references: [organisationId, id])
  entity     Entity                 @relation(fields: [organisationId, entityId], references: [organisationId, id])

  @@id([membershipId, entityId])
  @@index([organisationId, entityId])
}

model MembershipSiteScope {
  organisationId String
  membershipId   String
  siteId         String

  membership OrganisationMembership @relation(fields: [organisationId, membershipId], references: [organisationId, id])
  site       Site                   @relation(fields: [organisationId, siteId], references: [organisationId, id])

  @@id([membershipId, siteId])
  @@index([organisationId, siteId])
}
```

If optional `grantedByUserId`/`assignedByUserId` relations make the first migration overly broad, store them in the append-only audit event and add relational fields later. Do not weaken the cross-organisation composite relations.

## 3. Changes to existing roots

### Entity and Site

```prisma
model Entity {
  id             String @id @default(cuid())
  organisationId String
  organisation   Organisation @relation(fields: [organisationId], references: [id])
  // existing fields and relations remain

  @@unique([organisationId, id])
  @@unique([organisationId, name])
  @@index([organisationId])
}

model Site {
  id             String @id @default(cuid())
  organisationId String
  entityId       String
  entity         Entity @relation(fields: [organisationId, entityId], references: [organisationId, id])
  // existing fields and relations remain

  @@unique([organisationId, id])
  @@unique([organisationId, entityId, name])
  @@index([organisationId, isActive])
}
```

Remove the existing global `Entity.name @unique` and `[entityId, name]` constraint only after backfill and conflict preflight.

### User

Add `memberships OrganisationMembership[]`. Keep `role Role` through the compatibility window, mark it deprecated in comments, and stop placing it into new authorisation decisions. Do not remove it in the expand migration.

## 4. Organisation ownership matrix

Add a direct `organisationId` to customer-owned roots. Descendants must use composite relationships where practical so an ID from another tenant cannot be attached.

| Model/domain | Ownership | Required treatment |
|---|---|---|
| `Entity`, `Site` | Organisation | Direct non-null `organisationId` |
| `User` | Platform identity | No organisation ID; access only through membership |
| `ActivityDataPoint`, `FactorOption` | Platform catalogue | Remain global/read-only reference |
| `EmissionFactorSet` | Platform or Organisation | Add `visibility` plus `ownerOrganisationId`; official sets are PLATFORM, supplier-specific/LCA tenant sets are ORGANISATION |
| `EmissionFactor` | Inherits factor set | Assert visibility through set; optional denormalised organisation ID only if RLS requires it |
| `SiteEnergyContract`, `ActivityEntry`, `CommutingSurvey` | Organisation via Site | Direct organisation ID and composite Site relation |
| `Calculation` | Organisation via ActivityEntry | Direct organisation ID recommended for export/RLS and composite entry relation |
| `ReportSnapshot` | Organisation | Direct organisation ID; immutable snapshot cannot mix tenants |
| Products, suppliers, methodologies, LCA assessments | Organisation | Existing `entityId` is insufficient; add direct organisation ID and composite Entity relationship |
| LCA model/inventory/results/evidence/versions/audit | Organisation via assessment | Add direct organisation ID to externally addressable/exportable roots; enforce composite parent links |
| `AiSettings`, `AiTaskModel` | Organisation | Replace singleton with one settings root per Organisation |
| `AiInteraction`, `AiSuggestion` | Organisation | Direct organisation ID |
| `SourceDocument`, `DocumentExtraction` | Organisation | Direct organisation ID; document-site relation must be tenant-consistent |

No report snapshot, LCA issued version, document, export, AI context, or job payload may combine more than one Organisation.

## 5. Permission catalogue v1

Permission codes are stable API identifiers. Labels may change; codes may not be reused.

```text
organisation.view
organisation.settings.manage
organisation.membership.view
organisation.membership.manage
organisation.role.view
organisation.role.manage
organisation.access_review.manage

carbon.view
carbon.entry.create
carbon.entry.review
carbon.entry.approve
carbon.contract.manage
carbon.document.manage
carbon.report.generate
carbon.report.export
carbon.factor.view
carbon.factor.manage

lca.view
lca.product.manage
lca.assessment.edit
lca.assessment.calculate
lca.assessment.approve
lca.version.issue
lca.verification.record
lca.methodology.manage
lca.supplier.manage
lca.evidence.manage
lca.export

ai.use
ai.settings.manage
ai.audit.view

ems.view
ems.programme.manage
ems.context.manage
ems.policy.manage
ems.aspect.edit
ems.aspect.approve
ems.control.manage
ems.monitoring.record
ems.monitoring.review
ems.legal_source.manage
ems.applicability.assess
ems.applicability.review
ems.compliance_obligation.edit
ems.compliance_obligation.approve
ems.compliance_evaluation.perform
ems.objective.manage
ems.action.manage
ems.audit_programme.manage
ems.audit.perform
ems.audit_report.issue
ems.incident.report
ems.incident.manage
ems.nonconformity.manage
ems.corrective_action.manage
ems.corrective_action.effectiveness_review
ems.competence.view
ems.competence.manage
ems.management_review.manage
ems.management_review.approve
ems.controlled_document.manage
ems.communication.manage
ems.emergency_plan.manage
ems.emergency_exercise.record
ems.export

audit.view
audit.export
```

`organisation.role.manage`, compliance approval, audit-report issue, corrective-action effectiveness review, management-review approval, controlled-document approval (when separated later), exports, and sensitive competence/incident access should be marked sensitive.

## 6. Default role-template grants

These are starting templates. Organisation-owned copies are editable and changes are audited.

| Capability | Sustainability Lead | EMS Contributor | Site Manager | Auditor | Finance/read-only | Org Administrator |
|---|---:|---:|---:|---:|---:|---:|
| Organisation/member/role administration | View | — | — | — | — | Manage |
| Carbon view | ✓ | ✓ | Scoped | ✓ | ✓ | ✓ |
| Carbon entry/manage | ✓ | ✓ | Scoped | — | — | ✓ |
| Carbon report/export | ✓ | — | Scoped view | View | ✓ | ✓ |
| LCA edit/calculate | ✓ | ✓ | Scoped | — | — | ✓ |
| LCA approve/issue | ✓ | — | — | — | — | — by default |
| EMS programme/context/policy | Manage | Edit | Scoped edit | View | View | View |
| Aspects/controls | Approve/manage | Edit | Scoped edit | View | View | View |
| Applicability assessment | Review | Assess | Scoped assess | View | View | View |
| Compliance obligation edit | ✓ | ✓ | Scoped | — | — | View |
| **Compliance obligation approve** | **✓** | **—** | **—** | **—** | **—** | **—** |
| Compliance evaluation | Perform/review | Perform | Scoped perform | Perform if assigned | View | View |
| Objectives/actions | Manage | Update | Scoped update | View | View | View |
| Audit programme/report | Manage/issue | View | View | Perform/issue if granted | View | View |
| Incidents/NC/CAPA | Manage/review | Work | Scoped work | Findings only | View restricted | View restricted |
| Competence | Manage | Own view | Scoped view | View evidence if assigned | — | Metadata only |
| Management review | Manage/approve | Contribute | Contribute | View | View | View |
| Role configuration | — | — | — | — | — | ✓ |

Do not translate this table into “administrator can do everything.” Grants are explicit.

## 7. Runtime context contract

```ts
export interface OrganisationContext {
  userId: string;
  membershipId: string;
  organisationId: string;
  organisationSlug: string;
  permissions: ReadonlySet<PermissionCode>;
  access: {
    mode: "ORGANISATION_WIDE" | "RESTRICTED";
    entityIds: ReadonlySet<string>;
    siteIds: ReadonlySet<string>;
  };
  correlationId: string;
}

export async function requireOrganisationContext(
  requestedOrganisation?: string,
): Promise<OrganisationContext>;

export function requirePermission(
  context: OrganisationContext,
  permission: PermissionCode,
): void;

export function assertEntityAccess(
  context: OrganisationContext,
  entityId: string,
): void;

export function assertSiteAccess(
  context: OrganisationContext,
  siteId: string,
): void;
```

The selected organisation may be stored in an HTTP-only signed cookie containing only an organisation identifier. It is not authority. Every request resolves the active membership, current grants, and scopes from the database. Cache only briefly and invalidate by membership/role `updatedAt` version; sensitive actions should bypass permission cache.

## 8. Repository contract

```ts
export interface TenantRepositoryContext {
  organisationId: string;
  userId: string;
  correlationId: string;
}

export async function listSites(
  ctx: TenantRepositoryContext,
  access: OrganisationContext["access"],
): Promise<Site[]>;

export async function getActivityEntry(
  ctx: TenantRepositoryContext,
  entryId: string,
): Promise<ActivityEntry | null>;
```

Rules:

- context is the first parameter for every customer-data repository call;
- repository queries include `organisationId` in the same `where`, not a post-query check;
- writes connect parents through composite organisation-aware keys;
- `findUnique({id})` is prohibited for customer-owned records unless followed inside the same transaction by a tenant constraint that cannot leak data; prefer `findFirst({where:{id, organisationId}})` or composite unique keys;
- not-found and not-authorised responses are indistinguishable at public boundaries;
- list/count/aggregate/search queries apply the same tenant and Entity/Site scopes;
- platform-reference repositories have `platform` in their name and cannot return organisation-owned rows unless explicitly requested by a tenant-aware resolver.

## 9. Migration sequence

### Expand migration A

- Add Organisation/membership/RBAC tables.
- Add nullable `organisationId` compatibility columns and indexes.
- Add visibility/owner fields to mixed global/tenant reference roots.
- Do not drop or change existing unique constraints yet.

### Backfill command

- `--dry-run` default; `--apply` required to write.
- Create one Organisation shell.
- Link existing Entities and derive Site ownership.
- Create memberships and clone default role templates.
- Map legacy role to template.
- Populate organisation IDs through relationships without reading measurement values into output/logs.
- Produce counts, orphan counts, and conflicts only.

### Application dual-read/dual-write window

- Resolve organisation membership.
- Write organisation IDs on new/changed rows.
- Read through tenant repositories.
- Keep legacy fields for rollback but do not authorise from them.

### Contract migration B

- Preflight all null/orphan/cross-tenant/conflicting rows.
- Add non-null and composite constraints.
- Replace global unique constraints with organisation-scoped constraints.
- Remove dual-write fallback.
- Leave legacy `User.role` column until a later cleanup migration; mark unused.

### Optional RLS migration C

- Only after T1B passes.
- Dedicated non-owner application role with no `BYPASSRLS`.
- `SET LOCAL app.organisation_id` inside a transaction wrapper.
- Policies deny when context is missing.
- Connection-pool reuse test is mandatory.

## 10. Audit events required during Phase 1

```text
organisation.created
organisation.settings_changed
membership.invited
membership.activated
membership.suspended
membership.removed
membership.scope_changed
role.created
role.updated
role.deactivated
role.permission_granted
role.permission_revoked
membership.role_assigned
membership.role_removed
access_review.completed
```

Each event records organisation, actor, target, correlation ID, safe before/after summary, and timestamp. Never record password hashes, invitation tokens, cookies, file bytes, environmental values, API keys, or full AI prompts.

## 11. Definition of done for Phase 1

- Two synthetic Organisations can use all existing carbon/LCA/document/AI flows without cross-tenant access.
- Every externally addressable customer record is tenant checked in the query itself.
- All exports and downloads use the same tenant context as pages/actions.
- Current database permissions, not JWT role claims, authorise sensitive actions.
- Organisation Administrator lacks compliance-obligation approval by default.
- Existing carbon/LCA golden invariants are unchanged.
- Migration dry run reports no values and changes no data.
- Contract migration refuses inconsistent ownership.
- Direct Prisma access allowlist is shrinking and no new route/action bypasses repositories.
- No real environmental data exists in tests, screenshots, logs, fixtures, or preview databases.

## 12. PR sequence and file map

The exact current-file batches and canonical PR-01 through PR-15 order are in `PHASE1_FILE_REFACTOR_MAP.md`. Tenant, mixed-parent, aggregate, export/download, job, AI, migration and RLS acceptance cases are in `PHASE1_ADVERSARIAL_TEST_MATRIX.md`. Those companion documents are normative for Phase 1 execution.

## 13. Minimal Claude context

| Task | Provide |
|---|---|
| T10 | §§1–4 and 9 plus current Organisation/Entity/Site/User schema |
| T11 | §§1–2, 5–6 plus permission seed location |
| T12 | §9 backfill plus existing synthetic seed structure only |
| T13–T15 | §§7–8 plus auth/Prisma wrapper and matching adversarial cases |
| T16 | Carbon batches B–D from file map plus carbon rows in test matrix |
| T17 | LCA batches E–G plus LCA/export rows in test matrix |
| T18 | AI/factor batches H–I plus AI isolation tests |
| T19 | §§5–7 plus membership/permission-specific tests |
| T1A | §§3–4 and 9 contract migration plus migration tests |
| T1B | §9 RLS plus RLS spike tests and Neon ADR/config |
