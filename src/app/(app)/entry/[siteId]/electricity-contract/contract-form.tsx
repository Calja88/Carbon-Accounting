"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { submitContractAction, ContractFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const initialState: ContractFormState = { error: null, success: false };

export function ContractForm({
  site,
  supplierPrompt,
  regoPrompt,
  existing,
}: {
  site: { id: string; name: string };
  supplierPrompt: string;
  regoPrompt: string;
  existing: { supplierName: string; tariffType: string; regoBacked: boolean; regoVolumeKwh: string | null } | null;
}) {
  const [state, formAction, pending] = useActionState(submitContractAction, initialState);
  const [regoBacked, setRegoBacked] = useState(existing?.regoBacked ? "yes" : "no");

  if (state.success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <h1 className="text-lg font-semibold text-emerald-900">Thanks — that&apos;s saved.</h1>
        <p className="mt-2 text-sm text-emerald-800">
          This will be used for the market-based electricity calculation for {site.name}.
        </p>
        <Link href={`/entry/${site.id}`} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:text-brand-800">
          ← Back to {site.name}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <input type="hidden" name="siteId" value={site.id} />

      <div>
        <h1 className="text-xl font-semibold text-slate-900">{supplierPrompt}</h1>
        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <Label htmlFor="supplierName">Supplier name</Label>
            <Input
              id="supplierName"
              name="supplierName"
              required
              defaultValue={existing?.supplierName}
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor="tariffType">Tariff type</Label>
            <Select id="tariffType" name="tariffType" defaultValue={existing?.tariffType ?? "STANDARD"} className="mt-1">
              <option value="STANDARD">Standard</option>
              <option value="GREEN">Green / renewable</option>
            </Select>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">{regoPrompt}</h2>
        <div className="mt-3 flex items-end gap-3">
          <div>
            <Label htmlFor="regoBacked">REGO / guarantee of origin held?</Label>
            <Select
              id="regoBacked"
              name="regoBacked"
              value={regoBacked}
              onChange={(e) => setRegoBacked(e.target.value)}
              className="mt-1"
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </div>
          {regoBacked === "yes" && (
            <div>
              <Label htmlFor="regoVolumeKwh">Volume covered (kWh, optional)</Label>
              <Input
                id="regoVolumeKwh"
                name="regoVolumeKwh"
                type="number"
                step="any"
                min="0"
                defaultValue={existing?.regoVolumeKwh ?? undefined}
                className="mt-1"
              />
            </div>
          )}
        </div>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
