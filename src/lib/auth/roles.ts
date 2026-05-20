import { backend } from "@/integrations/backend/client";

export type UserRole = "super_admin" | "store_owner" | "customer";
type StoredUserRole = UserRole | "admin";

const ROLE_PRIORITY: UserRole[] = ["super_admin", "store_owner", "customer"];

export function normalizeUserRole(role: unknown): UserRole | null {
  if (role === "admin" || role === "super_admin") return "super_admin";
  if (role === "store_owner") return "store_owner";
  if (role === "customer") return "customer";
  return null;
}

export function getPrimaryRoleFromRoles(roles: Array<UserRole | StoredUserRole | string | null | undefined>): UserRole {
  const normalized = new Set(roles.map(normalizeUserRole).filter(Boolean) as UserRole[]);
  return ROLE_PRIORITY.find((role) => normalized.has(role)) ?? "customer";
}

export function getRoleHomePath(role: UserRole) {
  if (role === "super_admin") return "/admin";
  if (role === "store_owner") return "/lojista";
  return "/";
}

export async function getUserRoles(userId: string): Promise<UserRole[]> {
  if (!userId) return ["customer"];

  try {
    const [{ data: roleRows, error: rolesError }, { data: profile, error: profileError }] = await Promise.all([
      backend
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", userId),
      backend
        .from("profiles" as any)
        .select("role")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (rolesError) throw rolesError;
    if (profileError) console.warn("Error fetching profile role:", profileError);

    const roles = [
      ...(roleRows || []).map((row: any) => normalizeUserRole(row.role)),
      normalizeUserRole((profile as any)?.role),
    ].filter(Boolean) as UserRole[];

    const uniqueRoles = Array.from(new Set(roles));
    if (uniqueRoles.length === 0) return ["customer"];

    return ROLE_PRIORITY.filter((role) => uniqueRoles.includes(role));
  } catch (error) {
    console.error("Error fetching user roles:", error);
    return ["customer"];
  }
}

export async function getPrimaryRole(userId: string): Promise<UserRole> {
  return getPrimaryRoleFromRoles(await getUserRoles(userId));
}

export async function hasRole(userId: string, role: UserRole): Promise<boolean> {
  const roles = await getUserRoles(userId);
  return roles.includes(role);
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  return hasRole(userId, "super_admin");
}

export async function isStoreOwner(userId: string, storeId?: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  if (!roles.includes("store_owner")) return false;
  
  if (storeId) {
    const { data, error } = await backend
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("owner_user_id", userId)
      .maybeSingle();
      
    return !!data && !error;
  }
  
  return true;
}

export async function canAccessAdmin(userId: string): Promise<boolean> {
  return isSuperAdmin(userId);
}

export async function canAccessMerchantPanel(userId: string, storeId?: string): Promise<boolean> {
  const roles = await getUserRoles(userId);
  // super_admin usually has access to all merchant panels for support
  if (roles.includes("super_admin")) return true;
  return isStoreOwner(userId, storeId);
}
