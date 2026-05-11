interface ProfileHeaderProps {
  company_name: string;
  industry: string;
  location: string;
  website: string;
  description: string;
  rating: number;
  followers: string[];
  profile_image: string;
  banner_image?: string;
  verified?: boolean;
  founded_year?: string;
  company_size?: string;
  specialties?: string[];
  phone?: string;
  registration_number?: string;
  reviewCount?: number;
  onFollow?: () => void;
  isFollowing?: boolean;
  isOwn?: boolean;
  onImageUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingImage?: boolean;
  onBannerUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingBanner?: boolean;
}

export default function ProfileHeader({
  company_name, industry, location, website, description, rating, followers, profile_image,
  banner_image, verified, founded_year, company_size, specialties, phone, reviewCount,
  onFollow, isFollowing, isOwn, onImageUpload, uploadingImage, onBannerUpload, uploadingBanner
}: ProfileHeaderProps) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#E5E2D8", border: "1px solid #D4D1C8" }}>
      {/* Cover Banner */}
      <div className="relative h-32 sm:h-48 group/banner" style={{ background: "linear-gradient(135deg, #4A70A9 0%, #6B8DC4 50%, #4A70A9 100%)" }}>
        {banner_image ? (
          <img src={banner_image} alt="Banner" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 30% 50%, rgba(74, 112, 169, 0.15) 0%, transparent 50%), radial-gradient(circle at 70% 50%, rgba(74, 112, 169, 0.1) 0%, transparent 50%)" }} />
        )}
        {isOwn && onBannerUpload && (
          <label className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/banner:opacity-100 transition-opacity cursor-pointer" style={{ background: "rgba(0,0,0,0.35)" }}>
            <input type="file" accept="image/*" onChange={onBannerUpload} disabled={uploadingBanner} className="hidden" />
            {uploadingBanner ? (
              <div className="w-8 h-8 border-2 border-[#EFECE3] border-t-transparent rounded-full animate-spin" />
            ) : (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: "rgba(0,0,0,0.5)" }}>
                <svg className="w-5 h-5" style={{ color: "#EFECE3" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                </svg>
                <span className="text-sm font-medium" style={{ color: "#EFECE3" }}>{banner_image ? "Change Banner" : "Add Banner"}</span>
              </div>
            )}
          </label>
        )}
      </div>

      {/* Profile Content */}
      <div className="relative px-6 sm:px-8 pb-6">
        {/* Avatar row */}
        <div className="flex items-end justify-between -mt-14 sm:-mt-16 mb-4">
          <div className="shrink-0 relative group">
            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-full overflow-hidden" style={{ border: "4px solid #E5E2D8", background: "#D4D1C8" }}>
              {profile_image ? (
                <img src={profile_image} alt={company_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: "#D4D1C8" }}>
                  <span className="text-4xl sm:text-5xl font-bold select-none" style={{ color: "#333333" }}>
                    {company_name?.charAt(0)?.toUpperCase() || "?"}
                  </span>
                </div>
              )}
            </div>
            {/* Camera overlay for own profile */}
            {isOwn && onImageUpload && (
              <label className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" style={{ background: "rgba(0,0,0,0.5)" }}>
                <input type="file" accept="image/*" onChange={onImageUpload} disabled={uploadingImage} className="hidden" />
                {uploadingImage ? (
                  <div className="w-6 h-6 border-2 border-[#EFECE3] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-6 h-6" style={{ color: "#EFECE3" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                  </svg>
                )}
              </label>
            )}
          </div>

          {/* Actions (right-aligned, at avatar bottom level) */}
          <div className="flex gap-2 shrink-0 pb-1">
            {!isOwn && onFollow && (
              <button
                onClick={onFollow}
                className="px-5 py-2 text-sm font-medium rounded-lg transition-all"
                style={{
                  color: isFollowing ? "#333333" : "#EFECE3",
                  background: isFollowing ? "transparent" : "#000000",
                  border: isFollowing ? "1px solid #B8B5AC" : "1px solid #000000",
                }}
              >
                {isFollowing ? "Following" : "+ Follow"}
              </button>
            )}
            {!isOwn && (
              <a href={`/messages?to=${company_name}`} className="px-5 py-2 text-sm font-medium rounded-lg transition-all" style={{ color: "#444444", border: "1px solid #B8B5AC" }}>Message</a>
            )}
          </div>
        </div>

        {/* Company Name & Info (below banner) */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: "#000000" }}>{company_name || "Unnamed Company"}</h1>
            {verified && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold shrink-0 px-2 py-0.5 rounded-full" style={{ color: "#000000", background: "#E5E2D8" }}>
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                Verified
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-1.5" style={{ color: "#444444" }}>{industry || "Company"}</p>
          <p className="text-xs mt-1.5" style={{ color: "#333333" }}>
            {[location, founded_year ? `Est. ${founded_year}` : "", company_size ? `${company_size} employees` : ""].filter(Boolean).join(" \u00b7 ")}
          </p>
          <div className="flex items-center gap-4 mt-3">
            <span className="text-sm font-semibold" style={{ color: "#444444" }}>{reviewCount ?? 0} <span style={{ color: "#333333", fontWeight: 400 }}>reviews</span></span>
            {rating > 0 && <span className="text-sm font-semibold" style={{ color: "#000000" }}>{"★"} {rating.toFixed(1)}</span>}
          </div>
        </div>

        {/* Description */}
        {description && (
          <p className="text-sm leading-relaxed mt-5 pt-5" style={{ color: "#444444", borderTop: "1px solid #D4D1C8" }}>{description}</p>
        )}

        {/* Info pills */}
        {(website || phone || (specialties && specialties.length > 0)) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4">
            {website && (
              <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer" className="text-sm transition-colors" style={{ color: "#000000" }}>
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {phone && (
              <span className="text-sm" style={{ color: "#333333" }}>{phone}</span>
            )}
            {(specialties ?? []).slice(0, 5).map((s, i) => (
              <span key={i} className="text-xs font-medium px-3 py-1 rounded-full" style={{ color: "#333333", background: "#D4D1C8" }}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
