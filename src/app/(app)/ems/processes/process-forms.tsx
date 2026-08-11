"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  createProcessAction,
  reviseProcessAction,
  activateProcessAction,
  archiveProcessAction,
  applyTemplateAction,
  type ProcessActionState,
} from "./actions";

const emptyState: ProcessActionState = { error: null, message: null };

const LIFECYCLE_STAGE_LABELS: Record<string, string> = {
  RAW_MATERIAL_ACQUISITION: "Raw material acquisition",
  DESIGN: "Design",
  PRODUCTION: "Production",
  TRANSPORTATION_DELIVERY: "Transportation / delivery",
  USE: "Use",
  END_OF_LIFE_TREATMENT: "End-of-life treatment",
  OTHER: "Other",
};

const OPERATING_CONDITION_LABELS: Record<string, string> = {
  NORMAL: "Normal",
  ABNORMAL: "Abnormal",
  STARTUP_SHUTDOWN: "Startup/shutdown",
  MAINTENANCE: "Maintenance",
  EMERGENCY: "Emergency",
};

export interface ProcessRow {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED";
  activityType: "ACTIVITY" | "PRODUCT" | "SERVICE";
  lifecycleStage: string | null;
  operatingCondition: string;
  siteId: string | null;
  programmeId: string;
  sourceTemplateId: string | null;
  createdAt: string;
}

export interface TemplateOption {
  id: string;
  key: string;
  name: string;
  siteLabel: string;
  description: string;
  itemCount: number;
}

export interface ProgrammeOption {
  id: string;
  name: string;
  status: string;
}

export interface SiteOption {
  id: string;
  name: string;
}

function StatusBadge({ status }: { status: ProcessRow["status"] }) {
  if (status === "ACTIVE") return <Badge tone="success">Active</Badge>;
  if (status === "DRAFT") return <Badge tone="info">Draft</Badge>;
  if (status === "SUPERSEDED") return <Badge tone="neutral">Superseded</Badge>;
  return <Badge tone="warning">Archived</Badge>;
}

function ApplyTemplateForm({ templates, programmes, sites }: { templates: TemplateOption[]; programmes: ProgrammeOption[]; sites: SiteOption[] }) {
  const [state, formAction, pending] = useActionState(applyTemplateAction, emptyState);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply a structural starter template</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="apply-programmeId">EMS programme</Label>
              <Select id="apply-programmeId" name="programmeId" required className="mt-1">
                <option value="">Select…</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="apply-templateId">Template</Label>
              <Select id="apply-templateId" name="templateId" required className="mt-1">
                <option value="">Select…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.itemCount} items)
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="apply-siteId">Site</Label>
              <Select id="apply-siteId" name="siteId" required className="mt-1">
                <option value="">Select…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
            <input
              type="checkbox"
              name="confirm"
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span className="text-slate-700">
              I confirm I want to apply this template. It creates draft process/activity profiles only — structure
              (name, type, suggested lifecycle stage/operating condition) with no aspect scores or environmental
              measurements. Applying the same template to the same site again is safe and will not duplicate
              anything already created.
            </span>
          </label>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}

          <Button type="submit" disabled={pending || !confirmed}>
            {pending ? "Applying…" : "Apply template"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CreateProcessForm({ programmes, sites }: { programmes: ProgrammeOption[]; sites: SiteOption[] }) {
  const [state, formAction, pending] = useActionState(createProcessAction, emptyState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a process/activity profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="create-name">Name</Label>
              <Input id="create-name" name="name" required className="mt-1" placeholder="e.g. Card production line" />
            </div>
            <div>
              <Label htmlFor="create-programmeId">EMS programme</Label>
              <Select id="create-programmeId" name="programmeId" required className="mt-1">
                <option value="">Select…</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="create-siteId">Site (optional)</Label>
              <Select id="create-siteId" name="siteId" className="mt-1">
                <option value="">Organisation-wide</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="create-activityType">Type</Label>
              <Select id="create-activityType" name="activityType" defaultValue="ACTIVITY" className="mt-1">
                <option value="ACTIVITY">Activity</option>
                <option value="PRODUCT">Product</option>
                <option value="SERVICE">Service</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="create-lifecycleStage">Lifecycle stage (optional)</Label>
              <Select id="create-lifecycleStage" name="lifecycleStage" defaultValue="" className="mt-1">
                <option value="">Not set</option>
                {Object.entries(LIFECYCLE_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="create-operatingCondition">Operating condition</Label>
              <Select id="create-operatingCondition" name="operatingCondition" defaultValue="NORMAL" className="mt-1">
                {Object.entries(OPERATING_CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}

          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReviseProcessForm({ processId, currentName }: { processId: string; currentName: string }) {
  const [state, formAction, pending] = useActionState(reviseProcessAction, emptyState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Revise
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="processId" value={processId} />
      <Input name="name" defaultValue={currentName} className="w-56" />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save revision"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function StatusActionForm({ processId, action, label }: { processId: string; action: typeof activateProcessAction; label: string }) {
  const [, formAction, pending] = useActionState(action, emptyState);
  return (
    <form action={formAction}>
      <input type="hidden" name="processId" value={processId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "…" : label}
      </Button>
    </form>
  );
}

function ProcessList({ processes, canEdit }: { processes: ProcessRow[]; canEdit: boolean }) {
  if (processes.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-slate-500">
          No process/activity profiles yet. Apply a starter template or add one by hand.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {processes.map((p) => (
        <Card key={p.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{p.name}</span>
                <StatusBadge status={p.status} />
                {p.sourceTemplateId && <Badge tone="info">From template</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {p.activityType.toLowerCase()}
                {p.lifecycleStage ? ` · ${LIFECYCLE_STAGE_LABELS[p.lifecycleStage] ?? p.lifecycleStage}` : ""} ·{" "}
                {OPERATING_CONDITION_LABELS[p.operatingCondition] ?? p.operatingCondition}
              </p>
            </div>
            {canEdit && (p.status === "DRAFT" || p.status === "ACTIVE") && (
              <div className="flex flex-wrap items-center gap-2">
                <ReviseProcessForm processId={p.id} currentName={p.name} />
                {p.status === "DRAFT" && <StatusActionForm processId={p.id} action={activateProcessAction} label="Activate" />}
                <StatusActionForm processId={p.id} action={archiveProcessAction} label="Archive" />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ProcessManagement({
  processes,
  templates,
  programmes,
  sites,
  canEdit,
}: {
  processes: ProcessRow[];
  templates: TemplateOption[];
  programmes: ProgrammeOption[];
  sites: SiteOption[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-8">
      {canEdit && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ApplyTemplateForm templates={templates} programmes={programmes} sites={sites} />
          <CreateProcessForm programmes={programmes} sites={sites} />
        </div>
      )}
      <ProcessList processes={processes} canEdit={canEdit} />
    </div>
  );
}
