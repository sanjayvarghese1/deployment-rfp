"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import ProfileHeader from "@/components/ProfileHeader";
import PostCard from "@/components/PostCard";
import ContractCard from "@/components/ContractCard";
import { supabase } from "@/services/supabase";


export default function ProfilePage() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState<any[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [activeSection, setActiveSection] = useState<"about" | "activity" | "contracts" | "reviews" | "notifications" | "verification" | "settings">("about");
  const [editForm, setEditForm] = useState({
    company_name: "",
    industry: "",
    location: "",
    website: "",
    description: "",
    founded_year: "",
    company_size: "",
    phone: "",
    registration_number: "",
    specialties_text: "",
  });
  const [saving, setSaving] = useState(false);
  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (profile) {
      setEditForm({
        company_name: profile.company_name || "",
        industry: profile.industry || "",
        location: profile.location || "",
        website: profile.website || "",
        description: profile.description || "",
        founded_year: profile.founded_year || "",
        company_size: profile.company_size || "",
        phone: profile.phone || "",
        registration_number: profile.registration_number || "",
        specialties_text: (profile.specialties ?? []).join(", "),
      });
    }
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [postsRes, contractsRes, reviewsRes, notificationsRes] = await Promise.all([
        supabase.from("posts").select("*").eq("company_id", user.id),
        supabase.from("contracts").select("*").eq("posted_by", user.id),
        supabase.from("reviews").select("*").eq("company_id", user.id),
        supabase.from("notifications").select("*").eq("user_id", user.id).order("timestamp", { ascending: false }),
      ]);

      setPosts((postsRes.data || []) as any[]);
      setContracts((contractsRes.data || []) as any[]);
      setReviews((reviewsRes.data || []) as any[]);
      setNotifications((notificationsRes.data || []) as any[]);
    })();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const specialties = editForm.specialties_text.split(",").map(s => s.trim()).filter(Boolean);
      const { error } = await supabase.from("users").update({
        company_name: editForm.company_name,
        industry: editForm.industry,
        location: editForm.location,
        website: editForm.website,
        description: editForm.description,
        founded_year: editForm.founded_year,
        company_size: editForm.company_size,
        phone: editForm.phone,
        registration_number: editForm.registration_number,
        specialties,
      }).eq("id", user.id);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to save profile:", err);
      alert("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) { alert("Please upload a valid image (JPEG, PNG, GIF, or WebP)."); return; }
    if (file.size > 500_000) { alert("Image must be under 500 KB."); return; }
    setUploadingImage(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { error } = await supabase.from("users").update({ profile_image: dataUrl }).eq("id", user.id);
      if (error) throw error;
    } catch (err) {
      console.error("Image upload failed:", err);
      alert("Image upload failed. Please try a smaller file.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validTypes.includes(file.type)) { alert("Please upload a valid image (JPEG, PNG, GIF, or WebP)."); return; }
    setUploadingBanner(true);
    try {
      // Compress banner to fit Supabase limits
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new window.Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX_W = 1400, MAX_H = 400;
            let w = img.width, h = img.height;
            if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
            if (h > MAX_H) { w = Math.round(w * MAX_H / h); h = MAX_H; }
            canvas.width = w;
            canvas.height = h;
            canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.75));
          };
          img.onerror = () => reject(new Error("Failed to process image."));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error("Failed to read image file."));
        reader.readAsDataURL(file);
      });
      const { error } = await supabase.from("users").update({ banner_image: dataUrl }).eq("id", user.id);
      if (error) throw error;
    } catch (err) {
      console.error("Banner upload failed:", err);
      alert("Banner upload failed. Please try a smaller image.");
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleLicenseUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 700_000) { alert("License file must be under 700 KB."); return; }
    setUploadingLicense(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const licenseEntry = { name: file.name, url: dataUrl, uploaded_at: new Date().toISOString() };
      const nextLicenses = [...licenses, licenseEntry];
      const { error } = await supabase.from("users").update({
        licenses: nextLicenses,
        verified: true,
      }).eq("id", user.id);
      if (error) throw error;
    } catch (err) {
      console.error("License upload failed:", err);
      alert("License upload failed. Please try a smaller file.");
    } finally {
      setUploadingLicense(false);
    }
  };

  // Review stats
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length : 0;
  const ratingBreakdown = [5, 4, 3, 2, 1].map(star => ({
    star,
    count: reviews.filter(r => r.rating === star).length,
    pct: reviews.length > 0 ? (reviews.filter(r => r.rating === star).length / reviews.length) * 100 : 0,
  }));

  if (!user || !profile) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#D4D1C8" }}>
          <svg className="w-8 h-8" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
        </div>
        <p className="font-medium" style={{ color: "#333333" }}>Please sign in to view your profile</p>
      </div>
    </div>
  );

  const licenses = profile?.licenses ?? [];
  const specialties = profile?.specialties ?? [];

  const navItems = [
    { key: "about", label: "About" },
    { key: "activity", label: "Activity" },
    { key: "contracts", label: "Contracts" },
    { key: "reviews", label: `Reviews (${reviews.length})` },
    { key: "notifications", label: `Notifications (${notifications.filter(n => !n.read).length})` },
    { key: "verification", label: "Verification" },
    { key: "settings", label: "Settings" },
  ] as const;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8" style={{ minHeight: "100vh" }}>
      {/* Profile Header */}
      <ProfileHeader
        {...profile}
        isOwn={true}
        reviewCount={reviews.length}
        onImageUpload={handleImageUpload}
        uploadingImage={uploadingImage}
        onBannerUpload={handleBannerUpload}
        uploadingBanner={uploadingBanner}
      />

      {/* Navigation Tabs */}
      <div className="mt-6 rounded-xl overflow-hidden" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
        <div className="flex overflow-x-auto scrollbar-none">
          {navItems.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className="px-5 py-3 text-sm font-medium whitespace-nowrap transition-all"
              style={{
                color: activeSection === key ? "#000000" : "#333333",
                background: activeSection === key ? "#D4D1C8" : "transparent",
                borderBottom: activeSection === key ? "2px solid #000000" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">

          {/* === ABOUT SECTION === */}
          {activeSection === "about" && (
            <>
              {!editing ? (
                /* ── VIEW MODE ── */
                <>
                  {/* Company Overview */}
                  <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold" style={{ color: "#000000" }}>About</h2>
                      <button
                        onClick={() => setEditing(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all hover:opacity-80"
                        style={{ background: "#000000", color: "#EFECE3" }}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                        Edit Profile
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "#333333" }}>
                      {profile.description || "No description added yet. Click Edit Profile to add one."}
                    </p>
                  </div>

                  {/* Company Details — clean list */}
                  <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                    <h2 className="text-lg font-bold mb-4" style={{ color: "#000000" }}>Company Details</h2>
                    <div className="space-y-0 divide-y" style={{ borderColor: "#D4D1C8" }}>
                      {[
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>, label: "Industry", value: profile.industry },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>, label: "Location", value: profile.location },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>, label: "Founded", value: profile.founded_year },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>, label: "Company Size", value: profile.company_size ? `${profile.company_size} employees` : "" },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>, label: "Phone", value: profile.phone },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" /></svg>, label: "Registration No.", value: profile.registration_number },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>, label: "Website", value: profile.website, isLink: true },
                        { icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>, label: "Email", value: profile.email },
                      ].filter(item => item.value).map((item, i) => (
                        <div key={i} className="flex items-center justify-between py-3 first:pt-0 last:pb-0" style={{ borderColor: "#D4D1C8" }}>
                          <div className="flex items-center gap-2.5">
                            <span style={{ color: "#4A70A9" }}>{item.icon}</span>
                            <span className="text-sm" style={{ color: "#888" }}>{item.label}</span>
                          </div>
                          {item.isLink ? (
                            <a href={item.value!.startsWith("http") ? item.value! : `https://${item.value}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline" style={{ color: "#4A70A9" }}>{item.value}</a>
                          ) : (
                            <span className="text-sm font-semibold" style={{ color: "#000000" }}>{item.value}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {!profile.industry && !profile.location && !profile.founded_year && (
                      <div className="text-center py-6">
                        <p className="text-sm" style={{ color: "#333333" }}>No company details added yet.</p>
                        <button onClick={() => setEditing(true)} className="mt-2 text-sm font-medium" style={{ color: "#4A70A9" }}>+ Add details</button>
                      </div>
                    )}
                  </div>

                  {/* Specialties */}
                  {specialties.length > 0 && (
                    <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                      <h2 className="text-lg font-bold mb-4" style={{ color: "#000000" }}>Specialties</h2>
                      <div className="flex flex-wrap gap-2">
                        {specialties.map((s, i) => (
                          <span key={i} className="text-sm font-medium px-4 py-2 rounded-full" style={{ color: "#4A70A9", background: "#EFECE3", border: "1px solid #D4D1C8" }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ── EDIT MODE ── */
                <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-bold" style={{ color: "#000000" }}>Edit Profile</h2>
                    <button
                      onClick={() => setEditing(false)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-all hover:opacity-80"
                      style={{ background: "#D4D1C8", color: "#000000" }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Company Name *</label>
                      <input value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Industry *</label>
                      <input value={editForm.industry} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Location *</label>
                      <input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Founded Year</label>
                      <input value={editForm.founded_year} onChange={(e) => setEditForm({ ...editForm, founded_year: e.target.value })} placeholder="e.g. 2015" className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Company Size</label>
                      <select value={editForm.company_size} onChange={(e) => setEditForm({ ...editForm, company_size: e.target.value })} className="input-field">
                        <option value="">Select size</option>
                        <option value="1-10">1-10</option>
                        <option value="11-50">11-50</option>
                        <option value="51-200">51-200</option>
                        <option value="201-500">201-500</option>
                        <option value="501-1000">501-1000</option>
                        <option value="1000+">1000+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Phone</label>
                      <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+91 ..." className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Registration / License No.</label>
                      <input value={editForm.registration_number} onChange={(e) => setEditForm({ ...editForm, registration_number: e.target.value })} placeholder="e.g. CIN/GSTIN/Trade Lic." className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Website</label>
                      <input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} placeholder="https://..." className="input-field" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Specialties</label>
                      <input value={editForm.specialties_text} onChange={(e) => setEditForm({ ...editForm, specialties_text: e.target.value })} placeholder="e.g. IT Services, Cloud Computing (comma separated)" className="input-field" />
                      <p className="text-xs mt-1" style={{ color: "#888" }}>Separate multiple specialties with commas</p>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>About / Description</label>
                      <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={4} placeholder="Tell others about your company..." className="input-field" />
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      onClick={async () => { await handleSave(); setEditing(false); }}
                      disabled={saving}
                      className="px-6 py-2.5 text-sm font-semibold rounded-lg transition-all"
                      style={{ background: "#000000", color: "#EFECE3" }}
                    >
                      {saving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="px-6 py-2.5 text-sm font-medium rounded-lg transition-all"
                      style={{ background: "#D4D1C8", color: "#000000" }}
                    >
                      Cancel
                    </button>
                    {saving && <span className="text-sm" style={{ color: "#333333" }}>Updating profile...</span>}
                  </div>
                </div>
              )}
            </>
          )}

          {/* === ACTIVITY SECTION === */}
          {activeSection === "activity" && (
            <div className="space-y-4">
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "#000000" }}>
                  Activity
                  <span className="text-sm font-normal ml-1" style={{ color: "#333333" }}>({posts.length} posts)</span>
                </h2>
              </div>
              {posts.length === 0 ? (
                <div className="rounded-xl text-center py-10" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                  <p className="font-medium" style={{ color: "#333333" }}>No activity yet</p>
                  <p className="text-sm mt-1" style={{ color: "#333333" }}>Posts you create will appear here</p>
                </div>
              ) : (
                posts.map((p) => <PostCard key={p.post_id} post={p} />)
              )}
            </div>
          )}

          {/* === CONTRACTS SECTION === */}
          {activeSection === "contracts" && (
            <div className="space-y-4">
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "#000000" }}>
                  Contracts
                  <span className="text-sm font-normal ml-1" style={{ color: "#333333" }}>({contracts.length})</span>
                </h2>
              </div>
              {contracts.length === 0 ? (
                <div className="rounded-xl text-center py-10" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                  <p className="font-medium" style={{ color: "#333333" }}>No contracts posted</p>
                  <p className="text-sm mt-1" style={{ color: "#333333" }}>Your procurement contracts will appear here</p>
                </div>
              ) : (
                <div className="grid gap-4">{contracts.map((c) => <ContractCard key={c.contract_id} contract={c} />)}</div>
              )}
            </div>
          )}

          {/* === REVIEWS SECTION === */}
          {activeSection === "reviews" && (
            <div className="space-y-4">
              {/* Rating Overview Card */}
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold mb-5" style={{ color: "#000000" }}>Reviews & Ratings</h2>
                <div className="flex flex-col sm:flex-row gap-6">
                  {/* Big Rating */}
                  <div className="text-center sm:text-left shrink-0">
                    <div className="text-5xl font-bold" style={{ color: "#000000" }}>{avgRating.toFixed(1)}</div>
                    <div className="flex justify-center sm:justify-start mt-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <span key={s} className="text-xl" style={{ color: s <= Math.round(avgRating) ? "#fbbf24" : "#B8B5AC" }}>{"\u2605"}</span>
                      ))}
                    </div>
                    <p className="text-sm mt-1" style={{ color: "#333333" }}>{reviews.length} review{reviews.length !== 1 ? "s" : ""}</p>
                  </div>
                  {/* Breakdown Bars */}
                  <div className="flex-1 space-y-2">
                    {ratingBreakdown.map(({ star, count, pct }) => (
                      <div key={star} className="flex items-center gap-3">
                        <span className="text-sm font-medium w-8 text-right" style={{ color: "#333333" }}>{star}{"\u2605"}</span>
                        <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#D4D1C8" }}>
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "#fbbf24" }} />
                        </div>
                        <span className="text-sm w-8" style={{ color: "#333333" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Individual Reviews */}
              {reviews.length === 0 ? (
                <div className="rounded-xl text-center py-10" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                  <p className="font-medium" style={{ color: "#333333" }}>No reviews yet</p>
                  <p className="text-sm mt-1" style={{ color: "#333333" }}>Reviews from other companies will appear here</p>
                </div>
              ) : (
                reviews.map((r) => (
                  <div key={r.review_id} className="rounded-xl p-5 transition-all" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#D4D1C8", color: "#333333" }}>
                        {(r.reviewer_name || "A").charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm" style={{ color: "#444444" }}>{r.reviewer_name || "Anonymous Company"}</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map(s => (
                              <span key={s} className="text-sm" style={{ color: s <= r.rating ? "#fbbf24" : "#B8B5AC" }}>{"\u2605"}</span>
                            ))}
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed" style={{ color: "#333333" }}>{r.comment}</p>
                        {r.created_at && (
                          <p className="text-xs mt-2" style={{ color: "#333333" }}>
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

          {/* === NOTIFICATIONS SECTION === */}
          {activeSection === "notifications" && (
            <div className="space-y-4">
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "#000000" }}>
                  Notifications
                  {notifications.filter(n => !n.read).length > 0 && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#000000", color: "#000000" }}>
                      {notifications.filter(n => !n.read).length} unread
                    </span>
                  )}
                </h2>
              </div>
              {notifications.length === 0 ? (
                <div className="rounded-xl text-center py-10" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                  <svg className="w-12 h-12 mx-auto mb-3" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                  </svg>
                  <p className="font-medium" style={{ color: "#333333" }}>No notifications yet</p>
                  <p className="text-sm mt-1" style={{ color: "#333333" }}>You&apos;ll get notified about proposals, messages, and more</p>
                </div>
              ) : (
                notifications.map((n) => {
                  const ts = n.timestamp ? new Date(n.timestamp) : null;
                  return (
                    <div key={n.notification_id} className="rounded-xl p-4 transition-all" style={{ background: n.read ? "#E5E2D8" : "#E5E2D8", border: `1px solid ${n.read ? "#D4D1C8" : "#B8B5AC"}` }}>
                      <div className="flex items-start gap-3">
                        {!n.read && <span className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0" style={{ background: "#000000" }} />}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed" style={{ color: n.read ? "#333333" : "#000000", fontWeight: n.read ? 400 : 500 }}>{n.message}</p>
                          <div className="flex items-center gap-2 mt-2">
                            {ts && <span className="text-xs" style={{ color: "#333333" }}>{ts.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>}
                            <span className="text-xs capitalize" style={{ color: "#000000" }}>{n.type?.replace(/_/g, " ")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* === VERIFICATION SECTION === */}
          {activeSection === "verification" && (
            <div className="space-y-6">
              {/* Verification Status */}
              <div className="rounded-xl p-6" style={{ background: profile.verified ? "#0a2e1a" : "#2e2408", border: `1px solid ${profile.verified ? "#166534" : "#854d0e"}` }}>
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{ background: profile.verified ? "#14532d" : "#422006" }}>
                    {profile.verified ? (
                      <svg className="w-7 h-7" style={{ color: "#4ade80" }} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                    ) : (
                      <svg className="w-7 h-7" style={{ color: "#fbbf24" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: profile.verified ? "#4ade80" : "#fbbf24" }}>
                      {profile.verified ? "Verified Company \u2713" : "Not Yet Verified"}
                    </h3>
                    <p className="text-sm mt-1" style={{ color: profile.verified ? "#86efac" : "#fde68a" }}>
                      {profile.verified
                        ? "Your company has been verified. Your profile displays a verification badge visible to all users."
                        : "Upload your company license and registration documents to get a verified badge on your profile."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Requirements Checklist */}
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold mb-4" style={{ color: "#000000" }}>Verification Requirements</h2>
                <div className="space-y-3">
                  {[
                    { label: "Company license or registration document", done: licenses.length > 0 },
                    { label: "Company name", done: !!profile.company_name },
                    { label: "Industry specified", done: !!profile.industry },
                    { label: "Location added", done: !!profile.location },
                    { label: "Company description", done: !!profile.description },
                    { label: "Registration/License number", done: !!profile.registration_number },
                  ].map((req, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: req.done ? "#0a2e1a" : "#E5E2D8" }}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: req.done ? "#166534" : "#D4D1C8" }}>
                        {req.done ? (
                          <svg className="w-3.5 h-3.5 text-[#EFECE3]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                        ) : (
                          <div className="w-2 h-2 rounded-full" style={{ background: "#333333" }} />
                        )}
                      </div>
                      <span className="text-sm font-medium" style={{ color: req.done ? "#4ade80" : "#333333" }}>{req.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upload License */}
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold mb-2" style={{ color: "#000000" }}>Upload Documents</h2>
                <p className="text-sm mb-5" style={{ color: "#333333" }}>Upload your company trade license, registration certificate, or other official documents (PDF, DOC, PNG, JPG).</p>

                <label className={`group relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer`} style={{ borderColor: uploadingLicense ? "#000000" : "#D4D1C8", background: uploadingLicense ? "#E5E2D8" : "#E5E2D8" }}>
                  <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={handleLicenseUpload} disabled={uploadingLicense} className="hidden" />
                  {uploadingLicense ? (
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mb-2" style={{ borderColor: "#000000", borderTopColor: "transparent" }} />
                      <p className="text-sm font-medium" style={{ color: "#000000" }}>Uploading document...</p>
                    </div>
                  ) : (
                    <>
                      <svg className="w-10 h-10 mb-2" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                      <p className="text-sm font-medium" style={{ color: "#444444" }}>Click to upload or drag & drop</p>
                      <p className="text-xs mt-1" style={{ color: "#333333" }}>PDF, DOC, PNG, JPG up to 10MB</p>
                    </>
                  )}
                </label>

                {/* Uploaded Documents List */}
                {licenses.length > 0 && (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold mb-3" style={{ color: "#444444" }}>Uploaded Documents ({licenses.length})</h3>
                    <div className="space-y-2">
                      {licenses.map((lic, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg transition-colors" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#D4D1C8" }}>
                            <svg className="w-5 h-5" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <a href={lic.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium truncate block" style={{ color: "#444444" }}>{lic.name}</a>
                            <p className="text-xs" style={{ color: "#333333" }}>{new Date(lic.uploaded_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
                          </div>
                          <svg className="w-4 h-4" style={{ color: "#333333" }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === SETTINGS SECTION === */}
          {activeSection === "settings" && (
            <div className="space-y-6">
              {/* Profile Image */}
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold mb-4" style={{ color: "#000000" }}>Profile Image</h2>
                <div className="flex items-center gap-5">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold shrink-0 overflow-hidden" style={{ background: "#D4D1C8", color: "#333333" }}>
                    {profile.profile_image ? (
                      <img src={profile.profile_image} alt={profile.company_name} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      profile.company_name?.charAt(0) || "?"
                    )}
                  </div>
                  <div>
                    <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all" style={{ background: "#D4D1C8", color: uploadingImage ? "#333333" : "#000000", border: "1px solid #B8B5AC" }}>
                      <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} className="hidden" />
                      {uploadingImage ? "Uploading..." : "Change Photo"}
                    </label>
                    <p className="text-xs mt-2" style={{ color: "#333333" }}>JPG, PNG. Max 5MB. Recommended 400x400px.</p>
                  </div>
                </div>
              </div>

              {/* Company Information */}
              <div className="rounded-xl p-6" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
                <h2 className="text-lg font-bold mb-5" style={{ color: "#000000" }}>Company Information</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Company Name *</label>
                    <input value={editForm.company_name} onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Industry *</label>
                    <input value={editForm.industry} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Location *</label>
                    <input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Founded Year</label>
                    <input value={editForm.founded_year} onChange={(e) => setEditForm({ ...editForm, founded_year: e.target.value })} placeholder="e.g. 2015" className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Company Size</label>
                    <select value={editForm.company_size} onChange={(e) => setEditForm({ ...editForm, company_size: e.target.value })} className="input-field">
                      <option value="">Select size</option>
                      <option value="1-10">1-10</option>
                      <option value="11-50">11-50</option>
                      <option value="51-200">51-200</option>
                      <option value="201-500">201-500</option>
                      <option value="501-1000">501-1000</option>
                      <option value="1000+">1000+</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Phone</label>
                    <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="+91 ..." className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Registration / License No.</label>
                    <input value={editForm.registration_number} onChange={(e) => setEditForm({ ...editForm, registration_number: e.target.value })} placeholder="e.g. CIN/GSTIN/Trade Lic." className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Website</label>
                    <input value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })} placeholder="https://..." className="input-field" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>Specialties</label>
                    <input value={editForm.specialties_text} onChange={(e) => setEditForm({ ...editForm, specialties_text: e.target.value })} placeholder="e.g. IT Services, Cloud Computing, Cybersecurity (comma separated)" className="input-field" />
                    <p className="text-xs mt-1" style={{ color: "#333333" }}>Separate multiple specialties with commas</p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1.5" style={{ color: "#444444" }}>About / Description</label>
                    <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={4} placeholder="Tell others about your company, what you do, your mission..." className="input-field" />
                  </div>
                </div>
                <div className="mt-6 flex items-center gap-3">
                  <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-semibold rounded-lg transition-all" style={{ background: "#000000", color: "#EFECE3" }}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  {saving && <span className="text-sm" style={{ color: "#333333" }}>Updating profile...</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Quick Stats Card */}
          <div className="rounded-xl p-5" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
            <h3 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: "#444444" }}>Profile Stats</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#333333" }}>Rating</span>
                <div className="flex items-center gap-1">
                  <span style={{ color: "#fbbf24" }}>{"\u2605"}</span>
                  <span className="text-sm font-bold" style={{ color: "#000000" }}>{avgRating.toFixed(1)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#333333" }}>Reviews</span>
                <span className="text-sm font-bold" style={{ color: "#000000" }}>{reviews.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#333333" }}>Posts</span>
                <span className="text-sm font-bold" style={{ color: "#000000" }}>{posts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#333333" }}>Contracts</span>
                <span className="text-sm font-bold" style={{ color: "#000000" }}>{contracts.length}</span>
              </div>
              <div className="my-1" style={{ height: "1px", background: "#D4D1C8" }} />
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: "#333333" }}>Status</span>
                <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: profile.verified ? "#0a2e1a" : "#2e2408", color: profile.verified ? "#4ade80" : "#fbbf24", border: `1px solid ${profile.verified ? "#166534" : "#854d0e"}` }}>
                  {profile.verified ? "\u2713 Verified" : "\u25cb Unverified"}
                </span>
              </div>
            </div>
          </div>

          {/* Verification Progress */}
          {!profile.verified && (
            <div className="rounded-xl p-5" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
              <h3 className="text-sm font-bold mb-2" style={{ color: "#000000" }}>Get Verified</h3>
              <p className="text-xs mb-3" style={{ color: "#333333" }}>Complete your profile and upload documents to earn the verification badge.</p>
              <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#D4D1C8" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    background: "#000000",
                    width: `${Math.round(([!!profile.company_name, !!profile.industry, !!profile.location, !!profile.description, !!profile.registration_number, licenses.length > 0].filter(Boolean).length / 6) * 100)}%`
                  }}
                />
              </div>
              <p className="text-xs mt-2 font-medium" style={{ color: "#000000" }}>
                {[!!profile.company_name, !!profile.industry, !!profile.location, !!profile.description, !!profile.registration_number, licenses.length > 0].filter(Boolean).length} of 6 steps complete
              </p>
              <button onClick={() => setActiveSection("verification")} className="mt-3 w-full text-center text-xs font-semibold rounded-lg py-2 transition-colors" style={{ color: "#000000", background: "#EFECE3", border: "1px solid #D4D1C8" }}>
                Complete Verification \u2192
              </button>
            </div>
          )}

          {/* Recent Reviews Sidebar */}
          {reviews.length > 0 && activeSection !== "reviews" && (
            <div className="rounded-xl p-5" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "#444444" }}>Recent Reviews</h3>
                <button onClick={() => setActiveSection("reviews")} className="text-xs font-medium" style={{ color: "#000000" }}>View all</button>
              </div>
              <div className="space-y-3">
                {reviews.slice(0, 3).map((r) => (
                  <div key={r.review_id} className="pb-3 last:pb-0" style={{ borderBottom: "1px solid #D4D1C8" }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold truncate" style={{ color: "#444444" }}>{r.reviewer_name || "Anonymous"}</span>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map(s => (
                          <span key={s} className="text-xs" style={{ color: s <= r.rating ? "#fbbf24" : "#B8B5AC" }}>{"\u2605"}</span>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs line-clamp-2" style={{ color: "#333333" }}>{r.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Member Since */}
          <div className="rounded-xl p-5" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
            <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: "#444444" }}>Member Since</h3>
            <p className="text-sm" style={{ color: "#333333" }}>
              {profile.created_at ? new Date(profile.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "Unknown"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
