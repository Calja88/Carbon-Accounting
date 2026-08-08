"use client";

import { useActionState, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { LcaBoundary, LcaPcfVerificationStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { BOUNDARY_LABELS, PCF_VERIFICATION_LABELS } from "@/lib/lca/labels";
import { CONFORMANCE_NOTICE } from "@/lib/lca/pact/types";
import { emptySupplierState } from "@/lib/lca/form-state";
import { createSupplierAction, createSupplierPcfAction, importPactDocumentAction } from "./actions";

export function CreateSupplierForm({ entities }: { entities: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createSupplierAction, emptySupplierState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add supplier
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="supplierEntity">Operating unit</Label>
          <Select id="supplierEntity" name="entityId" required className="mt-1">
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="supplierName">Supplier name</Label>
          <Input id="supplierName" name="name" required className="mt-1" />
          <Hint>
            Keep this matching the name used on corporate activity entries, so the two views of the same counterparty can
            be recognised.
          </Hint>
        </div>
        <div>
          <Label htmlFor="supplierIdentifier">Identifier</Label>
          <Input id="supplierIdentifier" name="identifier" className="mt-1" placeholder="Supplier code, DUNS, VAT number" />
        </div>
        <div>
          <Label htmlFor="supplierCountry">Country</Label>
          <Input id="supplierCountry" name="country" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="supplierContact">Contact</Label>
          <Input id="supplierContact" name="contact" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="supplierNotes">Notes</Label>
          <Textarea id="supplierNotes" name="notes" rows={2} className="mt-1" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Add supplier"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function SupplierPcfForm({
  suppliers,
  defaultEntityId,
}: {
  suppliers: { id: string; name: string; entityId: string }[];
  defaultEntityId: string;
}) {
  const [state, formAction, pending] = useActionState(createSupplierPcfAction, emptySupplierState);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");

  if (suppliers.length === 0) return null;

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Record a supplier footprint
      </Button>
    );
  }

  const entityId = suppliers.find((s) => s.id === supplierId)?.entityId ?? defaultEntityId;

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      <input type="hidden" name="entityId" value={entityId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="pcfSupplier">Supplier</Label>
          <Select id="pcfSupplier" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1">
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pcfProductName">Their product</Label>
          <Input id="pcfProductName" name="productName" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfProductIdentifier">Their product code</Label>
          <Input id="pcfProductIdentifier" name="productIdentifier" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfValue">Footprint (kgCO2e)</Label>
          <Input id="pcfValue" name="pcfValue" required className="mt-1" />
          <Hint>Excluding biogenic where the supplier reports the two separately.</Hint>
        </div>
        <div>
          <Label htmlFor="declaredUnitQuantity">Per quantity</Label>
          <Input id="declaredUnitQuantity" name="declaredUnitQuantity" defaultValue="1" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="declaredUnitUnit">Declared unit</Label>
          <Input id="declaredUnitUnit" name="declaredUnitUnit" required defaultValue="kg" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfBiogenicValue">Biogenic (kgCO2e)</Label>
          <Input id="pcfBiogenicValue" name="pcfBiogenicValue" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfBoundary">Boundary</Label>
          <Select id="pcfBoundary" name="boundary" defaultValue={LcaBoundary.CRADLE_TO_GATE} className="mt-1">
            {Object.entries(BOUNDARY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pcfGeography">Geography</Label>
          <Input id="pcfGeography" name="geography" className="mt-1" />
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="pcfBoundaryNotes">What the figure covers</Label>
          <Input id="pcfBoundaryNotes" name="boundaryNotes" className="mt-1" />
          <Hint>Required in practice for a custom boundary — a figure whose scope is unknown cannot be relied on.</Hint>
        </div>
        <div>
          <Label htmlFor="pcfMethodology">Methodology</Label>
          <Input id="pcfMethodology" name="methodology" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfMethodologyVersion">Methodology version</Label>
          <Input id="pcfMethodologyVersion" name="methodologyVersion" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfGwpBasis">GWP basis</Label>
          <Input id="pcfGwpBasis" name="gwpBasis" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="reportingPeriodStart">Reporting period start</Label>
          <Input id="reportingPeriodStart" name="reportingPeriodStart" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="reportingPeriodEnd">Reporting period end</Label>
          <Input id="reportingPeriodEnd" name="reportingPeriodEnd" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="primaryDataSharePercent">Primary data share (%)</Label>
          <Input id="primaryDataSharePercent" name="primaryDataSharePercent" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="verificationStatus">Verification</Label>
          <Select id="verificationStatus" name="verificationStatus" defaultValue={LcaPcfVerificationStatus.UNVERIFIED} className="mt-1">
            {Object.entries(PCF_VERIFICATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="verifierName">Verifier</Label>
          <Input id="verifierName" name="verifierName" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="verificationDate">Verification date</Label>
          <Input id="verificationDate" name="verificationDate" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pcfUncertaintyPercent">Uncertainty (%)</Label>
          <Input id="pcfUncertaintyPercent" name="uncertaintyPercent" className="mt-1" />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h5 className="text-sm font-semibold text-slate-800">Data quality as the supplier reports it (1 best, 5 worst)</h5>
        <div className="mt-2 grid gap-3 sm:grid-cols-5">
          {[
            ["temporalScore", "Temporal"],
            ["geographicalScore", "Geographical"],
            ["technologicalScore", "Technological"],
            ["completenessScore", "Completeness"],
            ["reliabilityScore", "Reliability"],
          ].map(([name, label]) => (
            <div key={name}>
              <Label htmlFor={name} className="text-xs">
                {label}
              </Label>
              <Select id={name} name={name} defaultValue="" className="mt-1">
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((score) => (
                  <option key={score} value={score}>
                    {score}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="pcfNotes">Notes</Label>
        <Textarea id="pcfNotes" name="notes" rows={2} className="mt-1" />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Record footprint"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function PactImportForm({
  entities,
  suppliers,
}: {
  entities: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(importPactDocumentAction, emptySupplierState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import an exchange document
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left">
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.message}</Notice>}
      {state.warnings && state.warnings.length > 0 && (
        <Notice tone="warning" title="Worth checking">
          <ul className="ml-4 list-disc space-y-0.5">
            {state.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Notice tone="info" title="PACT-aligned import">
        {CONFORMANCE_NOTICE} Anything the adapter does not recognise is kept verbatim on the record rather than dropped,
        and anything required but missing is reported instead of guessed.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pactEntity">Operating unit</Label>
          <Select id="pactEntity" name="entityId" required className="mt-1">
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="pactSupplier">Supplier</Label>
          <Select id="pactSupplier" name="supplierId" className="mt-1">
            <option value="">Match or create from the document</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="pactFile">Document</Label>
          <Input id="pactFile" name="file" type="file" accept=".json,application/json" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="pactDocument">…or paste the JSON</Label>
          <Textarea id="pactDocument" name="document" rows={5} className="mt-1 font-mono text-xs" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Importing…" : "Import document"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
