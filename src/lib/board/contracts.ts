/** Board sprint presentation boundary. No Prisma imports; never an authority boundary. */
export type LocalHref = `/${string}`;
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export interface LinkRef { label: string; href: LocalHref }
export interface RecordRef extends LinkRef { id: string; kind: string; revision: string }
export interface Coverage {
  expected: number | null;
  received: number;
  reviewed: number;
  excluded: number;
  awaitingFactor: number;
  flagged: number;
}
export type MetricState = "complete" | "partial" | "missing" | "unavailable";
export interface CarbonMetric {
  /** Display DTO uses kg, as the existing analytics service does. Never tonnes here. */
  kgCO2e: number | null;
  state: MetricState;
  coverage: Coverage;
  /** Same identifier in current/prior when their reviewed boundaries/methods are comparable. */
  comparisonKey: string;
  reason?: string;
  source: LinkRef;
}
export interface Comparison { percent: number | null; differenceKg: number | null; reason: string | null }
export interface CarbonTotals { scope1: number; scope2Location: number; scope2Market: number; scope3: number; total: number }
export interface SiteRow {
  id: string; name: string; entity: string; current: CarbonMetric; previous: CarbonMetric;
  scope1Kg: number | null; scope2LocationKg: number | null; scope3Kg: number | null;
}
export interface TrendPoint { month: string; label: string; currentKg: number | null; previousKg: number | null; href: LocalHref }
export type ActionState = "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "VERIFIED" | "REOPENED" | "CANCELLED";
export type AttentionReason = "overdue" | "blocked" | "verification" | "review" | "missing" | "upcoming";
export interface AttentionItem {
  key: string; source: RecordRef; title: string; implication: string; reason: AttentionReason;
  owner: string; site: string; dueDate: string | null; nextAction: string; priority: number;
}
export type Section<T> = { state: "ready"; data: T; asOf: string } | { state: "unavailable"; message: string };
export interface OverviewModel {
  organisationName: string; periodLabel: string; previousPeriodLabel: string;
  synthetic: boolean; capturedAt: string;
  carbon: Section<{
    current: CarbonMetric; previous: CarbonMetric; marketBasedKg: number | null;
    quantifiedCategories: number;
    /**
     * Null when no Scope 3 screening decision has actually been recorded
     * for this organisation (no screening subsystem exists yet) — never a
     * fabricated 0 or an inference from the quantified count. See
     * `screenedCategoriesReason` for why.
     */
    screenedCategories: number | null;
    screenedCategoriesReason: string | null;
    sites: SiteRow[]; trend: TrendPoint[];
  }>;
  attention: Section<{
    items: AttentionItem[]; total: number; openActions: number; awaitingVerification: number;
    /**
     * EMS-derived families (nonconformity/action/obligation-evaluation)
     * carry no site or entity attribution in the schema, so a RESTRICTED
     * member cannot be truthfully narrowed to their own scope for them.
     * When false, `items`/`total`/`openActions`/`awaitingVerification`
     * reflect only carbon-gap attention (which IS site-scoped) — never a
     * silently zeroed EMS contribution presented as "nothing outstanding".
     */
    emsAvailable: boolean;
    emsUnavailableReason: string | null;
  }>;
  priorities: Section<{ title: string; detail: string; tone: Tone; source: LinkRef }[]>;
  managementPack: LinkRef | null;
}
export interface EvidenceItem {
  id: string; name: string; revision: string; kind: "file" | "external-reference" | "controlled-revision";
  status: "available" | "missing" | "pending"; mime: string; sizeBytes: number | null;
  checksum: string | null; recordedAt: string; source: RecordRef; download: LocalHref | null;
}
export interface RecordModel {
  reference: string; title: string; kind: string; owner: string; site: string; revision: string;
  status: { label: string; tone: Tone }; summary: string;
  relations: RecordRef[]; evidence: EvidenceItem[];
  timeline: { id: string; title: string; detail: string; occurredAt: string; actor: string }[];
  nextStep: { title: string; detail: string };
}
export interface FrozenBoardPack {
  id: string; reference: string; version: number; status: "draft" | "issued";
  issuedAt: string | null; preparedBy: string; approvedBy: string | null;
  snapshot: OverviewModel; sourceRevisions: RecordRef[];
  decisions: { title: string; rationale: string; owner: string; dueDate: string | null; status: "draft" | "approved" }[];
  /** Computed/persisted by the existing pack service, not by the React component. */
  payloadSha256: string;
}
