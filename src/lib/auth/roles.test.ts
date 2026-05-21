import { describe, expect, it } from "vitest";
import { getPrimaryRoleFromRoles, getRoleHomePath, normalizeUserRole } from "./roles";

describe("role helpers", () => {
  it("normalizes legacy and current roles", () => {
    expect(normalizeUserRole("admin")).toBe("super_admin");
    expect(normalizeUserRole("store_owner")).toBe("store_owner");
    expect(normalizeUserRole("customer")).toBe("customer");
    expect(normalizeUserRole("unknown")).toBeNull();
  });

  it("chooses the safest primary role by priority", () => {
    expect(getPrimaryRoleFromRoles(["customer", "store_owner"])).toBe("store_owner");
    expect(getPrimaryRoleFromRoles(["customer", "admin"])).toBe("super_admin");
    expect(getPrimaryRoleFromRoles([])).toBe("customer");
  });

  it("routes roles to the correct home", () => {
    expect(getRoleHomePath("super_admin")).toBe("/admin");
    expect(getRoleHomePath("store_owner")).toBe("/lojista");
    expect(getRoleHomePath("customer")).toBe("/");
  });
});
