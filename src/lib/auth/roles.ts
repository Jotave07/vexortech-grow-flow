import { supabase } from "@/integrations/supabase/client";

export type UserRole = "super_admin" | "store_owner" | "customer";

export async function getUserRoles(userId: string): Promise<UserRole[]> {
  try {
    const { data, error } = await supabase
      .from("user_roles" as any)
      .select("role")
      .eq("user_id", userId);

    if (error) throw error;
    return (data || []).map((r: any) => r.role as UserRole);
  } catch (error) {
    console.error("Error fetching user roles:", error);
    return ["customer"];
  }
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
    const { data, error } = await supabase
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
