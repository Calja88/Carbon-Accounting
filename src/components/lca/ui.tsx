import Link from "next/link";
import { AlertTriangle, CircleAlert, Info, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/lca/labels";
import { READINESS_LABELS, READINESS_TONES, type ReadinessState } from "@/lib/lca/readiness-service";
import type { LcaAssessmentStatus } from "@prisma/client";

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</div>}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <div className="mt-1.5 max-w-3xl text-sm text-slate-600">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: LcaAssessmentStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function ReadinessBadge({ state }: { state: ReadinessState }) {
  return <Badge tone={READINESS_TONES[state]}>{READINESS_LABELS[state]}</Badge>;
}

/** A figure with its unit and a caption, used across the results surfaces. */
export function Stat({
  label,
  value,
  unit,
  caption,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  caption?: React.ReactNode;
  tone?: "default" | "muted" | "negative";
}) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "muted" ? "text-slate-500" : tone === "negative" ? "text-emerald-700" : "text-slate-900",
        )}
      >
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span>}
      </div>
      {caption && <div className="mt-1 text-xs text-slate-500">{caption}</div>}
    </div>
  );
}

const NOTICE_STYLES = {
  info: { wrapper: "border-blue-200 bg-blue-50 text-blue-900", Icon: Info },
  warning: { wrapper: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  danger: { wrapper: "border-red-200 bg-red-50 text-red-900", Icon: CircleAlert },
  success: { wrapper: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CircleCheck },
} as const;

export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: keyof typeof NOTICE_STYLES;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { wrapper, Icon } = NOTICE_STYLES[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", wrapper)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-slate-500">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Definition list used for goal/scope, methodology and factor summaries. */
export function FieldList({ items }: { items: { label: string; value: React.ReactNode; hint?: string }[] }) {
  return (
    <dl className="divide-y divide-slate-100">
      {items.map((item) => (
        <div key={item.label} className="grid gap-1 py-2.5 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm font-medium text-slate-600">
            {item.label}
            {item.hint && <span className="mt-0.5 block text-xs font-normal text-slate-400">{item.hint}</span>}
          </dt>
          <dd className="text-sm text-slate-900 sm:col-span-2">{item.value ?? <span className="text-slate-400">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataTable({
  headers,
  children,
  caption,
}: {
  headers: (string | { label: string; align?: "left" | "right" })[];
  children: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        {caption && <caption className="pb-2 text-left text-xs text-slate-500">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200">
            {headers.map((header, i) => {
              const label = typeof header === "string" ? header : header.label;
              const align = typeof header === "string" ? "left" : (header.align ?? "left");
              return (
                <th
                  key={`${label}-${i}`}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500",
                    align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = "left",
  className,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn("px-3 py-2.5 align-top text-slate-700", align === "right" && "text-right tabular-nums", className)}
    >
      {children}
    </td>
  );
}

/**
 * Short contextual guidance next to a term. Written in this platform's own
 * words — standards text is not reproduced here.
 */
export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs leading-relaxed text-slate-500">{children}</p>;
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-slate-500 hover:text-slate-800">
      ← {children}
    </Link>
  );
}

/** Placeholder-factor warning, shown wherever a figure could be misread as real. */
export function PlaceholderFactorWarning({ percent }: { percent: number }) {
  if (percent <= 0) return null;
  return (
    <Notice tone="danger" title="Placeholder emission factors in use">
      {percent.toFixed(1)}% of this footprint is priced from factors flagged as placeholders. They are illustrative
      magnitudes shipped so the platform could be exercised end to end — not published figures. Import a real factor set
      through Admin → Emission factors and reassign the affected lines. Until then this assessment cannot be marked ready
      for verification.
    </Notice>
  );
}
