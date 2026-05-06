import { Session, User } from "@supabase/supabase-js";
import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUserRoles, UserRole } from "@/lib/auth/roles";

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

  const loadProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("profiles" as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw error;
      
      let profileData = data as any;
      
      if (profileData) {
        // Fetch roles from the user_roles table to be sure
        const roles = await getUserRoles(userId);
        if (roles.length > 0) {
          // Priority: super_admin > store_owner > customer
          if (roles.includes("super_admin")) profileData.role = "super_admin";
          else if (roles.includes("store_owner")) profileData.role = "store_owner";
          else profileData.role = "customer";
        }
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

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
      } else {
        setProfile(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id);
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
