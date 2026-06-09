"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/services/supabase";

export interface UserProfile {
  id: string;
  company_name: string;
  email: string;
  industry: string;
  location: string;
  website: string;
  description: string;
  rating: number;
  followers: string[];
  created_at: string;
  profile_image: string;
  verified: boolean;
  licenses: { name: string; url: string; uploaded_at: string }[];
  founded_year: string;
  company_size: string;
  specialties: string[];
  phone: string;
  registration_number: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadProfile = async (authUser: User | null) => {
      if (!authUser) {
        if (isActive) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", authUser.id)
        .single();

      if (!isActive) return;

      if (error) {
        console.warn("Profile load failed:", error);
        setProfile(null);
      } else {
        setProfile(data as UserProfile);
      }
      setLoading(false);
    };

    // Listen to auth state changes including TOKEN_REFRESHED and SIGNED_OUT events
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isActive) return;
      const authUser = session?.user ?? null;

      if (event === "SIGNED_OUT") {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      // Update user on sign-in or token refresh
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY" || event === "USER_UPDATED") {
        setUser(authUser);
        // On token refresh we already have the profile; avoid redundant DB fetch
        if (event !== "TOKEN_REFRESHED") {
          void loadProfile(authUser);
        } else {
          setLoading(false);
        }
      }
    });

    // Load session on mount
    void supabase.auth.getSession().then(({ data }) => {
      if (!isActive) return;
      const authUser = data.session?.user ?? null;
      setUser(authUser);
      void loadProfile(authUser);
    });

    // ─── Session keepalive ───────────────────────────────────────────────────
    // Supabase JWT tokens expire after 1 hour. autoRefreshToken handles it on
    // navigation, but if the user stays on the same page for a long time (e.g.
    // waiting for a background RFP generation), the token can silently expire
    // and cause unexpected logouts. We proactively refresh every 10 minutes.
    const keepaliveInterval = window.setInterval(async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          await supabase.auth.refreshSession();
        }
      } catch {
        // Non-fatal: onAuthStateChange will catch any real sign-out events.
      }
    }, 10 * 60 * 1000); // every 10 minutes

    return () => {
      isActive = false;
      authListener.subscription.unsubscribe();
      window.clearInterval(keepaliveInterval);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
