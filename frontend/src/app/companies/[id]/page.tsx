"use client";

import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import ProfileHeader from "@/components/ProfileHeader";
import PostCard from "@/components/PostCard";
import ContractCard from "@/components/ContractCard";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/services/supabase";

export default function CompanyProfilePage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const companyId = params?.id;
  const { user, profile, loading: authLoading } = useAuth();
  const [company, setCompany] = useState<Record<string, unknown> | null>(null);
  const [posts, setPosts] = useState<Record<string, unknown>[]>([]);
  const [contracts, setContracts] = useState<Record<string, unknown>[]>([]);
  const [reviews, setReviews] = useState<Record<string, unknown>[]>([]);
  const [tab, setTab] = useState<"about" | "posts" | "contracts" | "reviews">("about");
  const [loading, setLoading] = useState(true);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: "" });
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [referrer, setReferrer] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get("from") || "";
      setReferrer(ref);
    }
  }, []);

  const handleBack = () => {
    if (referrer === "insights" || referrer === "postrfp" || referrer === "rfp") {
      router.push("/rfp");
    } else if (referrer === "contracts") {
      router.push("/contracts");
    } else {
      router.back();
    }
  };

  useEffect(() => {
    if (!companyId) return;
    const fetchCompany = async () => {
      try {
        const { data } = await supabase.from("users").select("*").eq("id", companyId).maybeSingle();
        if (data) setCompany({ id: data.id, ...data });
      } catch (err) {
        console.error("Failed to fetch company:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCompany();
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const [postsRes, contractsRes, reviewsRes] = await Promise.all([
        supabase.from("posts").select("*").eq("company_id", companyId),
        supabase.from("contracts").select("*").eq("posted_by", companyId),
        supabase.from("reviews").select("*").eq("company_id", companyId),
      ]);
      setPosts((postsRes.data || []) as any[]);
      setContracts((contractsRes.data || []) as any[]);
      setReviews((reviewsRes.data || []) as any[]);
    })();
  }, [companyId]);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [user, authLoading, router]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#EFECE3] flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!companyId) return null;

  const followers = Array.isArray((company as any)?.followers) ? ((company as any).followers as string[]) : [];
  const isFollowing = !!user && followers.length > 0 && followers.includes(user.id);

  const handleFollow = async () => {
    if (!user) return;
    try {
      const currFollowers = followers ?? [];
      const nextFollowers = isFollowing
        ? currFollowers.filter((f: string) => f !== user.id)
        : [...currFollowers, user.id];
      const { error } = await supabase.from("users").update({ followers: nextFollowers }).eq("id", companyId);
      if (error) throw error;
      setCompany((prev: any) => ({
        ...prev,
        followers: nextFollowers,
      }));
    } catch (err) {
      console.error("Follow action failed:", err);
    }
  };

  const handleSubmitReview = async () => {
    if (!user || !profile) return;
    setSubmittingReview(true);
    try {
      const { error } = await supabase.from("reviews").insert({
        id: uuidv4(),
        company_id: companyId,
        reviewer_id: user.id,
        reviewer_name: profile.company_name,
        rating: reviewForm.rating,
        comment: reviewForm.comment,
        created_at: new Date().toISOString(),
      });
      if (error) throw error;
      const newRatings = [...(reviews as any[]).map((r: any) => r.rating || 0), reviewForm.rating];
      const avg = (newRatings as number[]).reduce((a: number, b: number) => a + b, 0) / newRatings.length;
      const { error: ratingError } = await supabase.from("users").update({ rating: parseFloat(avg.toFixed(1)) }).eq("id", companyId);
      if (ratingError) throw ratingError;
      setReviewForm({ rating: 5, comment: "" });
      setShowReviewForm(false);
    } catch (err) {
      console.error("Failed to submit review:", err);
      alert("Failed to submit review. Please try again.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const avgRating = reviews.length > 0 ? (reviews as any[]).reduce((s: number, r: any) => s + (r.rating || 0), 0) / reviews.length : 0;
  const ratingBreakdown = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: (reviews as any[]).filter((r: any) => r.rating === star).length,
    pct: reviews.length > 0 ? ((reviews as any[]).filter((r: any) => r.rating === star).length / reviews.length) * 100 : 0,
  }));

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!company) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-[var(--surface)] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🏢</span>
        </div>
        <p className="text-[var(--muted)] font-medium">Vendor not found</p>
      </div>
    </div>
  );

  const specialties = ((company as any)?.specialties as string[]) ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back Button */}
      {referrer && (
        <button
          onClick={handleBack}
          className="flex items-center gap-2 mb-6 text-sm font-medium text-[var(--primary)] hover:text-[var(--primary-hover)] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to {referrer === "insights" ? "Post RFP" : "Contracts"}
        </button>
      )}
      
      <ProfileHeader
        company_name={(company as any)?.company_name || ""}
        industry={(company as any)?.industry || ""}
        location={(company as any)?.location || ""}
        website={(company as any)?.website || ""}
        founded_year={(company as any)?.founded_year || ""}
        phone={(company as any)?.phone || ""}
        company_size={(company as any)?.company_size || ""}
        profile_image={(company as any)?.profile_image || ""}
        banner_image={(company as any)?.banner_image}
        verified={(company as any)?.verified || false}
        rating={(company as any)?.rating || 0}
        description={(company as any)?.description || ""}
        followers={followers}
        onFollow={handleFollow}
        isFollowing={!!isFollowing}
        isOwn={user?.id === companyId}
        reviewCount={reviews.length}
      />

      {/* Navigation Tabs */}
      <div className="mt-4 card !p-0 overflow-hidden">
        <div className="flex overflow-x-auto scrollbar-none">
          {([
            { key: "about", label: "About", icon: "ℹ️" },
            { key: "posts", label: "Activity", icon: "📝" },
            { key: "contracts", label: "Contracts", icon: "📋" },
            { key: "reviews", label: `Reviews (${reviews.length})`, icon: "⭐" },
          ] as const).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`tab-btn ${tab === key ? "active" : ""}`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-4">

          {/* === ABOUT TAB === */}
          {tab === "about" && (
            <>
              <div className="card">
                <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                  <span className="w-1 h-5 bg-[var(--primary)] rounded-full" />
                  About
                </h2>
                <p className="text-[var(--muted)] text-sm leading-relaxed whitespace-pre-wrap">{((company as any)?.description as string) || "No description available."}</p>
              </div>

              {/* Vendor Details Grid */}
              <div className="card">
                <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                  <span className="w-1 h-5 bg-[var(--primary)] rounded-full" />
                  Vendor Details
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    { label: "Industry", value: company.industry, icon: "🏢" },
                    { label: "Location", value: company.location, icon: "📍" },
                    { label: "Founded", value: company.founded_year, icon: "📅" },
                    { label: "Vendor Size", value: company.company_size ? `${company.company_size} employees` : "", icon: "👥" },
                    { label: "Website", value: company.website, icon: "🌐", isLink: true },
                    { label: "Phone", value: company.phone, icon: "📞" },
                  ].map((item, i) => (
                    item.value ? (
                      <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-[var(--surface)] border border-[var(--divider)] min-h-[72px]">
                        <span className="text-lg mt-0.5 shrink-0">{item.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1">{item.label}</p>
                          {item.isLink ? (
                            <a href={(String(item.value) || "").startsWith("http") ? String(item.value) : `https://${String(item.value)}`} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--primary)] hover:underline font-medium truncate block">{String(item.value)}</a>
                          ) : (
                            <p className="text-sm text-[var(--foreground)] font-semibold break-words line-clamp-2 leading-snug" title={String(item.value)}>{String(item.value)}</p>
                          )}
                        </div>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>

              {specialties.length > 0 && (
                <div className="card">
                  <h2 className="text-lg font-semibold text-[var(--foreground)] mb-4 flex items-center gap-2">
                    <span className="w-1 h-5 bg-[var(--primary)] rounded-full" />
                    Specialties
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {specialties.map((s: string, i: number) => (
                      <span key={i} className="inline-flex items-center text-sm font-medium text-[var(--primary)] bg-[var(--surface)] px-4 py-2 rounded-full">{s}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* === POSTS TAB === */}
          {tab === "posts" && (
            <div className="space-y-4">
              {posts.length === 0 ? (
                <div className="card text-center py-10">
                  <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">📝</span></div>
                  <p className="text-[var(--muted)] font-medium">No activity yet</p>
                </div>
              ) : posts.map((p: any) => <PostCard key={p.post_id} post={p} />)}
            </div>
          )}

          {/* === CONTRACTS TAB === */}
          {tab === "contracts" && (
            <div className="space-y-4">
              {contracts.length === 0 ? (
                <div className="card text-center py-10">
                  <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">📋</span></div>
                  <p className="text-[var(--muted)] font-medium">No contracts posted</p>
                </div>
              ) : (
                <div className="grid gap-4">{contracts.map((c: any) => <ContractCard key={c.contract_id} contract={c} />)}</div>
              )}
            </div>
          )}

          {/* === REVIEWS TAB === */}
          {tab === "reviews" && (
            <div className="space-y-4">
              {/* Rating Overview */}
              <div className="card">
                <h2 className="text-lg font-semibold text-[var(--foreground)] mb-5 flex items-center gap-2">
                  <span className="w-1 h-5 bg-yellow-500 rounded-full" />
                  Reviews & Ratings
                </h2>
                <div className="flex flex-col sm:flex-row gap-6">
                  <div className="text-center sm:text-left shrink-0">
                    <div className="text-5xl font-bold text-[var(--foreground)]">{avgRating.toFixed(1)}</div>
                    <div className="flex justify-center sm:justify-start mt-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className={`text-xl ${s <= Math.round(avgRating) ? "text-yellow-400" : "text-[var(--muted)]"}`}>★</span>
                      ))}
                    </div>
                    <p className="text-sm text-[var(--muted)] mt-1">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex-1 space-y-2">
                    {ratingBreakdown.map(({ star, count, pct }) => (
                      <div key={star} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-[var(--muted)] w-8 text-right">{star}★</span>
                        <div className="flex-1 h-2.5 bg-[var(--surface)] rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm text-[var(--muted)] w-8">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Write Review */}
              {user && (user as any).id !== companyId && (
                <div className="card">
                  <button
                    onClick={() => setShowReviewForm(!showReviewForm)}
                    className={`flex items-center gap-2 text-sm font-semibold transition-colors ${showReviewForm ? "text-[var(--muted)]" : "text-[var(--primary)] hover:underline"}`}
                  >
                    {showReviewForm ? "✕ Cancel" : "✍️ Write a Review"}
                  </button>
                  {showReviewForm && (
                    <div className="mt-4 space-y-4 pt-4 border-t border-[var(--divider)]">
                      <div>
                        <label className="block text-sm font-medium text-[var(--foreground)] mb-2">Your Rating</label>
                        <div className="flex gap-1.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              onClick={() => setReviewForm({ ...reviewForm, rating: star })}
                              className={`text-3xl transition-all hover:scale-110 ${star <= reviewForm.rating ? "text-yellow-400" : "text-[var(--muted)]"}`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Your Review</label>
                        <textarea
                          value={reviewForm.comment}
                          onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })}
                          rows={3}
                          placeholder="Share your experience working with this company..."
                          className="input-field w-full"
                        />
                      </div>
                      <button
                        onClick={handleSubmitReview}
                        disabled={submittingReview || !reviewForm.comment.trim()}
                        className="btn-primary"
                      >
                        {submittingReview ? "Submitting..." : "Submit Review"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Individual Reviews */}
              {reviews.length === 0 ? (
                <div className="card text-center py-10">
                  <div className="w-14 h-14 bg-[var(--surface)] rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">⭐</span></div>
                  <p className="text-[var(--muted)] font-medium">No reviews yet</p>
                  <p className="text-[var(--muted)] text-sm mt-1">Be the first to leave a review</p>
                </div>
              ) : (
                (reviews as any[]).map((r: any) => (
                  <div key={r.review_id} className="card hover:shadow-md transition-shadow">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-[var(--primary)] rounded-full flex items-center justify-center text-[#EFECE3] text-sm font-bold shrink-0">
                        {(r.reviewer_name || "A").charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-[var(--foreground)] text-sm">{r.reviewer_name || "Anonymous Company"}</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map(s => (
                              <span key={s} className={`text-sm ${s <= r.rating ? "text-yellow-400" : "text-[var(--muted)]"}`}>★</span>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm text-[var(--muted)] leading-relaxed">{r.comment}</p>
                        {r.created_at && (
                          <p className="text-xs text-[var(--muted)] mt-2">
                            {r.created_at?.toDate ? r.created_at.toDate().toLocaleDateString() : new Date(r.created_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats */}
          <div className="bg-[var(--card)] rounded-xl border border-[var(--divider)] p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[var(--foreground)] uppercase tracking-wider mb-4">Company Stats</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Rating</span>
                <div className="flex items-center gap-1">
                  <span className="text-yellow-500">★</span>
                  <span className="text-sm font-bold text-[var(--foreground)]">{avgRating.toFixed(1)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Reviews</span>
                <span className="text-sm font-bold text-[var(--foreground)]">{reviews.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Followers</span>
                <span className="text-sm font-bold text-[var(--foreground)]">{followers.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Posts</span>
                <span className="text-sm font-bold text-[var(--foreground)]">{posts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Contracts</span>
                <span className="text-sm font-bold text-[var(--foreground)]">{contracts.length}</span>
              </div>
              <div className="h-px bg-[var(--surface)] my-1" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)]">Status</span>
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${(company as any)?.verified ? "bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/30" : "bg-[var(--surface)] text-[var(--muted)]"}`}>
                  {(company as any)?.verified ? "✓ Verified" : "Unverified"}
                </span>
              </div>
            </div>
          </div>

          {/* Recent Reviews in sidebar */}
          {reviews.length > 0 && tab !== "reviews" && (
            <div className="bg-[var(--card)] rounded-xl border border-[var(--divider)] p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-[var(--foreground)] uppercase tracking-wider">Recent Reviews</h3>
                <button onClick={() => setTab("reviews")} className="text-xs text-[var(--primary)] hover:text-[var(--primary-hover)] font-medium">View all</button>
              </div>
              <div className="space-y-3">
                {(reviews as any[]).slice(0, 3).map((r: any) => {
                  return (
                    <div key={r.review_id} className="border-b border-[var(--divider)] last:border-0 pb-3 last:pb-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-[var(--foreground)] truncate">{r.reviewer_name || "Anonymous"}</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map(s => (
                            <span key={s} className={`text-xs ${s <= r.rating ? "text-yellow-400" : "text-[var(--muted)]"}`}>★</span>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--muted)] line-clamp-2">{r.comment}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Member Since */}
          <div className="bg-[var(--card)] rounded-xl border border-[var(--divider)] p-5 shadow-sm">
            <h3 className="text-sm font-bold text-[var(--foreground)] uppercase tracking-wider mb-3">Member Since</h3>
            <p className="text-sm text-[var(--muted)]">
              {(company as any)?.created_at ? new Date((company as any).created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "Unknown"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
