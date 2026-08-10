import { describe, expect, it } from "vitest";
import {
  assertRoleManagerCoverageRemains,
  countActiveRoleManagers,
  isRoleManager,
  LastRoleManagerError,
  ROLE_MANAGEMENT_PERMISSION,
  type RoleManagerCandidate,
} from "@/lib/organisation/membership-guard";

function candidate(
  membershipId: string,
  status: RoleManagerCandidate["status"],
  codes: string[],
): RoleManagerCandidate {
  return { membershipId, status, permissionCodes: new Set(codes) };
}

describe("membership-guard", () => {
  it("counts only ACTIVE memberships holding organisation.role.manage", () => {
    const candidates = [
      candidate("m1", "ACTIVE", [ROLE_MANAGEMENT_PERMISSION]),
      candidate("m2", "SUSPENDED", [ROLE_MANAGEMENT_PERMISSION]),
      candidate("m3", "ACTIVE", ["carbon.view"]),
    ];
    expect(countActiveRoleManagers(candidates)).toBe(1);
    expect(isRoleManager(candidates[0])).toBe(true);
    expect(isRoleManager(candidates[1])).toBe(false);
  });

  it("allows a projection that still has at least one role manager", () => {
    const projected = [
      candidate("m1", "ACTIVE", [ROLE_MANAGEMENT_PERMISSION]),
      candidate("m2", "ACTIVE", ["carbon.view"]),
    ];
    expect(() => assertRoleManagerCoverageRemains(projected)).not.toThrow();
  });

  it("blocks a projection that would leave zero role managers", () => {
    const projected = [candidate("m1", "ACTIVE", ["carbon.view"]), candidate("m2", "SUSPENDED", [ROLE_MANAGEMENT_PERMISSION])];
    expect(() => assertRoleManagerCoverageRemains(projected)).toThrow(LastRoleManagerError);
  });

  it("blocks removing the sole role manager entirely from the list", () => {
    const projected = [candidate("m2", "ACTIVE", ["carbon.view"])];
    expect(() => assertRoleManagerCoverageRemains(projected)).toThrow(LastRoleManagerError);
  });

  it("blocks an empty organisation (no memberships at all)", () => {
    expect(() => assertRoleManagerCoverageRemains([])).toThrow(LastRoleManagerError);
  });
});
