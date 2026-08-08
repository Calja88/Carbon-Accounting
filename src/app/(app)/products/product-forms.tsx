"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Hint, Notice } from "@/components/lca/ui";
import { emptyProductState } from "@/lib/lca/form-state";
import {
  addManufacturingLocationAction,
  createProductAction,
  createProductVersionAction,
  updateProductAction,
} from "./actions";

export function CreateProductForm({ entities }: { entities: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createProductAction, emptyProductState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New product
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="entityId">Operating unit</Label>
          <Select id="entityId" name="entityId" required className="mt-1">
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sku">SKU / internal code</Label>
          <Input id="sku" name="sku" required className="mt-1" placeholder="e.g. TAG-4820" />
        </div>
        <div>
          <Label htmlFor="name">Product name</Label>
          <Input id="name" name="name" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" className="mt-1" placeholder="e.g. RFID tags" />
          <Hint>Used to group products, and sent as the product category on an exchange document.</Hint>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="firstVersionLabel">First version</Label>
          <Input id="firstVersionLabel" name="firstVersionLabel" required defaultValue="Rev A" className="mt-1" />
          <Hint>
            Assessments attach to a product version, not to the product, so a design change can get its own footprint
            without overwriting the old one.
          </Hint>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create product"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function EditProductForm({
  product,
}: {
  product: {
    id: string;
    name: string;
    sku: string;
    description: string | null;
    category: string | null;
    status: string;
    notes: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(updateProductAction, emptyProductState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="productId" value={product.id} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">Saved.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="name">Product name</Label>
          <Input id="name" name="name" required defaultValue={product.name} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="sku">SKU / internal code</Label>
          <Input id="sku" name="sku" required defaultValue={product.sku} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" defaultValue={product.category ?? ""} className="mt-1" />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={product.status} className="mt-1">
            <option value="ACTIVE">Active</option>
            <option value="DISCONTINUED">Discontinued</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" defaultValue={product.description ?? ""} className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" defaultValue={product.notes ?? ""} className="mt-1" />
        </div>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save product"}
      </Button>
    </form>
  );
}

export function AddVersionForm({ productId }: { productId: string }) {
  const [state, formAction, pending] = useActionState(createProductVersionAction, emptyProductState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add version
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="productId" value={productId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">Version added.</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="versionLabel">Version label</Label>
          <Input id="versionLabel" name="versionLabel" required className="mt-1" placeholder="Rev B" />
        </div>
        <div>
          <Label htmlFor="effectiveFrom">Effective from</Label>
          <Input id="effectiveFrom" name="effectiveFrom" type="date" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="versionDescription">What changed</Label>
          <Input id="versionDescription" name="description" className="mt-1" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add version"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AddLocationForm({
  productId,
  versions,
  sites,
}: {
  productId: string;
  versions: { id: string; versionLabel: string }[];
  sites: { id: string; name: string; entityName: string }[];
}) {
  const [state, formAction, pending] = useActionState(addManufacturingLocationAction, emptyProductState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add manufacturing location
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="productId" value={productId} />
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">Location added.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="productVersionId">Version</Label>
          <Select id="productVersionId" name="productVersionId" required className="mt-1">
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.versionLabel}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="locationName">Location name</Label>
          <Input id="locationName" name="name" required className="mt-1" />
        </div>
        <div>
          <Label htmlFor="country">Country</Label>
          <Input id="country" name="country" className="mt-1" placeholder="GB" />
        </div>
        <div>
          <Label htmlFor="siteId">Internal site (optional)</Label>
          <Select id="siteId" name="siteId" className="mt-1">
            <option value="">Not one of our sites</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.entityName} — {site.name}
              </option>
            ))}
          </Select>
          <Hint>
            Linking to one of our own sites lets an assessment cite that site&apos;s corporate energy records as the source
            for its manufacturing data.
          </Hint>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isPrimary" className="h-4 w-4 rounded border-slate-300" />
            Primary manufacturing location
          </label>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add location"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
