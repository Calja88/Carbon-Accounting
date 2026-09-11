"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createAgendaTemplateAction,
  updateAgendaTemplateVersionDraftAction,
  approveAgendaTemplateVersionAction,
  activateAgendaTemplateVersionAction,
  createSuccessorAgendaTemplateVersionAction,
  type ReviewActionState,
} from "../actions";

const emptyState: ReviewActionState = { error: null, message: null };

export type AgendaTemplateItemRow = { id: string; order: number; title: string; description: string | null; inputDefinitionKey: string | null };
export type AgendaTemplateVersionRow = {
  id: string;
  version: number;
  name: string;
  status: string;
  revisionRationale: string | null;
  items: AgendaTemplateItemRow[];
};
export type AgendaTemplateRow = {
  id: string;
  templateKey: string;
  name: string;
  activeVersionId: string | null;
  versions: AgendaTemplateVersionRow[];
};

function Feedback({ state }: { state: ReviewActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

function versionStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "ACTIVE") return "success";
  if (status === "APPROVED") return "info";
  if (status === "SUPERSEDED") return "neutral";
  return "warning";
}

function itemsToTemplateJson(items: AgendaTemplateItemRow[]): string {
  return JSON.stringify(
    items.map((item) => ({ order: item.order, title: item.title, description: item.description ?? "", inputDefinitionKey: item.inputDefinitionKey ?? "" })),
    null,
    2,
  );
}

const NEW_TEMPLATE_PLACEHOLDER = JSON.stringify(
  [
    { order: 1, title: "Status of actions from previous reviews", description: "", inputDefinitionKey: "" },
    { order: 2, title: "Changes in external/internal issues relevant to the EMS", description: "", inputDefinitionKey: "" },
  ],
  null,
  2,
);

function CreateTemplateForm({ inputDefinitionKeys }: { inputDefinitionKeys: string[] }) {
  const [state, action, pending] = useActionState(createAgendaTemplateAction, emptyState);
  return (
    <form action={action} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <h3 className="font-medium text-slate-900">New agenda template</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="new-template-key">Template key</Label>
          <Input id="new-template-key" name="templateKey" required placeholder="e.g. standard-annual" />
        </div>
        <div>
          <Label htmlFor="new-template-name">Name</Label>
          <Input id="new-template-name" name="name" required placeholder="e.g. Standard annual management review" />
        </div>
      </div>
      <div>
        <Label htmlFor="new-template-items">Agenda items (JSON array of order/title/description/inputDefinitionKey)</Label>
        <Textarea id="new-template-items" name="itemsJson" required rows={8} defaultValue={NEW_TEMPLATE_PLACEHOLDER} className="font-mono text-xs" />
        {inputDefinitionKeys.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">Known input keys: {inputDefinitionKeys.join(", ")}</p>
        )}
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Draft template"}</Button>
    </form>
  );
}

function EditDraftForm({ version, inputDefinitionKeys }: { version: AgendaTemplateVersionRow; inputDefinitionKeys: string[] }) {
  const [state, action, pending] = useActionState(updateAgendaTemplateVersionDraftAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded border border-dashed border-slate-300 p-3">
      <input type="hidden" name="versionId" value={version.id} />
      <div>
        <Label htmlFor={`draft-name-${version.id}`}>Name</Label>
        <Input id={`draft-name-${version.id}`} name="name" required defaultValue={version.name} />
      </div>
      <div>
        <Label htmlFor={`draft-items-${version.id}`}>Agenda items (JSON)</Label>
        <Textarea id={`draft-items-${version.id}`} name="itemsJson" required rows={8} defaultValue={itemsToTemplateJson(version.items)} className="font-mono text-xs" />
        {inputDefinitionKeys.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">Known input keys: {inputDefinitionKeys.join(", ")}</p>
        )}
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving..." : "Save draft"}</Button>
    </form>
  );
}

function ApproveButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState(approveAgendaTemplateVersionAction, emptyState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Approving..." : "Approve"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function ActivateButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState(activateAgendaTemplateVersionAction, emptyState);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="versionId" value={versionId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>{pending ? "Activating..." : "Activate"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function SuccessorForm({ templateId, latest, inputDefinitionKeys }: { templateId: string; latest: AgendaTemplateVersionRow; inputDefinitionKeys: string[] }) {
  const [state, action, pending] = useActionState(createSuccessorAgendaTemplateVersionAction, emptyState);
  return (
    <form action={action} className="space-y-3 rounded border border-slate-200 p-3">
      <input type="hidden" name="templateId" value={templateId} />
      <h5 className="text-sm font-semibold text-slate-700">Create successor version (revises v{latest.version})</h5>
      <div>
        <Label htmlFor={`successor-name-${templateId}`}>Name</Label>
        <Input id={`successor-name-${templateId}`} name="name" required defaultValue={latest.name} />
      </div>
      <div>
        <Label htmlFor={`successor-items-${templateId}`}>Agenda items (JSON)</Label>
        <Textarea id={`successor-items-${templateId}`} name="itemsJson" required rows={8} defaultValue={itemsToTemplateJson(latest.items)} className="font-mono text-xs" />
        {inputDefinitionKeys.length > 0 && (
          <p className="mt-1 text-xs text-slate-500">Known input keys: {inputDefinitionKeys.join(", ")}</p>
        )}
      </div>
      <div>
        <Label htmlFor={`successor-rationale-${templateId}`}>Revision rationale</Label>
        <Textarea id={`successor-rationale-${templateId}`} name="revisionRationale" required rows={2} placeholder="Why this version replaces the previous one" />
      </div>
      <Feedback state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Creating..." : "Create successor version"}</Button>
    </form>
  );
}

function TemplateCard({ template, inputDefinitionKeys }: { template: AgendaTemplateRow; inputDefinitionKeys: string[] }) {
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const sortedVersions = [...template.versions].sort((a, b) => b.version - a.version);
  const latest = sortedVersions[0] ?? null;
  const latestIsDraft = latest?.status === "DRAFT";

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{template.name}</h3>
            <p className="text-sm text-slate-500">{template.templateKey}</p>
          </div>
        </div>

        <ul className="space-y-3">
          {sortedVersions.map((version) => (
            <li key={version.id} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900">v{version.version}</span>
                  <Badge tone={versionStatusTone(version.status)}>{version.status}</Badge>
                  {template.activeVersionId === version.id && <Badge tone="success">Pinned as active</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {version.status === "DRAFT" && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setExpandedVersionId(expandedVersionId === version.id ? null : version.id)}>
                      {expandedVersionId === version.id ? "Hide editor" : "Edit draft"}
                    </Button>
                  )}
                  {version.status === "DRAFT" && <ApproveButton versionId={version.id} />}
                  {version.status === "APPROVED" && <ActivateButton versionId={version.id} />}
                </div>
              </div>
              {version.revisionRationale && <p className="mt-1 text-sm text-slate-500">Rationale: {version.revisionRationale}</p>}
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {version.items.map((item) => (
                  <li key={item.id}>
                    <span className="font-medium text-slate-900">{item.title}</span>
                    {item.description && <span className="text-slate-500"> — {item.description}</span>}
                    {item.inputDefinitionKey && <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{item.inputDefinitionKey}</span>}
                  </li>
                ))}
              </ol>
              {version.status === "DRAFT" && expandedVersionId === version.id && (
                <div className="mt-3">
                  <EditDraftForm version={version} inputDefinitionKeys={inputDefinitionKeys} />
                </div>
              )}
            </li>
          ))}
        </ul>

        {latest && !latestIsDraft && (
          <SuccessorForm templateId={template.id} latest={latest} inputDefinitionKeys={inputDefinitionKeys} />
        )}
      </CardContent>
    </Card>
  );
}

export function AgendaTemplateWorkspace({ templates, inputDefinitionKeys }: { templates: AgendaTemplateRow[]; inputDefinitionKeys: string[] }) {
  return (
    <div className="space-y-8">
      <CreateTemplateForm inputDefinitionKeys={inputDefinitionKeys} />
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Templates</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-500">No agenda templates yet.</p>
        ) : (
          templates.map((template) => (
            <TemplateCard key={template.id} template={template} inputDefinitionKeys={inputDefinitionKeys} />
          ))
        )}
      </div>
    </div>
  );
}
