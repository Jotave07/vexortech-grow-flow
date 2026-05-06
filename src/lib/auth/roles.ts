import { type Profile } from "@/contexts/AuthContext";

export function isSuperAdmin(profile: Profile | null): boolean {
  return profile?.role === "super_admin";
}

export function isStoreOwner(profile: Profile | null, storeId?: string): boolean {
  if (profile?.role === "super_admin") return true;
  if (profile?.role !== "store_owner") return false;
  if (storeId && profile.store_id !== storeId) return false;
  return true;
}

export function isCustomer(profile: Profile | null): boolean {
  // Any authenticated user can be a customer
  return !!profile;
}
