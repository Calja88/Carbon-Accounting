"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  generateManagementReviewPackAction,
  issueManagementReviewPackAction,
  addManagementReviewAiNarrativeAction,
  reviewManagementReviewAiNarrativeAction,
  holdManagementReviewAction,
  recordManagementReviewDecisionAction,
  draftManagementReviewMinutesAction,
  approveManagementReviewMinutesAction,
  createManagementReviewMinutesAddendumAction,
  closeManagementReviewAction,
  linkManagementReviewActionAction,
  unlinkManagementReviewActionAction,
  type ReviewActionState,
} from "../actions";

const emptyState: ReviewActionState = { error: null, message: null };

export type ReviewSummary = {
  id: string;
  reference: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  cutoffDate: string;
  scheduledDate: string;
  heldDate: string | null;
  chairName: string;
  coordinatorName: string;
  agendaTemplateName: string;
  agendaTemplateVersion: number;
  attendeeCount: number;
};

export type InputSnapshotView = {
  id: string;
  inputDefinitionKey: string;
  sourceType: string;
  sourceRecordId: string;
  sourceVersionLabel: string | null;
  summary: string | null;
  isStale: boolean;
};

export type AiNarrativeView = {
  id: string;
  content: string;
  status: string;
  generatedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export type PackView = {
  id: string;
  status: string;
  cutoffDate: string;
  generatorVersion: string;
  generatedAt: string | null;
  checksumSha256: string | null;
  issuedAt: string | null;
  payload: Record<string, unknown> | null;
  inputSnapshots: InputSnapshotView[];
  aiNarratives: AiNarrativeView[];
};

export type ActionLinkView = { id: string; actionItemId: string; actionItemTitle: string; actionItemStatus: string };

export type DecisionView = {
  id: string;
  inputDefinitionKey: string | null;
  decisionType: string;
  text: string;
  rationale: string | null;
  ownerName: string | null;
  targetDate: string | null;
  recordedAt: string;
  actionLinks: ActionLinkView[];
};

export type MinuteRevisionView = {
  id: string;
  revisionNumber: number;
  status: string;
  supersedesRevisionId: string | null;
  addendumReason: string | null;
  preparedAt: string;
  approvedAt: string | null;
  checksumSha256: string | null;
};

export type ActionOption = { id: string; title: string; status: string };
export type MemberOption = { id: string; name: string };

function Feedback({ state }: { state: ReviewActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "PLANNED") return "warning";
  if (status === "INPUT_COLLECTION") return "info";
  if (status === "PACK_ISSUED" || status === "MINUTES_DRAFT") return "info";
  if (status === "HELD") return "success";
  if (status === "APPROVED" || status === "CLOSED") return "neutral";
  if (status === "DRAFT") return "warning";
  if (status === "ISSUED") return "success";
  if (status === "REJECTED") return "danger";
  if (status === "PENDING_REVIEW") return "warning";
  if (status === "REVIEWED") return "success";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Pack: generate/preview (repeatable while DRAFT) -> issue (one-way freeze)
// ---------------------------------------------------------------------------

function PackSection({ review, pack, canManage }: { review: ReviewSummary; pack: PackView | null; canManage: boolean }) {
  const [generateState, generateAction] = useActionState(generateManagementReviewPackAction, emptyState);
  const [issueState, issueAction] = useActionState(issueManagementReviewPackAction, emptyState);

  const canGenerate = canManage && review.status === "INPUT_COLLECTION" && (!pack || pack.status !== "ISSUED");
  const canIssue = canManage && review.status === "INPUT_COLLECTION" && pack && pack.status !== "ISSUED";

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Review pack</h2>
          {pack && <Badge tone={statusTone(pack.status)}>{pack.status}</Badge>}
        </div>

        {!pack && (
          <p className="text-sm text-slate-500">
            No pack has been generated yet. A pack can only be generated while the review is in input collection.
          </p>
        )}

        {pack && (
          <div className="space-y-3 text-sm text-slate-700">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Cutoff date</dt>
                <dd>{pack.cutoffDate}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Generator version</dt>
                <dd>{pack.generatorVersion}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Generated at</dt>
                <dd>{pack.generatedAt ? new Date(pack.generatedAt).toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Issued at</dt>
                <dd>{pack.issuedAt ? new Date(pack.issuedAt).toLocaleString() : "—"}</dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-slate-500">Checksum (SHA-256)</dt>
                <dd className="break-all font-mono text-xs">{pack.checksumSha256 ?? "—"}</dd>
              </div>
            </dl>

            {pack.status === "ISSUED" && (
              <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-600">
                This pack is issued and immutable. Its contents and checksum can never be regenerated or altered.
              </p>
            )}

            <div>
              <h3 className="text-sm font-medium text-slate-900">Inputs ({pack.inputSnapshots.length})</h3>
              <ul className="mt-1 divide-y divide-slate-100 text-xs">
                {pack.inputSnapshots.map((snapshot) => (
                  <li key={snapshot.id} className="flex items-center justify-between py-1.5">
                    <span>
                      <span className="font-medium">{snapshot.inputDefinitionKey}</span>{" "}
                      <span className="text-slate-500">
                        ({snapshot.sourceType} · {snapshot.sourceRecordId}
                        {snapshot.sourceVersionLabel ? ` · ${snapshot.sourceVersionLabel}` : ""})
                      </span>
                    </span>
                    {snapshot.isStale && <Badge tone="warning">Stale</Badge>}
                  </li>
                ))}
                {pack.inputSnapshots.length === 0 && (
                  <li className="py-1.5 text-slate-500">No input snapshots yet &mdash; the pack has not been issued.</li>
                )}
              </ul>
            </div>

            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer select-none font-medium text-slate-900">Deterministic pack contents (JSON)</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-50 p-3">{JSON.stringify(pack.payload, null, 2)}</pre>
            </details>
          </div>
        )}

        {canManage && review.status === "INPUT_COLLECTION" && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <form action={generateAction}>
              <input type="hidden" name="reviewId" value={review.id} />
              <Button type="submit" variant="secondary" disabled={!canGenerate}>
                {pack ? "Regenerate pack (preview)" : "Generate pack (preview)"}
              </Button>
            </form>
            <form action={issueAction}>
              <input type="hidden" name="reviewId" value={review.id} />
              <Button type="submit" disabled={!canIssue}>
                Issue pack
              </Button>
            </form>
          </div>
        )}
        <Feedback state={generateState} />
        <Feedback state={issueState} />

        {pack && pack.status === "ISSUED" && canManage && <AiNarrativeSection review={review} pack={pack} />}
      </CardContent>
    </Card>
  );
}

function AiNarrativeSection({ review, pack }: { review: ReviewSummary; pack: PackView }) {
  const [addState, addAction] = useActionState(addManagementReviewAiNarrativeAction, emptyState);
  const [reviewState, reviewAction] = useActionState(reviewManagementReviewAiNarrativeAction, emptyState);

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <h3 className="text-sm font-medium text-slate-900">AI narrative (labelled draft support only)</h3>
      <p className="text-xs text-slate-500">
        An AI-drafted narrative is optional, always labelled, and must be marked reviewed before it can be referenced
        from minutes. It never sets a decision or approval itself.
      </p>

      <ul className="space-y-2">
        {pack.aiNarratives.map((narrative) => (
          <li key={narrative.id} className="rounded-md border border-slate-200 p-3 text-sm">
            <div className="flex items-center justify-between">
              <Badge tone={statusTone(narrative.status)}>{narrative.status}</Badge>
              <span className="text-xs text-slate-500">{new Date(narrative.generatedAt).toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-slate-700">{narrative.content}</p>
            {narrative.rejectionReason && (
              <p className="mt-1 text-xs text-red-600">Rejected: {narrative.rejectionReason}</p>
            )}
            {narrative.status === "PENDING_REVIEW" && (
              <form action={reviewAction} className="mt-3 space-y-2">
                <input type="hidden" name="narrativeId" value={narrative.id} />
                <input type="hidden" name="reviewId" value={review.id} />
                <Textarea name="rejectionReason" placeholder="Reason if rejecting" rows={2} />
                <div className="flex gap-2">
                  <Button type="submit" name="decision" value="REVIEWED" variant="secondary">
                    Mark reviewed
                  </Button>
                  <Button type="submit" name="decision" value="REJECTED" variant="danger">
                    Reject
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
        {pack.aiNarratives.length === 0 && <li className="text-xs text-slate-500">No AI narrative attached.</li>}
      </ul>
      <Feedback state={reviewState} />

      <form action={addAction} className="space-y-2 border-t border-slate-100 pt-3">
        <input type="hidden" name="packId" value={pack.id} />
        <input type="hidden" name="reviewId" value={review.id} />
        <Label htmlFor="narrative-content">Attach a new AI-drafted narrative</Label>
        <Textarea id="narrative-content" name="content" rows={4} placeholder="Paste the AI-drafted narrative text (synthetic content only)." />
        <Button type="submit" variant="secondary">
          Attach narrative
        </Button>
      </form>
      <Feedback state={addState} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hold
// ---------------------------------------------------------------------------

function HoldSection({ review, canManage }: { review: ReviewSummary; canManage: boolean }) {
  const [state, action] = useActionState(holdManagementReviewAction, emptyState);
  if (review.status !== "PACK_ISSUED") return null;
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Hold the review meeting</h2>
        <p className="text-sm text-slate-500">The pack has been issued. Record the date the review was actually held.</p>
        {canManage && (
          <form action={action} className="flex items-end gap-3">
            <input type="hidden" name="reviewId" value={review.id} />
            <div>
              <Label htmlFor="heldDate">Held date</Label>
              <Input id="heldDate" name="heldDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <Button type="submit">Mark held</Button>
          </form>
        )}
        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const DECISION_TYPES = ["RESOURCE_ALLOCATION", "OBJECTIVE_OR_POLICY_CHANGE", "PROCESS_OR_CONTROL_CHANGE", "OTHER"];
const DECISION_ALLOWED_STATUSES = new Set(["HELD", "MINUTES_DRAFT", "APPROVED"]);

function DecisionCaptureForm({ review, members, canManage }: { review: ReviewSummary; members: MemberOption[]; canManage: boolean }) {
  const [state, action] = useActionState(recordManagementReviewDecisionAction, emptyState);
  if (!canManage || !DECISION_ALLOWED_STATUSES.has(review.status)) return null;
  return (
    <form action={action} className="space-y-3 rounded-md border border-slate-200 p-4">
      <input type="hidden" name="reviewId" value={review.id} />
      <h3 className="text-sm font-medium text-slate-900">Record a decision</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="decisionType">Decision type</Label>
          <Select id="decisionType" name="decisionType" defaultValue="OTHER">
            {DECISION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ownerMembershipId">Owner (optional)</Label>
          <Select id="ownerMembershipId" name="ownerMembershipId" defaultValue="">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="text">Decision text</Label>
        <Textarea id="text" name="text" rows={2} placeholder="What was decided." />
      </div>
      <div>
        <Label htmlFor="rationale">Rationale (optional)</Label>
        <Textarea id="rationale" name="rationale" rows={2} placeholder="Why this decision was made." />
      </div>
      <div>
        <Label htmlFor="targetDate">Target date (optional)</Label>
        <Input id="targetDate" name="targetDate" type="date" />
      </div>
      <Button type="submit">Record decision</Button>
      <Feedback state={state} />
    </form>
  );
}

function DecisionActionLinkForm({ decision, review, actionOptions }: { decision: DecisionView; review: ReviewSummary; actionOptions: ActionOption[] }) {
  const [linkState, linkAction] = useActionState(linkManagementReviewActionAction, emptyState);
  const linkedIds = new Set(decision.actionLinks.map((l) => l.actionItemId));
  const available = actionOptions.filter((a) => !linkedIds.has(a.id));
  if (available.length === 0) return <Feedback state={linkState} />;
  return (
    <form action={linkAction} className="mt-2 flex items-end gap-2">
      <input type="hidden" name="decisionId" value={decision.id} />
      <input type="hidden" name="reviewId" value={review.id} />
      <div className="flex-1">
        <Label htmlFor={`action-${decision.id}`}>Link an existing action</Label>
        <Select id={`action-${decision.id}`} name="actionItemId" defaultValue="">
          <option value="" disabled>
            Choose an action
          </option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({a.status})
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        Link
      </Button>
      <Feedback state={linkState} />
    </form>
  );
}

function DecisionsSection({
  review,
  decisions,
  actionOptions,
  members,
  canManage,
}: {
  review: ReviewSummary;
  decisions: DecisionView[];
  actionOptions: ActionOption[];
  members: MemberOption[];
  canManage: boolean;
}) {
  const [unlinkState, unlinkAction] = useActionState(unlinkManagementReviewActionAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Decisions</h2>
        <ul className="space-y-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <Badge tone="info">{decision.decisionType.replaceAll("_", " ")}</Badge>
                <span className="text-xs text-slate-500">{new Date(decision.recordedAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-slate-800">{decision.text}</p>
              {decision.rationale && <p className="mt-1 text-xs text-slate-500">Rationale: {decision.rationale}</p>}
              <p className="mt-1 text-xs text-slate-500">
                {decision.ownerName ? `Owner: ${decision.ownerName}` : "No owner"} ·{" "}
                {decision.targetDate ? `Target: ${decision.targetDate}` : "No target date"}
              </p>

              <div className="mt-2">
                <h4 className="text-xs font-medium text-slate-700">Linked actions</h4>
                <ul className="mt-1 space-y-1">
                  {decision.actionLinks.map((link) => (
                    <li key={link.id} className="flex items-center justify-between text-xs">
                      <span>
                        {link.actionItemTitle} <Badge tone="neutral">{link.actionItemStatus}</Badge>
                      </span>
                      {canManage && (
                        <form action={unlinkAction}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <input type="hidden" name="reviewId" value={review.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Unlink
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                  {decision.actionLinks.length === 0 && <li className="text-xs text-slate-500">No actions linked.</li>}
                </ul>
                {canManage && review.status !== "CLOSED" && (
                  <DecisionActionLinkForm decision={decision} review={review} actionOptions={actionOptions} />
                )}
              </div>
            </li>
          ))}
          {decisions.length === 0 && <li className="text-sm text-slate-500">No decisions recorded yet.</li>}
        </ul>
        <Feedback state={unlinkState} />

        <DecisionCaptureForm review={review} members={members} canManage={canManage} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Minutes: draft -> approve, addenda
// ---------------------------------------------------------------------------

function MinutesSection({
  review,
  pack,
  minuteRevisions,
  canManage,
  canApprove,
}: {
  review: ReviewSummary;
  pack: PackView | null;
  minuteRevisions: MinuteRevisionView[];
  canManage: boolean;
  canApprove: boolean;
}) {
  const [draftState, draftAction] = useActionState(draftManagementReviewMinutesAction, emptyState);
  const [approveState, approveAction] = useActionState(approveManagementReviewMinutesAction, emptyState);
  const [addendumState, addendumAction] = useActionState(createManagementReviewMinutesAddendumAction, emptyState);

  const reviewedNarratives = pack?.aiNarratives.filter((n) => n.status === "REVIEWED") ?? [];
  const latestApproved = [...minuteRevisions].reverse().find((r) => r.status === "APPROVED");
  const hasSuccessorForLatestApproved = latestApproved
    ? minuteRevisions.some((r) => r.supersedesRevisionId === latestApproved.id)
    : false;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="text-lg font-semibold text-slate-900">Minutes</h2>

        <ul className="space-y-2">
          {minuteRevisions.map((revision) => (
            <li key={revision.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  Revision {revision.revisionNumber}
                  {revision.supersedesRevisionId ? " (addendum)" : ""}
                </span>
                <Badge tone={statusTone(revision.status)}>{revision.status}</Badge>
              </div>
              {revision.addendumReason && <p className="mt-1 text-xs text-slate-500">Reason: {revision.addendumReason}</p>}
              <p className="mt-1 text-xs text-slate-500">
                Prepared {new Date(revision.preparedAt).toLocaleString()}
                {revision.approvedAt ? ` · Approved ${new Date(revision.approvedAt).toLocaleString()}` : ""}
              </p>
              {revision.checksumSha256 && (
                <p className="mt-1 break-all font-mono text-xs text-slate-400">{revision.checksumSha256}</p>
              )}
              {revision.status === "DRAFT" && canApprove && (
                <form action={approveAction} className="mt-2">
                  <input type="hidden" name="revisionId" value={revision.id} />
                  <input type="hidden" name="reviewId" value={review.id} />
                  <Button type="submit" size="sm">
                    Approve minutes
                  </Button>
                </form>
              )}
              {revision.status === "APPROVED" && (
                <p className="mt-2 text-xs text-slate-500">Approved minutes are immutable; corrections require an addendum below.</p>
              )}
            </li>
          ))}
          {minuteRevisions.length === 0 && <li className="text-sm text-slate-500">No minutes drafted yet.</li>}
        </ul>
        <Feedback state={approveState} />

        {canManage && review.status === "HELD" && minuteRevisions.length === 0 && (
          <form action={draftAction} className="space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="reviewId" value={review.id} />
            <Label htmlFor="draft-narrativeId">Reference a reviewed AI narrative (optional)</Label>
            <Select id="draft-narrativeId" name="narrativeId" defaultValue="">
              <option value="">None</option>
              {reviewedNarratives.map((n) => (
                <option key={n.id} value={n.id}>
                  Narrative from {new Date(n.generatedAt).toLocaleDateString()}
                </option>
              ))}
            </Select>
            <Button type="submit">Draft minutes</Button>
          </form>
        )}
        <Feedback state={draftState} />

        {canManage && (review.status === "APPROVED" || review.status === "CLOSED") && !hasSuccessorForLatestApproved && (
          <form action={addendumAction} className="space-y-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="reviewId" value={review.id} />
            <Label htmlFor="addendum-reason">Create a correction addendum</Label>
            <Textarea id="addendum-reason" name="reason" rows={2} placeholder="Reason for this correction." />
            <Select name="narrativeId" defaultValue="">
              <option value="">No AI narrative</option>
              {reviewedNarratives.map((n) => (
                <option key={n.id} value={n.id}>
                  Narrative from {new Date(n.generatedAt).toLocaleDateString()}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Draft addendum
            </Button>
          </form>
        )}
        <Feedback state={addendumState} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Closure
// ---------------------------------------------------------------------------

function ClosureSection({ review, canManage }: { review: ReviewSummary; canManage: boolean }) {
  const [state, action] = useActionState(closeManagementReviewAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Closure</h2>
          <Badge tone={statusTone(review.status)}>{review.status}</Badge>
        </div>
        {review.status === "APPROVED" && canManage && (
          <form action={action}>
            <input type="hidden" name="reviewId" value={review.id} />
            <Button type="submit">Close review</Button>
          </form>
        )}
        {review.status === "CLOSED" && (
          <p className="text-sm text-slate-500">This review is closed. Linked actions remain open and are tracked independently.</p>
        )}
        {review.status !== "APPROVED" && review.status !== "CLOSED" && (
          <p className="text-sm text-slate-500">A review can only be closed once its minutes are approved.</p>
        )}
        <Feedback state={state} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Root workspace
// ---------------------------------------------------------------------------

export function ManagementReviewClosurePackWorkspace({
  review,
  pack,
  decisions,
  minuteRevisions,
  actionOptions,
  members,
  canManage,
  canApprove,
}: {
  review: ReviewSummary;
  pack: PackView | null;
  decisions: DecisionView[];
  minuteRevisions: MinuteRevisionView[];
  actionOptions: ActionOption[];
  members: MemberOption[];
  canManage: boolean;
  canApprove: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Status</dt>
              <dd>
                <Badge tone={statusTone(review.status)}>{review.status}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Chair</dt>
              <dd>{review.chairName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Coordinator</dt>
              <dd>{review.coordinatorName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Attendees</dt>
              <dd>{review.attendeeCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Period</dt>
              <dd>
                {review.periodStart} &ndash; {review.periodEnd}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Cutoff</dt>
              <dd>{review.cutoffDate}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Scheduled</dt>
              <dd>{review.scheduledDate}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Held</dt>
              <dd>{review.heldDate ?? "—"}</dd>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-xs text-slate-500">Agenda template</dt>
              <dd>
                {review.agendaTemplateName} v{review.agendaTemplateVersion}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <PackSection review={review} pack={pack} canManage={canManage} />
      <HoldSection review={review} canManage={canManage} />
      <DecisionsSection review={review} decisions={decisions} actionOptions={actionOptions} members={members} canManage={canManage} />
      <MinutesSection review={review} pack={pack} minuteRevisions={minuteRevisions} canManage={canManage} canApprove={canApprove} />
      <ClosureSection review={review} canManage={canManage} />
    </div>
  );
}
