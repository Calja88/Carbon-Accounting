"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  assignRoleAction,
  inviteMemberAction,
  reactivateMembershipAction,
  removeMembershipAction,
  resendInvitationAction,
  revokeInvitationAction,
  suspendMembershipAction,
  unassignRoleAction,
  type MembersActionState,
} from "./actions";

const emptyState: MembersActionState = { error: null, message: null, inviteLink: null };

export interface MemberRow {
  id: string;
  email: string;
  name: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  accessMode: "ORGANISATION_WIDE" | "RESTRICTED";
  invitedAt: string;
  activatedAt: string | null;
  isRoleManager: boolean;
  roles: { id: string; name: string }[];
}

export interface RoleOption {
  id: string;
  name: string;
  isDangerous: boolean;
}

function StatusBadge({ status }: { status: MemberRow["status"] }) {
  if (status === "ACTIVE") return <Badge tone="success">Active</Badge>;
  if (status === "INVITED") return <Badge tone="info">Invited</Badge>;
  if (status === "SUSPENDED") return <Badge tone="warning">Suspended</Badge>;
  return <Badge tone="neutral">Removed</Badge>;
}

function InviteForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, emptyState);
  const [selected, setSelected] = useState<string[]>([]);
  const dangerousSelected = roles.filter((r) => selected.includes(r.id) && r.isDangerous);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a member</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required className="mt-1" placeholder="name@example.com" />
          </div>
          <div>
            <Label>Roles</Label>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={role.id}
                    className="h-4 w-4 rounded border-slate-300"
                    onChange={(e) =>
                      setSelected((prev) => (e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id)))
                    }
                  />
                  <span className="text-slate-800">{role.name}</span>
                  {role.isDangerous && <Badge tone="danger">sensitive</Badge>}
                </label>
              ))}
            </div>
          </div>

          {dangerousSelected.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
              You are granting a sensitive role ({dangerousSelected.map((r) => r.name).join(", ")}) — this includes
              organisation role management and/or compliance-obligation approval. Confirm this is intended.
            </p>
          )}

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
          {state.inviteLink && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Accept link (not emailed)</p>
              <code className="mt-1 block break-all text-sm text-slate-800">{state.inviteLink}</code>
            </div>
          )}

          <Button type="submit" disabled={pending}>
            {pending ? "Inviting…" : "Send invitation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InvitedRowActions({ membershipId }: { membershipId: string }) {
  const [resendState, resendAction, resendPending] = useActionState(resendInvitationAction, emptyState);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeInvitationAction, emptyState);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <form action={resendAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <Button type="submit" variant="secondary" size="sm" disabled={resendPending}>
            {resendPending ? "Resending…" : "Resend"}
          </Button>
        </form>
        <form action={revokeAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <Button type="submit" variant="danger" size="sm" disabled={revokePending}>
            Revoke
          </Button>
        </form>
      </div>
      {resendState.error && <p className="text-xs text-red-600">{resendState.error}</p>}
      {revokeState.error && <p className="text-xs text-red-600">{revokeState.error}</p>}
      {resendState.inviteLink && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <code className="block break-all text-xs text-slate-800">{resendState.inviteLink}</code>
        </div>
      )}
    </div>
  );
}

function ActiveOrSuspendedRowActions({
  member,
  isLastRoleManager,
}: {
  member: MemberRow;
  isLastRoleManager: boolean;
}) {
  const [suspendState, suspendAction, suspendPending] = useActionState(suspendMembershipAction, emptyState);
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(reactivateMembershipAction, emptyState);
  const [removeState, removeAction, removePending] = useActionState(removeMembershipAction, emptyState);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {member.status === "ACTIVE" && (
          <form action={suspendAction}>
            <input type="hidden" name="membershipId" value={member.id} />
            <Button type="submit" variant="secondary" size="sm" disabled={suspendPending || isLastRoleManager}>
              {suspendPending ? "Suspending…" : "Suspend"}
            </Button>
          </form>
        )}
        {member.status === "SUSPENDED" && (
          <form action={reactivateAction}>
            <input type="hidden" name="membershipId" value={member.id} />
            <Button type="submit" variant="secondary" size="sm" disabled={reactivatePending}>
              {reactivatePending ? "Reactivating…" : "Reactivate"}
            </Button>
          </form>
        )}
        <form action={removeAction}>
          <input type="hidden" name="membershipId" value={member.id} />
          <Button type="submit" variant="danger" size="sm" disabled={removePending || isLastRoleManager}>
            Remove
          </Button>
        </form>
      </div>
      {isLastRoleManager && (
        <p className="text-xs text-amber-700">
          Last member able to manage roles — assign role management to someone else before suspending or removing.
        </p>
      )}
      {suspendState.error && <p className="text-xs text-red-600">{suspendState.error}</p>}
      {reactivateState.error && <p className="text-xs text-red-600">{reactivateState.error}</p>}
      {removeState.error && <p className="text-xs text-red-600">{removeState.error}</p>}
    </div>
  );
}

function RoleAssignment({ member, roles, canManageRoles }: { member: MemberRow; roles: RoleOption[]; canManageRoles: boolean }) {
  const [assignState, assignAction, assignPending] = useActionState(assignRoleAction, emptyState);
  const [unassignState, unassignAction] = useActionState(unassignRoleAction, emptyState);
  const [pickedRoleId, setPickedRoleId] = useState("");
  const available = roles.filter((r) => !member.roles.some((mr) => mr.id === r.id));

  if (!canManageRoles) {
    return (
      <div className="flex flex-wrap gap-1">
        {member.roles.map((r) => (
          <Badge key={r.id} tone="neutral">
            {r.name}
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {member.roles.map((r) => (
          <form key={r.id} action={unassignAction} className="inline-flex">
            <input type="hidden" name="membershipId" value={member.id} />
            <input type="hidden" name="roleId" value={r.id} />
            <button
              type="submit"
              className="group inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-red-50 hover:text-red-700 hover:ring-red-200"
              title="Remove this role"
            >
              {r.name} <span aria-hidden="true">×</span>
            </button>
          </form>
        ))}
      </div>
      {available.length > 0 && (
        <form action={assignAction} className="flex items-center gap-2">
          <input type="hidden" name="membershipId" value={member.id} />
          <select
            name="roleId"
            value={pickedRoleId}
            onChange={(e) => setPickedRoleId(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">Add role…</option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isDangerous ? " (sensitive)" : ""}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" size="sm" disabled={assignPending || !pickedRoleId}>
            Add
          </Button>
        </form>
      )}
      {assignState.error && <p className="text-xs text-red-600">{assignState.error}</p>}
      {unassignState.error && <p className="text-xs text-red-600">{unassignState.error}</p>}
    </div>
  );
}

export function MemberManagement({
  members,
  roles,
  activeRoleManagerCount,
  canManageRoles,
}: {
  members: MemberRow[];
  roles: RoleOption[];
  activeRoleManagerCount: number;
  canManageRoles: boolean;
}) {
  const invitable = members.filter((m) => m.status !== "REMOVED");

  return (
    <div className="space-y-6">
      <InviteForm roles={roles} />

      <Card>
        <CardHeader>
          <CardTitle>Members ({invitable.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4">Member</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Roles</th>
                <th className="py-2 pr-4">Access</th>
                <th className="py-2 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isLastRoleManager = member.isRoleManager && activeRoleManagerCount <= 1;
                return (
                  <tr key={member.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-800">{member.name}</div>
                      <div className="text-xs text-slate-500">{member.email}</div>
                      {member.isRoleManager && <Badge tone="info">role manager</Badge>}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={member.status} />
                    </td>
                    <td className="py-3 pr-4">
                      <RoleAssignment member={member} roles={roles} canManageRoles={canManageRoles} />
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {member.accessMode === "ORGANISATION_WIDE" ? "Organisation-wide" : "Restricted"}
                    </td>
                    <td className="py-3 pr-4">
                      {member.status === "INVITED" && <InvitedRowActions membershipId={member.id} />}
                      {(member.status === "ACTIVE" || member.status === "SUSPENDED") && (
                        <ActiveOrSuspendedRowActions member={member} isLastRoleManager={isLastRoleManager} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
