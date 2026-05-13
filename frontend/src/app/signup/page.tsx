"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import { useAuth } from "@/contexts/AuthContext";

export default function SignupPage() {
  const [form, setForm] = useState({
    company_name: "",
    email: "",
    password: "",
    industry: "",
    location: "",
    website: "",
    description: "",
  });
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace("/");
    }
  }, [authLoading, router, user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMessage("");
    setLoading(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login?verified=1`,
          data: {
            company_name: form.company_name,
          },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      const userId = signUpData.user?.id;

      if (!userId) {
        throw new Error("Signup succeeded but no user id was returned");
      }

      const profilePayload = {
        id: userId,
        company_name: form.company_name,
        email: form.email,
        industry: form.industry,
        location: form.location,
        website: form.website,
        description: form.description,
        rating: 0,
        followers: [],
        created_at: new Date().toISOString(),
        profile_image: "",
        verified: false,
        licenses: [],
        founded_year: "",
        company_size: "",
        specialties: [],
        phone: "",
        registration_number: "",
      };

      if (signUpData.session) {
        const { error: profileError } = await supabase.from("users").upsert(profilePayload, {
          onConflict: "id",
        });

        if (profileError) {
          throw profileError;
        }

        router.replace("/");
        return;
      }

      setSuccessMessage("Account created. Check your email to verify your account before signing in.");
      router.replace(`/login?verified=1&email=${encodeURIComponent(form.email)}`);
    } catch (err: any) {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const industries = [
    "Technology", "Defense", "Healthcare", "Construction", "Energy",
    "Finance", "Manufacturing", "Logistics", "Consulting", "Other",
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
      <div className="max-w-lg w-full">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[var(--primary)] rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-[#EFECE3] text-2xl font-bold">P</span>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--foreground)]">Create Account</h1>
          <p className="text-[var(--muted)] text-sm mt-1">Join ProcureNet as a company</p>
        </div>
        <div className="card">
          {error && <div className="bg-[var(--danger-light)] text-[var(--danger)] text-sm p-3 rounded-lg mb-4">{error}</div>}
          {successMessage && <div className="bg-[var(--success-light)] text-[var(--success)] text-sm p-3 rounded-lg mb-4">{successMessage}</div>}
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Company Name *</label>
              <input name="company_name" value={form.company_name} onChange={handleChange} required className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Email *</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Password *</label>
              <input name="password" type="password" value={form.password} onChange={handleChange} required minLength={6} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Industry *</label>
              <select name="industry" value={form.industry} onChange={handleChange} required className="input-field w-full">
                <option value="">Select industry</option>
                {industries.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Location *</label>
              <input name="location" value={form.location} onChange={handleChange} required className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Website</label>
              <input name="website" value={form.website} onChange={handleChange} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange} rows={3} className="input-field w-full" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>
          <p className="text-sm text-[var(--muted)] mt-6 text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--primary)] hover:underline font-semibold">Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

