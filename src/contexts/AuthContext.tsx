import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { backend } from "@/integrations/backend/client";
import type { LocalSession as Session, LocalUser as User } from "@/integrations/backend/compat-types";
import { getPrimaryRoleFromRoles, getUserRoles, normalizeUserRole, UserRole } from "@/lib/auth/roles";

export type Profile = {
  id: string;
  user_id: string;
  store_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  role?: UserRole | null;
  is_exempt?: boolean;
  zip_code?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (currentUser: User) => {
    const userId = currentUser.id;
    try {
      const { data, error } = await backend
        .from("profiles" as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      
      let profileData = data as any;

      if (!profileData) {
        const fallbackName =
          currentUser.user_metadata?.full_name ||
          currentUser.user_metadata?.name ||
          null;
        const created = await backend
          .from("profiles" as any)
          .insert({
            user_id: userId,
            email: currentUser.email?.toLowerCase() ?? null,
            full_name: fallbackName ? String(fallbackName).toUpperCase() : null,
            role: "customer",
          })
          .select("*")
          .maybeSingle();

        if (created.error) throw created.error;
        profileData = created.data;
        await backend
          .from("user_roles" as any)
          .insert({ user_id: userId, role: "customer" })
          .then(({ error }) => {
            if (error) console.warn("Could not create fallback role:", error);
          });
      }
      
      if (profileData) {
        const roles = await getUserRoles(userId);
        profileData.role = getPrimaryRoleFromRoles([...(roles || []), normalizeUserRole(profileData.role)]);
      }
      
      setProfile(profileData as Profile | null);
    } catch (err) {
      console.error("Error loading profile:", err);
      setProfile(null);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      setLoading(false);
      return;
    }

    const { data: sub } = backend.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user), 0);
      } else {
        setProfile(null);
      }
    });

    backend.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await backend.auth.signOut();
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
};
