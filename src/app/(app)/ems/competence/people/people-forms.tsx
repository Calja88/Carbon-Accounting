"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createPersonProfileAction,
  updatePersonProfileAction,
  setPersonSensitiveProfileAction,
  deactivatePersonProfileAction,
  reactivatePersonProfileAction,
  type PersonActionState,
} from "./actions";

const emptyState: PersonActionState = { error: null, message: null };

type Option = { id: string; name: string };

export type PersonListRow = {
  id: string;
  name: string;
  personType: string;
  isActive: boolean;
  entityId: string | null;
  siteId: string | null;
};

function Feedback({ state }: { state: PersonActionState }) {
  return (
    <>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p aria-live="polite" className="text-sm text-emerald-700">{state.message}</p>}
    </>
  );
}

export function CreatePersonForm({
  memberships,
  entities,
  sites,
  canViewSensitive,
}: {
  memberships: Option[];
  entities: Option[];
  sites: Option[];
  canViewSensitive: boolean;
}) {
  const [state, formAction, pending] = useActionState(createPersonProfileAction, emptyState);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-semibold text-slate-900">Add a person</h2>
        <p className="text-sm text-slate-500">
          Link an existing login identity, or enter a display name for a contractor/other person without one. Login
          identity and profile are linked, never duplicated.
        </p>
        <form action={formAction} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="personType">Type</Label>
            <Select id="personType" name="personType" defaultValue="EMPLOYEE" required>
              <option value="EMPLOYEE">Employee</option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="OTHER">Other</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="membershipId">Linked login identity (optional)</Label>
            <Select id="membershipId" name="membershipId" defaultValue="">
              <option value="">— none —</option>
              {memberships.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="displayName">Display name (only when no login identity)</Label>
            <Input id="displayName" name="displayName" placeholder="Synthetic example: Jordan Ellis (Contractor)" />
          </div>
          <div>
            <Label htmlFor="entityId">Entity</Label>
            <Select id="entityId" name="entityId" defaultValue="">
              <option value="">—</option>
              {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="siteId">Site</Label>
            <Select id="siteId" name="siteId" defaultValue="">
              <option value="">—</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          {canViewSensitive && (
            <>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Restricted contact detail (visible only with the sensitive-profile permission)
                </p>
              </div>
              <div>
                <Label htmlFor="contactEmail">Contact email (optional)</Label>
                <Input id="contactEmail" name="contactEmail" type="email" placeholder="synthetic@example.test" />
              </div>
              <div>
                <Label htmlFor="contactPhone">Contact phone (optional)</Label>
                <Input id="contactPhone" name="contactPhone" placeholder="+00 0000 000000" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea id="notes" name="notes" rows={2} placeholder="Synthetic notes only." />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <Feedback state={state} />
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add person"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PersonList({ people }: { people: PersonListRow[] }) {
  if (people.length === 0) {
    return <p className="text-sm text-slate-500">No people visible to you yet.</p>;
  }
  return (
    <div className="space-y-2">
      {people.map((person) => (
        <Link
          key={person.id}
          href={`/ems/competence/people/${person.id}`}
          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 hover:border-blue-300"
        >
          <div>
            <p className="font-medium text-slate-900">{person.name}</p>
            <p className="text-sm text-slate-500">{person.personType}</p>
          </div>
          <div className="flex items-center gap-2">
            {!person.isActive && <Badge tone="neutral">Inactive</Badge>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function EditPersonForm({ personId, entities, sites, defaultDisplayName, hasMembership, currentEntityId, currentSiteId }: {
  personId: string;
  entities: Option[];
  sites: Option[];
  defaultDisplayName: string | null;
  hasMembership: boolean;
  currentEntityId: string | null;
  currentSiteId: string | null;
}) {
  const [state, formAction, pending] = useActionState(updatePersonProfileAction, emptyState);
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="personId" value={personId} />
      {!hasMembership && (
        <div>
          <Label htmlFor="edit-displayName">Display name</Label>
          <Input id="edit-displayName" name="displayName" defaultValue={defaultDisplayName ?? ""} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="edit-entityId">Entity</Label>
          <Select id="edit-entityId" name="entityId" defaultValue={currentEntityId ?? ""}>
            <option value="">—</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="edit-siteId">Site</Label>
          <Select id="edit-siteId" name="siteId" defaultValue={currentSiteId ?? ""}>
            <option value="">—</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}

export function SensitiveProfileForm({ personId, contactEmail, contactPhone, notes }: {
  personId: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
}) {
  const [state, formAction, pending] = useActionState(setPersonSensitiveProfileAction, emptyState);
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <input type="hidden" name="personId" value={personId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="sensitive-contactEmail">Contact email</Label>
          <Input id="sensitive-contactEmail" name="contactEmail" type="email" defaultValue={contactEmail ?? ""} />
        </div>
        <div>
          <Label htmlFor="sensitive-contactPhone">Contact phone</Label>
          <Input id="sensitive-contactPhone" name="contactPhone" defaultValue={contactPhone ?? ""} />
        </div>
      </div>
      <div>
        <Label htmlFor="sensitive-notes">Notes</Label>
        <Textarea id="sensitive-notes" name="notes" rows={3} defaultValue={notes ?? ""} />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save restricted contact detail"}</Button>
    </form>
  );
}

export function DeactivatePersonButton({ personId }: { personId: string }) {
  const [state, formAction, pending] = useActionState(deactivatePersonProfileAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="personId" value={personId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Deactivating…" : "Deactivate person"}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function ReactivatePersonButton({ personId }: { personId: string }) {
  const [state, formAction, pending] = useActionState(reactivatePersonProfileAction, emptyState);
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="personId" value={personId} />
      <Button type="submit" disabled={pending}>{pending ? "Reactivating…" : "Reactivate person"}</Button>
      <Feedback state={state} />
    </form>
  );
}
