"use client";

/**
 * The extraction review screen: the original document on the left, what AI
 * read out of it on the right, and one Accept per proposed entry.
 *
 * The design rule this screen exists to enforce: an extraction is a
 * suggestion until a person says otherwise. Every proposed value is editable
 * before it is accepted, and the values submitted are whatever is in the
 * fields at that moment — so an edit is what gets saved, and the accepting
 * user and time are recorded against the entry.
 *
 * Anything the document contains that this platform can't record is shown
 * too, with the reason. A gap the reviewer can see is a decision they can
 * make; a gap they can't see is data quietly lost.
 */

import { useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, FileWarning, RefreshCw, ShieldAlert, X } from "lucide-react";
import type { DocumentExtractionResult } from "@/lib/ai/schemas";
import type { ProposalSet } from "@/lib/document-proposals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  AiProvenanceFootnote,
  AiSuggestionBadge,
  AiUnavailableNotice,
  ConfidenceIndicator,
  OriginBadge,
} from "@/components/ai/ai-disclosure";
import {
  acceptExtractionAction,
  extractDocumentAction,
  markDocumentAcceptedAction,
  rejectExtractionAction,
  type AcceptExtractionState,
  type ExtractState,
} from "../actions";

interface DataPointView {
  code: string;
  dataPointName: string;
  scope: string;
  unitOptions: string[];
  frequency: string;
  factorOptions: { id: string; label: string; subtypeKey: string; unit: string | null }[];
}

interface ExtractionView {
  id: string;
  status: string;
  modelUsed: string | null;
  confidence: number | null;
  warnings: string[];
  missingFields: string[];
  errorMessage: string | null;
  createdAt: string;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  payloadValid: boolean;
}

export interface ReviewScreenProps {
  document: { id: string; filename: string; mimeType: string; status: string; siteId: string | null; notes: string | null };
  extraction: ExtractionView | null;
  result: DocumentExtractionResult | null;
  proposalSet: ProposalSet | null;
  dataPoints: DataPointView[];
  sites: { id: string; name: string; entityName: string }[];
  existingEntries: {
    id: string;
    label: string;
    code: string;
    site: string;
    value: string;
    period: string;
    status: string;
    dataOrigin: string;
  }[];
  aiAvailable: boolean;
  aiUnavailableMessage: string | null;
  autoAcceptEnabled: boolean;
  minConfidence: number;
}

const extractInitial: ExtractState = { error: null, aiUnavailable: false, extractionId: null };
const acceptInitial: AcceptExtractionState = { error: null, success: false, flagged: false, awaitingFactor: false };

function FieldRow({ label, value }: { label: string; value: string | number | boolean | null }) {
  const isMissing = value === null || value === "" || value === undefined;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={isMissing ? "text-sm italic text-slate-400" : "text-sm font-medium tabular-nums text-slate-900"}>
        {isMissing ? "not on the document" : typeof value === "boolean" ? (value ? "yes" : "no") : String(value)}
      </dd>
    </div>
  );
}

export function ReviewScreen(props: ReviewScreenProps) {
  const { document: doc, extraction, result, proposalSet, dataPoints, sites } = props;
  const [extractState, extractAction, extracting] = useActionState(extractDocumentAction, extractInitial);

  const isViewableInline = doc.mimeType.startsWith("image/") || doc.mimeType === "application/pdf";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* --- Original document ------------------------------------------- */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex items-center justify-between gap-3">
            <CardTitle>Original document</CardTitle>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              Open in a new tab
            </a>
          </CardHeader>
          <CardContent>
            {isViewableInline ? (
              doc.mimeType.startsWith("image/") ? (
                /* eslint-disable-next-line @next/next/no-img-element -- user-uploaded evidence of unknown dimensions, served from our own authorized route */
                <img
                  src={`/api/documents/${doc.id}/file`}
                  alt={`Uploaded document: ${doc.filename}`}
                  className="max-h-[38rem] w-full rounded-lg border border-slate-200 object-contain"
                />
              ) : (
                <iframe
                  title={`Uploaded document: ${doc.filename}`}
                  src={`/api/documents/${doc.id}/file`}
                  className="h-[38rem] w-full rounded-lg border border-slate-200"
                  sandbox=""
                />
              )
            ) : (
              <p className="text-sm text-slate-500">
                This file type can&apos;t be previewed here. Open it in a new tab to check the extracted values against it.
              </p>
            )}
          </CardContent>
        </Card>

        {props.existingEntries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Entries created from this document</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {props.existingEntries.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {entry.label} <span className="text-slate-400">({entry.code})</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {entry.value} · {entry.period} · {entry.site}
                    </div>
                  </div>
                  <OriginBadge origin={entry.dataOrigin === "AI_EXTRACTED" ? "AI_EXTRACTED" : "USER_ENTERED"} />
                </div>
              ))}
              <form action={markDocumentAcceptedAction}>
                <input type="hidden" name="documentId" value={doc.id} />
                <Button type="submit" variant="secondary" size="sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Mark this document fully processed
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      {/* --- Extraction --------------------------------------------------- */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>What AI read from this document</CardTitle>
            <form action={extractAction}>
              <input type="hidden" name="documentId" value={doc.id} />
              <Button type="submit" variant="secondary" size="sm" disabled={extracting || !props.aiAvailable}>
                <RefreshCw className={extracting ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {extracting ? "Reading…" : extraction ? "Re-run extraction" : "Run extraction"}
              </Button>
            </form>
          </CardHeader>
          <CardContent className="space-y-4">
            {!props.aiAvailable && (
              <AiUnavailableNotice
                message={props.aiUnavailableMessage ?? "AI extraction is unavailable."}
                action="You can still enter this document's figures by hand from Data entry, and the document stays linked as evidence."
              />
            )}

            {extractState.error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
                {extractState.error}
              </div>
            )}

            {!extraction && !extractState.error && (
              <p className="text-sm text-slate-500">
                No extraction has been run for this document yet.
              </p>
            )}

            {extraction && !result && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {extraction.errorMessage ??
                  "The last extraction didn't produce a result that passed validation, so nothing from it is being shown. Re-run it, or enter the figures by hand."}
              </div>
            )}

            {extraction && result && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <AiSuggestionBadge />
                  <ConfidenceIndicator state={result.overall.state} confidence={result.overall.confidence} />
                </div>

                <p className="text-sm text-slate-600">{result.overall.reasoningSummary}</p>

                {result.containsSuspiciousInstructions && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <p className="text-sm text-red-800">
                      This document contains text that reads like an instruction aimed at an AI system. It was treated
                      as document content only and had no effect on how the extraction ran — but check the document
                      carefully before accepting anything from it.
                    </p>
                  </div>
                )}

                {result.warnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                      <AlertTriangle className="h-4 w-4" />
                      Warnings
                    </p>
                    <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
                      {result.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Document details</h3>
                  <dl className="mt-2">
                    <FieldRow label="Document type" value={result.documentKind} />
                    <FieldRow label="Supplier" value={result.metadata.supplier} />
                    <FieldRow label="Account / reference" value={result.metadata.accountReference} />
                    <FieldRow label="Invoice number" value={result.metadata.invoiceNumber} />
                    <FieldRow label="Invoice date" value={result.metadata.invoiceDate} />
                    <FieldRow label="Billing period start" value={result.metadata.billingPeriodStart} />
                    <FieldRow label="Billing period end" value={result.metadata.billingPeriodEnd} />
                    <FieldRow label="Site on document" value={result.metadata.siteNameOnDocument} />
                    <FieldRow label="Address" value={result.metadata.addressOnDocument} />
                  </dl>
                </div>

                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer select-none text-sm font-medium text-slate-700">
                    All extracted values
                  </summary>
                  <div className="mt-3 space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Energy</h4>
                      <dl className="mt-1">
                        <FieldRow label="Electricity (kWh)" value={result.energy.electricityKwh} />
                        <FieldRow label="Gas (kWh)" value={result.energy.gasKwh} />
                        <FieldRow label="Gas volume (m³)" value={result.energy.gasVolumeM3} />
                        <FieldRow label="Fuel (litres)" value={result.energy.fuelLitres} />
                        <FieldRow label="Fuel type" value={result.energy.fuelType} />
                        <FieldRow label="Meter number" value={result.energy.meterNumber} />
                        <FieldRow label="Previous reading" value={result.energy.meterReadingPrevious} />
                        <FieldRow label="Current reading" value={result.energy.meterReadingCurrent} />
                        <FieldRow label="Renewable tariff stated" value={result.energy.renewableTariffStated} />
                        <FieldRow label="Renewable tariff detail" value={result.energy.renewableTariffDetail} />
                      </dl>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Water</h4>
                      <dl className="mt-1">
                        <FieldRow label="Water consumption" value={result.water.waterConsumption} />
                        <FieldRow label="Water unit" value={result.water.waterUnit} />
                        <FieldRow label="Wastewater" value={result.water.wastewaterVolume} />
                        <FieldRow label="Wastewater unit" value={result.water.wastewaterUnit} />
                      </dl>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Waste</h4>
                      <dl className="mt-1">
                        <FieldRow label="WTN reference" value={result.waste.wtnReference} />
                        <FieldRow label="Carrier" value={result.waste.carrierName} />
                        <FieldRow label="Carrier registration" value={result.waste.carrierRegistrationNumber} />
                        <FieldRow label="Destination" value={result.waste.destinationSite} />
                        <FieldRow label="Transfer date" value={result.waste.transferDate} />
                      </dl>
                      {result.waste.lines.map((line, i) => (
                        <dl key={i} className="mt-2 rounded-lg bg-slate-50 p-2">
                          <FieldRow label={`Line ${i + 1} description`} value={line.description} />
                          <FieldRow label="EWC code" value={line.ewcCode} />
                          <FieldRow label="Weight" value={line.weight} />
                          <FieldRow label="Weight unit" value={line.weightUnit} />
                          <FieldRow label="Treatment" value={line.treatmentMethod} />
                          <FieldRow label="Disposal / recovery" value={line.disposalOrRecovery} />
                        </dl>
                      ))}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Transport</h4>
                      <dl className="mt-1">
                        <FieldRow label="Mode" value={result.transport.mode} />
                        <FieldRow label="Vehicle type" value={result.transport.vehicleType} />
                        <FieldRow label="Fuel type" value={result.transport.fuelType} />
                        <FieldRow label="Distance" value={result.transport.distance} />
                        <FieldRow label="Distance unit" value={result.transport.distanceUnit} />
                        <FieldRow label="Weight" value={result.transport.weight} />
                        <FieldRow label="Tonne-km" value={result.transport.tonneKm} />
                      </dl>
                    </div>
                  </div>
                </details>

                {result.missingFields.length > 0 && (
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                      <FileWarning className="h-4 w-4 text-slate-400" />
                      Not on this document
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">{result.missingFields.join(", ")}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                  <form action={rejectExtractionAction}>
                    <input type="hidden" name="documentId" value={doc.id} />
                    <input type="hidden" name="extractionId" value={extraction.id} />
                    <Button type="submit" variant="secondary" size="sm">
                      <X className="h-4 w-4" />
                      Reject this extraction
                    </Button>
                  </form>
                  {extraction.reviewedBy && (
                    <span className="text-xs text-slate-400">
                      Reviewed by {extraction.reviewedBy}
                      {extraction.reviewedAt ? ` on ${new Date(extraction.reviewedAt).toLocaleDateString("en-GB")}` : ""}
                    </span>
                  )}
                </div>

                <AiProvenanceFootnote model={extraction.modelUsed} />
              </>
            )}
          </CardContent>
        </Card>

        {/* --- Proposed entries ------------------------------------------ */}
        {result && proposalSet && extraction && (
          <>
            {proposalSet.proposals.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Proposed entries</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500">
                    Nothing in this document maps to an activity data point this platform records. See below for what
                    was read but can&apos;t yet be turned into an entry.
                  </p>
                </CardContent>
              </Card>
            ) : (
              proposalSet.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.key}
                  proposal={proposal}
                  documentId={doc.id}
                  extractionId={extraction.id}
                  defaultSiteId={doc.siteId}
                  sites={sites}
                  dataPoint={dataPoints.find((dp) => dp.code === proposal.dataPointCode) ?? null}
                  confidence={result.overall.confidence}
                  minConfidence={props.minConfidence}
                  autoAcceptEnabled={props.autoAcceptEnabled}
                />
              ))
            )}

            {proposalSet.unmapped.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Read, but not recorded as an entry</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {proposalSet.unmapped.map((item, i) => (
                    <div key={i} className="rounded-lg bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-900">{item.label}</p>
                      {item.detail && <p className="mt-0.5 text-sm text-slate-700">{item.detail}</p>}
                      <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  documentId,
  extractionId,
  defaultSiteId,
  sites,
  dataPoint,
  confidence,
  minConfidence,
  autoAcceptEnabled,
}: {
  proposal: ProposalSet["proposals"][number];
  documentId: string;
  extractionId: string;
  defaultSiteId: string | null;
  sites: { id: string; name: string; entityName: string }[];
  dataPoint: DataPointView | null;
  confidence: number;
  minConfidence: number;
  autoAcceptEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(acceptExtractionAction, acceptInitial);
  const [unit, setUnit] = useState(proposal.unit);

  const belowThreshold = confidence < minConfidence;
  const matchingOption = dataPoint?.factorOptions.find((o) => o.subtypeKey === proposal.subtypeKey);

  if (state.success) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent>
          <p className="text-sm font-semibold text-emerald-900">Accepted — {proposal.label} saved.</p>
          <p className="mt-1 text-sm text-emerald-800">
            {state.flagged
              ? "The entry looks unusual against the previous period and has been flagged for review before it counts towards a report."
              : state.awaitingFactor
                ? "The entry is saved, but no emission factor has been imported for this category yet — the figure will appear automatically once one is."
                : "The emissions figure has been calculated from the approved emission factor for that period."}
          </p>
          <p className="mt-2 text-xs text-emerald-700">
            Recorded as AI-extracted and accepted by you, with this document linked as evidence.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{proposal.label}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{proposal.dataPointCode}</Badge>
          <AiSuggestionBadge />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-500">{proposal.basis}</p>

        {proposal.needsAttention.length > 0 && (
          <ul className="mt-3 list-inside list-disc rounded-lg bg-amber-50/60 p-3 text-sm text-amber-900">
            {proposal.needsAttention.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}

        {belowThreshold && (
          <p className="mt-3 rounded-lg bg-amber-50/60 p-3 text-sm text-amber-900">
            The model&apos;s confidence in this extraction ({Math.round(confidence * 100)}%) is below this platform&apos;s
            review threshold ({Math.round(minConfidence * 100)}%). Check every value against the document before
            accepting.
          </p>
        )}

        {!autoAcceptEnabled && (
          <p className="mt-3 text-xs text-slate-400">
            Auto-accept is off, so nothing is saved until you press Accept. Edit any value first — what you accept is
            what gets stored.
          </p>
        )}

        <form action={formAction} className="mt-4 space-y-4">
          <input type="hidden" name="documentId" value={documentId} />
          <input type="hidden" name="extractionId" value={extractionId} />
          <input type="hidden" name="dataPointCode" value={proposal.dataPointCode} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${proposal.key}-site`}>Site</Label>
              <Select
                id={`${proposal.key}-site`}
                name="siteId"
                required
                defaultValue={defaultSiteId ?? sites[0]?.id ?? ""}
                className="mt-1"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.entityName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${proposal.key}-period`}>Period</Label>
              <Input
                id={`${proposal.key}-period`}
                name="periodInput"
                type="month"
                required
                defaultValue={proposal.periodInput ?? ""}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`${proposal.key}-quantity`}>Amount</Label>
              <Input
                id={`${proposal.key}-quantity`}
                name="quantity"
                type="number"
                step="any"
                min="0"
                required
                defaultValue={proposal.quantity}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor={`${proposal.key}-unit`}>Unit</Label>
              {dataPoint && dataPoint.unitOptions.length > 1 ? (
                <Select
                  id={`${proposal.key}-unit`}
                  name="unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="mt-1"
                >
                  {dataPoint.unitOptions.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  <Input value={unit} disabled className="mt-1" />
                  <input type="hidden" name="unit" value={unit} />
                </>
              )}
            </div>
            {dataPoint && dataPoint.factorOptions.length > 0 && (
              <div>
                <Label htmlFor={`${proposal.key}-option`}>Type</Label>
                <Select
                  id={`${proposal.key}-option`}
                  name="factorOptionId"
                  required
                  defaultValue={matchingOption?.id ?? ""}
                  className="mt-1"
                >
                  <option value="" disabled>
                    — choose —
                  </option>
                  {dataPoint.factorOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}

          <Button type="submit" disabled={pending}>
            <CheckCircle2 className="h-4 w-4" />
            {pending ? "Saving…" : "Accept and save this entry"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
