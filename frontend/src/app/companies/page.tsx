"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/services/supabase";

interface Company {
  id: string;
  company_name: string;
  industry: string;
  location: string;
  description: string;
  rating: number;
  followers: string[];
  profile_image: string;
  banner_image?: string;
  verified?: boolean;
}

type SortKey = "name" | "rating" | "followers";

const BANNER_GRADIENTS = [
  "from-[#E5E2D8] to-[#E5E2D8]",
  "from-[#E5E2D8] to-[#EFECE3]",
  "from-[#E5E2D8] to-[#E5E2D8]",
  "from-[#E5E2D8] to-[#E5E2D8]",
  "from-[#E5E2D8] to-[#EFECE3]",
  "from-[#E5E2D8] to-[#E5E2D8]",
];

function getBannerGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return BANNER_GRADIENTS[Math.abs(hash) % BANNER_GRADIENTS.length];
}

export default function CompaniesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [searchFocused, setSearchFocused] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("users").select("*");
      if (error) {
        console.warn("Companies load failed:", error);
        setCompanies([]);
        return;
      }
      setCompanies((data || []) as Company[]);
    })();
  }, []);

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

  const toggleFollow = async (e: React.MouseEvent, companyId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    const company = companies.find((c) => c.id === companyId);
    const isFollowing = Array.isArray(company?.followers) && company.followers.includes(user.id);
    const nextFollowers = isFollowing
      ? (company?.followers || []).filter((id) => id !== user.id)
      : [...(company?.followers || []), user.id];
    const { error } = await supabase.from("users").update({ followers: nextFollowers }).eq("id", companyId);
    if (error) console.error("Follow action failed:", error);
  };

  const filtered = companies
    .filter((c) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        c.company_name?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.industry?.toLowerCase().includes(q);
      const matchIndustry = !industryFilter || c.industry === industryFilter;
      const matchLocation = !locationFilter || c.location === locationFilter;
      return matchSearch && matchIndustry && matchLocation;
    })
    .sort((a, b) => {
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sortBy === "followers") return (b.followers?.length || 0) - (a.followers?.length || 0);
      return (a.company_name || "").localeCompare(b.company_name || "");
    });

  const industries = [...new Set(companies.map((c) => c.industry).filter(Boolean))].sort();
  const locations = [...new Set(companies.map((c) => c.location).filter(Boolean))].sort();
  const activeFilters = [industryFilter, locationFilter].filter(Boolean).length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Hero Header */}
      <div className="card !p-0 overflow-hidden mb-6">
        <div className="relative bg-gradient-to-r from-[#EFECE3] via-[#E5E2D8] to-[#EFECE3] px-6 py-8">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
          <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-10 h-10 rounded-xl bg-[#E5E2D8] flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#000000]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-[#000000]">Companies</h1>
              </div>
              <p className="text-sm text-[#333333]">
                Discover and connect with {companies.length} {companies.length === 1 ? "company" : "companies"} in the network
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#333333]">
              <span className="px-3 py-1.5 rounded-lg bg-[#E5E2D8] font-medium">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className={`flex items-center gap-3 px-5 py-3.5 border-b transition-colors ${searchFocused ? "border-[var(--primary)]" : "border-[var(--divider)]"}`}>
          <svg className={`w-5 h-5 shrink-0 transition-colors ${searchFocused ? "text-[var(--primary)]" : "text-[var(--muted)]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search companies by name, industry, or description..."
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--muted)] outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-1 rounded-full hover:bg-[var(--surface)] text-[var(--muted)] transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter Row */}
        <div className="flex items-center gap-3 px-5 py-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] font-medium shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
            Filters
            {activeFilters > 0 && (
              <span className="w-4 h-4 rounded-full bg-[var(--primary)] text-[#EFECE3] text-[10px] flex items-center justify-center font-bold">
                {activeFilters}
              </span>
            )}
          </div>

          <select
            value={industryFilter}
            onChange={(e) => setIndustryFilter(e.target.value)}
            className="text-xs bg-[var(--surface)] text-[var(--foreground)] border border-[var(--divider)] rounded-lg px-3 py-1.5 outline-none focus:border-[var(--primary)] transition-colors cursor-pointer"
          >
            <option value="">All Industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>

          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="text-xs bg-[var(--surface)] text-[var(--foreground)] border border-[var(--divider)] rounded-lg px-3 py-1.5 outline-none focus:border-[var(--primary)] transition-colors cursor-pointer"
          >
            <option value="">All Locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <div className="h-4 w-px bg-[var(--divider)] hidden sm:block" />

          <div className="flex items-center gap-1">
            <span className="text-xs text-[var(--muted)] mr-1">Sort:</span>
            {([
              { key: "name" as SortKey, label: "Name" },
              { key: "rating" as SortKey, label: "Rating" },
              { key: "followers" as SortKey, label: "Popular" },
            ]).map((s) => (
              <button
                key={s.key}
                onClick={() => setSortBy(s.key)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                  sortBy === s.key
                    ? "bg-[var(--primary-light)] text-[var(--primary)]"
                    : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* View toggle */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--surface)]">
            <button
              onClick={() => setView("grid")}
              className={`p-1.5 rounded-md transition-colors ${view === "grid" ? "bg-[var(--card)] text-[var(--primary)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
              </svg>
            </button>
            <button
              onClick={() => setView("list")}
              className={`p-1.5 rounded-md transition-colors ${view === "list" ? "bg-[var(--card)] text-[var(--primary)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
              </svg>
            </button>
          </div>

          {activeFilters > 0 && (
            <>
              <div className="h-4 w-px bg-[var(--divider)] hidden sm:block" />
              <button
                onClick={() => { setIndustryFilter(""); setLocationFilter(""); }}
                className="text-xs text-[var(--danger)] hover:underline font-medium"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grid View */}
      {view === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((company) => {
            const followers = Array.isArray((company as any).followers) ? (company as any).followers as string[] : [];
            const isFollowing = user ? followers.includes(user.id) : false;
            const followerCount = followers.length;

            return (
              <Link key={company.id} href={`/companies/${company.id}`} className="block group">
                <div className="card !p-0 overflow-hidden h-full flex flex-col hover:border-[var(--primary)]/30 hover:shadow-lg hover:shadow-[var(--primary)]/5 transition-all">
                  {/* Mini Banner */}
                  <div className={`h-20 relative ${!company.banner_image ? `bg-gradient-to-r ${getBannerGradient(company.id)}` : ''}`}>
                    {company.banner_image ? (
                      <img src={company.banner_image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.3' fill-rule='evenodd'%3E%3Ccircle cx='3' cy='3' r='1.5'/%3E%3Ccircle cx='13' cy='13' r='1.5'/%3E%3C/g%3E%3C/svg%3E\")" }} />
                    )}
                  </div>

                  {/* Avatar — overlapping banner */}
                  <div className="px-4 -mt-7 relative z-10">
                    <div className="w-14 h-14 rounded-xl bg-[var(--card)] border-2 border-[var(--card)] shadow-md flex items-center justify-center text-xl font-bold text-[var(--primary)] overflow-hidden group-hover:border-[var(--primary)]/30 transition-colors">
                      {company.profile_image ? (
                        <img src={company.profile_image} alt={company.company_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="bg-[var(--primary-light)] w-full h-full flex items-center justify-center">
                          {company.company_name?.charAt(0)?.toUpperCase() || "?"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="px-4 pt-3 pb-4 flex flex-col flex-1">
                    {/* Name + Verified */}
                    <div className="flex items-center gap-1.5 mb-1">
                      <h3 className="font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate text-[15px]">
                        {company.company_name}
                      </h3>
                      {company.verified && (
                        <span className="shrink-0 text-[var(--accent)]">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </span>
                      )}
                    </div>

                    {/* Industry badge + Location */}
                    <div className="flex items-center gap-2 mb-2.5">
                      {company.industry && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">
                          {company.industry}
                        </span>
                      )}
                      {company.location && (
                        <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                          </svg>
                          {company.location}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed flex-1 mb-4">
                      {company.description || "No description available"}
                    </p>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 border-t border-[var(--divider)]">
                      <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                          {company.rating?.toFixed(1) || "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                          </svg>
                          {followerCount}
                        </span>
                      </div>
                      <button
                        onClick={(e) => toggleFollow(e, company.id)}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                          isFollowing
                            ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)] hover:bg-[var(--primary)] hover:text-[#EFECE3]"
                            : "border-[var(--divider)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                        }`}
                      >
                        {isFollowing ? "Following" : "+ Follow"}
                      </button>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === "list" && (
        <div className="space-y-3">
          {filtered.map((company) => {
            const followers = Array.isArray((company as any).followers) ? (company as any).followers as string[] : [];
            const isFollowing = user ? followers.includes(user.id) : false;
            const followerCount = followers.length;

            return (
              <Link key={company.id} href={`/companies/${company.id}`} className="block group">
                <div className="card hover:border-[var(--primary)]/30 hover:shadow-lg hover:shadow-[var(--primary)]/5 transition-all overflow-hidden p-0">
                  {/* Mini Banner */}
                  <div className="w-full h-14 relative">
                    {company.banner_image ? (
                      <img src={company.banner_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className={`w-full h-full ${getBannerGradient(company.id)}`}>
                        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '16px 16px' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-4 p-4 pt-3">
                    {/* Avatar */}
                    <div className="w-14 h-14 shrink-0 rounded-xl bg-[var(--surface)] flex items-center justify-center text-xl font-bold text-[var(--primary)] overflow-hidden group-hover:ring-2 group-hover:ring-[var(--primary)]/20 transition-all">
                      {company.profile_image ? (
                        <img src={company.profile_image} alt={company.company_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="bg-[var(--primary-light)] w-full h-full flex items-center justify-center">
                          {company.company_name?.charAt(0)?.toUpperCase() || "?"}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors truncate text-[15px]">
                              {company.company_name}
                            </h3>
                            {company.verified && (
                              <span className="shrink-0 text-[var(--accent)]">
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {company.industry && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">
                                {company.industry}
                              </span>
                            )}
                            {company.location && (
                              <span className="text-xs text-[var(--muted)] flex items-center gap-0.5">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                                </svg>
                                {company.location}
                              </span>
                            )}
                            <span className="text-xs text-[var(--muted)] flex items-center gap-1">
                              <svg className="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                              {company.rating?.toFixed(1) || "—"}
                            </span>
                            <span className="text-xs text-[var(--muted)]">{followerCount} followers</span>
                          </div>
                          <p className="text-sm text-[var(--muted)] line-clamp-1 mt-1.5 leading-relaxed">
                            {company.description || "No description available"}
                          </p>
                        </div>

                        {/* Follow button */}
                        <button
                          onClick={(e) => toggleFollow(e, company.id)}
                          className={`shrink-0 text-xs font-semibold px-4 py-2 rounded-full border transition-all mt-0.5 ${
                            isFollowing
                              ? "border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-light)] hover:bg-[var(--primary)] hover:text-[#EFECE3]"
                              : "border-[var(--divider)] text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                          }`}
                        >
                          {isFollowing ? "Following" : "+ Follow"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="card text-center py-16">
          <div className="w-16 h-16 rounded-full bg-[var(--surface)] flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
          </div>
          <p className="font-semibold text-[var(--foreground)]">No companies found</p>
          <p className="text-sm text-[var(--muted)] mt-1">Try adjusting your search or filters.</p>
          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(""); setIndustryFilter(""); setLocationFilter(""); }}
              className="text-sm text-[var(--primary)] font-semibold mt-3 hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

