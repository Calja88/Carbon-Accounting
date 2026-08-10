"use client";

import { useActionState, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateRolePermissionsAction, type RoleActionState } from "./actions";

const emptyState: RoleActionState = { error: null, message: null };

export interface CatalogueEntry {
  code: string;
  domain: string;
  description: string;
  isSensitive: boolean;
}

export interface RoleOption {
  id: string;
  name: string;
  description: string | null;
  isSystemSeeded: boolean;
  grantedCodes: string[];
}

function labelForDomain(domain: string): string {
  const map: Record<string, string> = {
    organisation: "Organisation",
    carbon: "Corporate carbon",
    lca: "Product LCA",
    ai: "AI layer",
    ems: "EMS (ISO 14001)",
    audit: "Platform audit trail",
  };
  return map[domain] ?? domain;
}

export function RolePermissionEditor({
  roles,
  catalogue,
  domains,
}: {
  roles: RoleOption[];
  catalogue: CatalogueEntry[];
  domains: string[];
}) {
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? "");
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  const [pendingCodes, setPendingCodes] = useState<Set<string>>(new Set(selectedRole?.grantedCodes ?? []));
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [state, formAction, pending] = useActionState(updateRolePermissionsAction, emptyState);

  const savedCodes = useMemo(() => new Set(selectedRole?.grantedCodes ?? []), [selectedRole]);

  function selectRole(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    setSelectedRoleId(roleId);
    setPendingCodes(new Set(role?.grantedCodes ?? []));
    setReviewing(false);
    setAcknowledged(false);
  }

  function toggle(code: string) {
    setPendingCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setReviewing(false);
    setAcknowledged(false);
  }

  const added = catalogue.filter((c) => pendingCodes.has(c.code) && !savedCodes.has(c.code));
  const removed = catalogue.filter((c) => !pendingCodes.has(c.code) && savedCodes.has(c.code));
  const dangerousChanges = [...added, ...removed].filter((c) => c.isSensitive);
  const hasChanges = added.length > 0 || removed.length > 0;

  const grantsComplianceApproval = pendingCodes.has("ems.compliance_obligation.approve");
  const isAdminLikeRole = selectedRole?.name.toLowerCase().includes("administrator") ?? false;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => selectRole(role.id)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                role.id === selectedRoleId ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {role.name}
            </button>
          ))}
        </CardContent>
      </Card>

      {selectedRole && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{selectedRole.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedRole.description && <p className="text-sm text-slate-500">{selectedRole.description}</p>}

              {isAdminLikeRole && !grantsComplianceApproval && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  This role does not include compliance-obligation approval. That stays reserved for Sustainability
                  Lead by default across this platform.
                </p>
              )}

              <form
                action={formAction}
                onSubmit={(e) => {
                  if (!reviewing || (dangerousChanges.length > 0 && !acknowledged)) {
                    e.preventDefault();
                  }
                }}
                className="space-y-6"
              >
                <input type="hidden" name="roleId" value={selectedRole.id} />
                {[...pendingCodes].map((code) => (
                  <input key={code} type="hidden" name="permissionCodes" value={code} />
                ))}

                {domains.map((domain) => {
                  const entries = catalogue.filter((c) => c.domain === domain);
                  return (
                    <div key={domain} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {labelForDomain(domain)}
                      </h3>
                      <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {entries.map((entry) => (
                          <label
                            key={entry.code}
                            className="flex items-start gap-2 rounded-lg p-1.5 text-sm hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={pendingCodes.has(entry.code)}
                              onChange={() => toggle(entry.code)}
                              className="mt-0.5 h-4 w-4 rounded border-slate-300"
                            />
                            <span>
                              <span className="block text-slate-700">
                                {entry.description}
                                {entry.isSensitive && (
                                  <span className="ml-1.5">
                                    <Badge tone="danger">sensitive</Badge>
                                  </span>
                                )}
                              </span>
                              <span className="block font-mono text-xs text-slate-400">{entry.code}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {hasChanges && !reviewing && (
                  <Button type="button" variant="secondary" onClick={() => setReviewing(true)}>
                    Review changes
                  </Button>
                )}

                {reviewing && hasChanges && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Audit preview — what will be recorded
                    </p>
                    {added.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-emerald-700">Granting ({added.length})</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {added.map((c) => (
                            <li key={c.code}>
                              + {c.code} {c.isSensitive && <Badge tone="danger">sensitive</Badge>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {removed.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-red-700">Revoking ({removed.length})</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {removed.map((c) => (
                            <li key={c.code}>
                              − {c.code} {c.isSensitive && <Badge tone="danger">sensitive</Badge>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {dangerousChanges.length > 0 && (
                      <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-amber-300"
                        />
                        <span>
                          This change affects {dangerousChanges.length} sensitive permission
                          {dangerousChanges.length === 1 ? "" : "s"} (role management, compliance approval, exports,
                          or similar). I&apos;ve reviewed the list above and want to proceed.
                        </span>
                      </label>
                    )}

                    <Button type="submit" disabled={pending || (dangerousChanges.length > 0 && !acknowledged)}>
                      {pending ? "Saving…" : "Confirm and save"}
                    </Button>
                  </div>
                )}
              </form>

              {state.error && <p className="text-sm text-red-600">{state.error}</p>}
              {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
