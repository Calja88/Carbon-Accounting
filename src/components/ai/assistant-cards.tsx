"use client";

/**
 * The result cards the assistant shows in the chat.
 *
 * Every value on these cards was produced by the application — the entry and
 * calculation rows that were actually written, the validated extraction, the
 * duplicate the platform found. The model's prose sits above them and is
 * clearly labelled as such; nothing here is composed by a model, and no raw
 * model JSON is rendered anywhere.
 *
 * Card text is still rendered as text, never as markup: a supplier name read
 * off an invoice is untrusted content, and React's own escaping is what keeps
 * it inert.
 */

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileText,
  FlaskConical,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type {
  AssistantCard,
  DocumentReadCard,
  DuplicateCard,
  EntryCreatedCard,
  LcaFlowCard,
  ReviewRequiredCard,
  UnsupportedCard,
} from "@/lib/ai/assistant-types";

function CardShell({
  tone,
  title,
  icon,
  children,
}: {
  tone: "neutral" | "success" | "warning" | "info";
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClasses = {
    neutral: "border-slate-200 bg-slate-50/60",
    success: "border-emerald-200 bg-emerald-50/50",
    warning: "border-amber-200 bg-amber-50/50",
    info: "border-blue-200 bg-blue-50/40",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-3", toneClasses)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {icon}
        {title}
      </p>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

function DocumentRead({ card }: { card: DocumentReadCard }) {
  return (
    <CardShell tone="neutral" title="Document read" icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}>
      <p className="text-sm font-semibold text-slate-900">{card.documentTypeLabel}</p>
      {card.supplier && <p className="text-sm text-slate-700">{card.supplier}</p>}
      {card.periodLabel && <Field label="Period" value={card.periodLabel} />}
      {card.facts.map((fact, i) => (
        <Field key={`${fact.label}-${i}`} label={fact.label} value={fact.value} />
      ))}
      {card.suggestion && <Field label="Suggested" value={card.suggestion} />}

      {card.injectionSuspected && (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-100/70 p-2 text-xs text-amber-900">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This document contains text addressed to an AI system. It was treated as document content only — nothing in it
          was acted on.
        </p>
      )}

      {card.warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-900">
          {card.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <CardLink href={`/documents/${card.documentId}`}>View document</CardLink>
      </div>
    </CardShell>
  );
}

function EntryCreated({ card }: { card: EntryCreatedCard }) {
  return (
    <CardShell tone="success" title="Entry created" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>
      <p className="text-sm font-semibold text-slate-900">{card.dataPointName}</p>
      <Field label="Quantity" value={`${card.quantity} ${card.unit}`} />
      <Field label="Period" value={card.periodLabel} />
      <Field label="Site" value={card.siteName} />
      <Field label="Scope" value={card.scopeLabel} />

      {card.calculations.map((calc) => (
        <div key={calc.calculationId} className="rounded-md border border-emerald-200 bg-white/70 p-2">
          <Field label="Calculated" value={`${calc.kgCo2e} kg CO2e`} />
          <Field label="Basis" value={calc.basisLabel} />
          <Field label="Factor" value={`${calc.factorLabel} — ${calc.factorSource} (${calc.factorVintage})`} />
        </div>
      ))}

      {card.awaitingFactor && (
        <p className="rounded-md bg-amber-100/70 p-2 text-xs text-amber-900">
          The record is saved, but no emission factor is available for this activity and period yet, so it has no
          calculated figure. It will be calculated as soon as a factor is imported.
        </p>
      )}
      {card.flagged && card.flagReason && (
        <p className="rounded-md bg-amber-100/70 p-2 text-xs text-amber-900">
          Flagged for review and excluded from totals until someone confirms it: {card.flagReason}
        </p>
      )}

      <p className="pt-1 text-xs text-slate-500">
        {card.autoLogged
          ? "Recorded automatically because every one of this platform's validation checks passed. The figure above was calculated by the platform, not by AI."
          : "Recorded at your request. The figure above was calculated by the platform, not by AI."}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <CardLink href={`/entry/${card.siteId}`}>View entry</CardLink>
        {card.calculations[0] && <CardLink href={`/calculations/${card.calculations[0].calculationId}`}>View calculation</CardLink>}
        {card.sourceDocumentId && <CardLink href={`/documents/${card.sourceDocumentId}`}>View evidence</CardLink>}
      </div>
    </CardShell>
  );
}

function Duplicate({ card }: { card: DuplicateCard }) {
  return (
    <CardShell tone="info" title="Already recorded" icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}>
      <p className="text-sm text-slate-800">{card.reason}</p>
      {card.existing.map((existing) => (
        <div key={existing.entryId} className="rounded-md border border-blue-200 bg-white/70 p-2">
          <Field label="On file" value={`${existing.quantity} ${existing.unit} — ${existing.dataPointName}`} />
          <Field label="Period" value={existing.periodLabel} />
          <Field label="Site" value={existing.siteName} />
          <Field label="Recorded" value={existing.recordedOn} />
          <div className="flex flex-wrap gap-2 pt-1.5">
            <CardLink href={`/entry/${existing.siteId}`}>View entry</CardLink>
            {existing.sourceDocumentId && <CardLink href={`/documents/${existing.sourceDocumentId}`}>View evidence</CardLink>}
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">
        Nothing was duplicated. If this really is a separate record, say so and I&apos;ll add it.
      </p>
    </CardShell>
  );
}

function ReviewRequired({ card }: { card: ReviewRequiredCard }) {
  return (
    <CardShell tone="warning" title="Review needed" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}>
      <p className="text-sm font-semibold text-slate-900">{card.label}</p>
      <ul className="space-y-1 text-sm text-slate-700">
        {card.reasons.map((reason, i) => (
          <li key={i}>{reason}</li>
        ))}
      </ul>
      {card.question && <p className="text-sm font-medium text-slate-900">{card.question}</p>}
      {card.reviewHref && (
        <div className="flex flex-wrap gap-2 pt-1">
          <CardLink href={card.reviewHref}>Open it</CardLink>
        </div>
      )}
    </CardShell>
  );
}

function Unsupported({ card }: { card: UnsupportedCard }) {
  return (
    <CardShell tone="neutral" title="Kept as evidence" icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}>
      <p className="text-sm font-semibold text-slate-900">{card.label}</p>
      {card.detail && <p className="text-sm text-slate-700">{card.detail}</p>}
      <p className="text-xs text-slate-500">{card.reason}</p>
      {card.documentId && (
        <div className="flex flex-wrap gap-2 pt-1">
          <CardLink href={`/documents/${card.documentId}`}>View document</CardLink>
        </div>
      )}
    </CardShell>
  );
}

function LcaFlow({ card }: { card: LcaFlowCard }) {
  return (
    <CardShell
      tone="success"
      title={card.action === "created" ? "Inventory line added" : "Inventory line updated"}
      icon={<FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />}
    >
      <p className="text-sm font-semibold text-slate-900">{card.name}</p>
      <Field label="Quantity" value={`${card.quantity} ${card.unit}`} />
      <Field label="Process" value={card.processName} />
      <Field label="Stage" value={card.stageLabel} />
      <p className="text-xs text-slate-500">{card.note}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <CardLink href={`/assessments/${card.assessmentId}/inventory/${card.itemId}`}>Open the line</CardLink>
      </div>
    </CardShell>
  );
}

export function AssistantCards({ cards }: { cards: AssistantCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="space-y-2">
      {cards.map((card, i) => {
        switch (card.kind) {
          case "DOCUMENT_READ":
            return <DocumentRead key={`${card.kind}-${i}`} card={card} />;
          case "ENTRY_CREATED":
            return <EntryCreated key={`${card.kind}-${i}`} card={card} />;
          case "DUPLICATE":
            return <Duplicate key={`${card.kind}-${i}`} card={card} />;
          case "REVIEW_REQUIRED":
            return <ReviewRequired key={`${card.kind}-${i}`} card={card} />;
          case "UNSUPPORTED":
            return <Unsupported key={`${card.kind}-${i}`} card={card} />;
          case "LCA_FLOW":
            return <LcaFlow key={`${card.kind}-${i}`} card={card} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Summary line above a batch, so "3 of 4 logged" is visible without reading every card. */
export function BatchSummary({ cards }: { cards: AssistantCard[] }) {
  const created = cards.filter((c) => c.kind === "ENTRY_CREATED").length;
  const duplicates = cards.filter((c) => c.kind === "DUPLICATE").length;
  const review = cards.filter((c) => c.kind === "REVIEW_REQUIRED").length;
  const documents = cards.filter((c) => c.kind === "DOCUMENT_READ").length;

  if (documents < 2 && created + duplicates + review < 2) return null;

  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      {documents > 0 && <Badge tone="neutral">{documents} document{documents === 1 ? "" : "s"} read</Badge>}
      {created > 0 && <Badge tone="success">{created} recorded</Badge>}
      {duplicates > 0 && <Badge tone="info">{duplicates} already on file</Badge>}
      {review > 0 && <Badge tone="warning">{review} need{review === 1 ? "s" : ""} review</Badge>}
    </p>
  );
}
