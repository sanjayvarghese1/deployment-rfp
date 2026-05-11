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
        setProfile(null);
        setLoading(false);
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
        setLoading(false);
        return;
      }

      setProfile(data as UserProfile);
      setLoading(false);
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const authUser = session?.user ?? null;
      setUser(authUser);
      void loadProfile(authUser);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (!isActive) return;
      const authUser = data.session?.user ?? null;
      setUser(authUser);
      void loadProfile(authUser);
    });

    return () => {
      isActive = false;
      authListener.subscription.unsubscribe();
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
