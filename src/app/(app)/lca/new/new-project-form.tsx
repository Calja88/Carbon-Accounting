"use client";

import { useActionState } from "react";
import { createLcaProjectAction, type CreateProjectState } from "../actions";
import { BOUNDARY_TYPE_LABELS } from "@/lib/lca/stages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: CreateProjectState = { error: null };

export function NewProjectForm({
  entities,
  sites,
}: {
  entities: { id: string; name: string }[];
  sites: { id: string; name: string; entityName: string }[];
}) {
  const [state, formAction, pending] = useActionState(createLcaProjectAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="name">Study name</Label>
        <Input id="name" name="name" required className="mt-1" placeholder="e.g. RFID inlay — cradle-to-gate 2026" />
      </div>

      <div>
        <Label htmlFor="productName">Product or service being assessed</Label>
        <Input id="productName" name="productName" required className="mt-1" placeholder="e.g. UHF RFID inlay, 50 x 30 mm" />
      </div>

      <div>
        <Label htmlFor="description">Description (optional)</Label>
        <textarea
          id="description"
          name="description"
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="entityId">Entity (optional)</Label>
          <Select id="entityId" name="entityId" defaultValue="" className="mt-1">
            <option value="">— group-level —</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="siteId">Site (optional)</Label>
          <Select id="siteId" name="siteId" defaultValue="" className="mt-1">
            <option value="">— not site-specific —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.entityName}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="boundaryType">System boundary</Label>
        <Select id="boundaryType" name="boundaryType" defaultValue="CRADLE_TO_GATE" className="mt-1">
          {Object.entries(BOUNDARY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-slate-400">
          This seeds the life cycle stages. Stages outside the boundary are still created, marked excluded with the
          reason recorded — an exclusion you can see is a methodological statement; one you can&apos;t is a hole in the
          study. You can change all of it afterwards.
        </p>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create study"}
      </Button>
    </form>
  );
}
