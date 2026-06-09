"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";
import { useAuth } from "@/contexts/AuthContext";

type UserType = "vendor" | "rfp_company";

export default function SignupPage() {
  const [step, setStep] = useState<"role" | "details">("role");
  const [userType, setUserType] = useState<UserType | null>(null);
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

  const handleRoleSelect = (role: UserType) => {
    setUserType(role);
    setStep("details");
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userType) return;
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
            user_type: userType,
            industry: form.industry,
            location: form.location,
            website: form.website,
            description: form.description,
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
      // derive a login username from company_name
      const normalizeUsername = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-_.]/g, "");
      let baseUsername = normalizeUsername(form.company_name || form.email.split('@')[0]);

      let username = baseUsername;
      let counter = 1;
      while (true) {
        const { data: existing, error: existingErr } = await supabase.from("profiles").select("id").ilike("username", username).maybeSingle();
        if (existingErr) {
          throw existingErr;
        }
        if (!existing) break;
        username = `${baseUsername}-${counter++}`;
      }

      const profilePayload = {
        id: userId,
        company_name: form.company_name,
        username,
        email: form.email,
        industry: form.industry,
        location: form.location,
        website: form.website,
        description: form.description,
        user_type: userType,
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

      // Destructure username out of profilePayload since public.users does not have a username column
      const { username: payloadUsername, ...userPayload } = profilePayload;

      if (signUpData.session) {
        const { error: userError } = await supabase.from("users").upsert(userPayload, {
          onConflict: "id",
        });

        if (userError) {
          throw userError;
        }

        const { error: profileError } = await supabase.from("profiles").upsert({
          id: userId,
          email: form.email,
          username,
        }, {
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

  // ── Step 1: Role Selection ────────────────────────────────────────────────
  if (step === "role") {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
        <div className="max-w-2xl w-full">
          {/* Logo area */}
          <div className="text-center mb-10">
            <div className="w-14 h-14 bg-[var(--primary)] rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-[#EFECE3] text-2xl font-bold">P</span>
            </div>
            <h1 className="text-3xl font-semibold text-[var(--foreground)]">Join ProcureLink</h1>
            <p className="text-[var(--muted)] text-sm mt-2">First, tell us how you'll use the platform</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* RFP Company Card */}
            <button
              onClick={() => handleRoleSelect("rfp_company")}
              className="group relative card p-8 text-left cursor-pointer hover:border-[var(--primary)] hover:shadow-xl transition-all duration-200 hover:-translate-y-1"
            >
              <div className="w-14 h-14 rounded-2xl bg-[var(--primary-light)] flex items-center justify-center mb-5 group-hover:bg-[var(--primary)] transition-colors duration-200">
                <svg className="w-7 h-7 text-[var(--primary)] group-hover:text-[#EFECE3] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">RFP Company</h2>
              <p className="text-sm text-[var(--muted)] leading-relaxed mb-5">
                Post Requests for Proposals, review vendor bids, run AI analysis, and manage contracts.
              </p>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                {["Create & publish RFPs", "Review vendor proposals", "AI-powered bid analysis", "Manage your contracts"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 border-[var(--divider)] group-hover:border-[var(--primary)] group-hover:bg-[var(--primary)] flex items-center justify-center transition-all duration-200">
                <svg className="w-3 h-3 text-[#EFECE3] opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>

            {/* Vendor Card */}
            <button
              onClick={() => handleRoleSelect("vendor")}
              className="group relative card p-8 text-left cursor-pointer hover:border-[var(--primary)] hover:shadow-xl transition-all duration-200 hover:-translate-y-1"
            >
              <div className="w-14 h-14 rounded-2xl bg-[var(--surface)] flex items-center justify-center mb-5 group-hover:bg-[var(--primary)] transition-colors duration-200">
                <svg className="w-7 h-7 text-[var(--foreground)] group-hover:text-[#EFECE3] transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-2">Vendor</h2>
              <p className="text-sm text-[var(--muted)] leading-relaxed mb-5">
                Browse open contracts, submit competitive proposals, and grow your business.
              </p>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                {["Browse open RFPs", "Submit proposals", "Track application status", "Connect with companies"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full bg-[var(--success-light)] text-[var(--success)] flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="absolute top-4 right-4 w-6 h-6 rounded-full border-2 border-[var(--divider)] group-hover:border-[var(--primary)] group-hover:bg-[var(--primary)] flex items-center justify-center transition-all duration-200">
                <svg className="w-3 h-3 text-[#EFECE3] opacity-0 group-hover:opacity-100 transition-opacity" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            </button>
          </div>

          <p className="text-sm text-[var(--muted)] mt-8 text-center">
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--primary)] hover:underline font-semibold">Sign In</Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Step 2: Account Details ───────────────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-8">
      <div className="max-w-lg w-full">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-[var(--primary)] rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-[#EFECE3] text-2xl font-bold">P</span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full ${
              userType === "rfp_company"
                ? "bg-[var(--primary-light)] text-[var(--primary)]"
                : "bg-[var(--surface)] text-[var(--foreground)]"
            }`}>
              {userType === "rfp_company" ? "🏢 RFP Company" : "🔧 Vendor"}
            </span>
            <button
              onClick={() => setStep("role")}
              className="text-xs text-[var(--muted)] hover:text-[var(--primary)] underline transition-colors"
            >
              Change
            </button>
          </div>
          <h1 className="text-3xl font-semibold text-[var(--foreground)]">Create Account</h1>
          <p className="text-[var(--muted)] text-sm mt-1">Complete your profile to get started</p>
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
