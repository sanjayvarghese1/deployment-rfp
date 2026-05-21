"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase, getEmailByUsername } from "@/services/supabase";
import { useAuth } from "@/contexts/AuthContext";

function LoginContent() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [authLoading, router, user]);

  const emailQuery = searchParams?.get("email") || "";
  const verificationMessage = searchParams?.get("verified") === "1"
    ? "Your account is ready. Sign in to continue."
    : emailQuery
      ? `Check ${emailQuery} for the verification link.`
      : "";

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const rawIdentifier = identifier.trim();
      if (!rawIdentifier) {
        throw new Error("Enter a username or email");
      }

      let loginEmail = rawIdentifier;
      if (!rawIdentifier.includes("@")) {
        const lookedUp = await getEmailByUsername(rawIdentifier.toLowerCase());
        if (!lookedUp) throw new Error("No account found for that username");
        loginEmail = lookedUp;
      }

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      if (data?.session) {
        router.push("/");
      } else {
        throw new Error("No session created");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[var(--primary)] rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-[#EFECE3] text-2xl font-bold">P</span>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--foreground)]">Sign In</h1>
          <p className="text-[var(--muted)] text-sm mt-1">Welcome back to ProcureNet</p>
        </div>
        <div className="card">
          {verificationMessage && <div className="bg-[var(--success-light)] text-[var(--success)] text-sm p-3 rounded-lg mb-4">{verificationMessage}</div>}
          {error && <div className="bg-[var(--danger-light)] text-[var(--danger)] text-sm p-3 rounded-lg mb-4">{error}</div>}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Username or Email</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="username or you@example.com"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="input-field w-full" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <p className="text-sm text-[var(--muted)] mt-6 text-center">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[var(--primary)] hover:underline font-semibold">Sign Up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-4rem)] flex items-center justify-center"><div className="text-[var(--muted)]">Loading...</div></div>}>
      <LoginContent />
    </Suspense>
  );
}

