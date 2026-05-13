"use client";

import { useState, useRef } from "react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/services/supabase";

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const REACTIONS = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "celebrate", emoji: "👏", label: "Celebrate" },
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "insightful", emoji: "💡", label: "Insightful" },
  { type: "curious", emoji: "🤔", label: "Curious" },
];

function renderContent(text: string) {
  if (!text) return null;
  const mentionRegex = /@([\w]+(?:\s[\w]+)*)/g;
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    if (match.index > lastIndex) elements.push(text.slice(lastIndex, match.index));
    elements.push(
      <span key={match.index} className="text-[var(--primary)] font-semibold cursor-pointer hover:underline">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) elements.push(text.slice(lastIndex));
  return elements.length > 0 ? elements : text;
}

interface Post {
  post_id: string;
  company_id: string;
  company_name: string;
  content: string;
  imageUrl?: string;
  images?: string[];
  created_at: any;
  likes: string[];
  reactions?: { userId: string; type: string }[];
  comments: { user_id: string; user_name: string; text: string; created_at: any }[];
}

interface CompanyInfo {
  id: string;
  company_name: string;
  industry: string;
  profile_image: string;
  followers: string[];
  verified?: boolean;
}

export default function PostCard({ post, allCompanies, onFollow, referrer }: { post: Post; allCompanies?: CompanyInfo[]; onFollow?: (id: string) => void; referrer?: string }) {
  const { user, profile } = useAuth();
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [commentCount, setCommentCount] = useState(3);
  const [copied, setCopied] = useState(false);
  const reactionTimeout = useRef<NodeJS.Timeout | null>(null);

  const likes: string[] = post.likes ?? [];
  const reactions = post.reactions ?? [];
  const comments: any[] = post.comments ?? [];
  const liked = user ? likes.includes(user.id) : false;
  const userReaction = user ? reactions.find((r) => r.userId === user.id) : null;
  const contentLong = post.content?.length > 300;
  const images = [...new Set(
    post.images?.length ? post.images : post.imageUrl ? [post.imageUrl] : []
  )];

  const reactionCounts = reactions.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topReactions = Object.entries(reactionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);
  const totalReactions = likes.length + reactions.length;

  const handleLike = async () => {
    if (!user) return;
    try {
      const nextLikes = liked ? likes.filter((id) => id !== user.id) : [...likes, user.id];
      const { error } = await supabase.from("posts").update({ likes: nextLikes }).eq("id", post.post_id);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to update like:", err);
    }
  };

  const handleReaction = async (type: string) => {
    if (!user) return;
    setShowReactions(false);
    try {
      const nextReactions = reactions.filter((r) => r.userId !== user.id);
      if (userReaction) {
        if (userReaction.type !== type) {
          nextReactions.push({ userId: user.id, type });
        }
      } else {
        const nextLikes = liked ? likes.filter((id) => id !== user.id) : likes;
        nextReactions.push({ userId: user.id, type });
        const { error: likeError } = await supabase.from("posts").update({ likes: nextLikes, reactions: nextReactions }).eq("id", post.post_id);
        if (likeError) throw likeError;
        return;
      }

      const { error } = await supabase.from("posts").update({ reactions: nextReactions }).eq("id", post.post_id);
      if (error) throw error;
    } catch (err) {
      console.error("Failed to update reaction:", err);
    }
  };

  const handleComment = async () => {
    if (!user || !comment.trim()) return;
    try {
      const nextComments = [
        ...comments,
        {
          user_id: user.id,
          user_name: profile?.company_name || "Unknown",
          text: comment.trim(),
          created_at: new Date().toISOString(),
        },
      ];
      const { error } = await supabase.from("posts").update({ comments: nextComments }).eq("id", post.post_id);
      if (error) throw error;
      setComment("");
    } catch (err) {
      console.error("Failed to post comment:", err);
    }
  };

  const handleReactionHover = (enter: boolean) => {
    if (reactionTimeout.current) clearTimeout(reactionTimeout.current);
    if (enter) setShowReactions(true);
    else reactionTimeout.current = setTimeout(() => setShowReactions(false), 300);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.origin + "/?post=" + post.post_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeReaction = userReaction
    ? REACTIONS.find((r) => r.type === userReaction.type)
    : liked
      ? REACTIONS[0]
      : null;

  return (
    <>
      <div className="card overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-3 pb-0">
          <div className="flex items-start gap-2">
            <a href={`/companies/${post.company_id}${referrer ? `?from=${referrer}` : ""}`} className="shrink-0">
              <div className="w-12 h-12 rounded-full bg-[var(--primary)] flex items-center justify-center text-[#EFECE3] text-lg font-bold overflow-hidden">
                {(() => {
                  const companyData = allCompanies?.find((c) => c.id === post.company_id);
                  return companyData?.profile_image
                    ? <img src={companyData.profile_image} alt="" className="w-full h-full object-cover" />
                    : post.company_name?.charAt(0)?.toUpperCase() || "?";
                })()}
              </div>
            </a>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <a href={`/companies/${post.company_id}${referrer ? `?from=${referrer}` : ""}`} className="font-semibold text-[var(--foreground)] text-sm leading-tight hover:text-[var(--primary)] hover:underline cursor-pointer">
                  {post.company_name}
                </a>
                {allCompanies?.find((c) => c.id === post.company_id)?.verified && (
                  <svg className="w-4 h-4 text-[var(--primary)] shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/></svg>
                )}
                {user && post.company_id !== user.id && onFollow && (() => {
                  const companyData = allCompanies?.find((c) => c.id === post.company_id);
                  const isFollowing = Array.isArray(companyData?.followers) && companyData.followers.includes(user.id);
                  return (
                    <>
                      <span className="text-[var(--divider)]">&#183;</span>
                      <button
                        onClick={() => onFollow(post.company_id)}
                        className={`text-xs font-semibold transition-colors ${isFollowing ? "text-[var(--muted)] hover:text-[var(--danger)]" : "text-[var(--primary)] hover:text-[var(--primary-hover)]"}`}
                      >
                        {isFollowing ? "Following" : "Follow"}
                      </button>
                    </>
                  );
                })()}
              </div>
              <p className="text-xs text-[var(--muted)] leading-tight mt-0.5">
                {(() => {
                  const companyData = allCompanies?.find((c) => c.id === post.company_id);
                  return companyData?.industry ? <><span>{companyData.industry}</span><span> &middot; </span></> : null;
                })()}
                {toDate(post.created_at)
                  ? formatDistanceToNow(toDate(post.created_at)!, { addSuffix: true })
                  : "Just now"}
                {" · "}
                <svg className="w-3 h-3 inline" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
                </svg>
              </p>
            </div>
            <button className="p-1.5 rounded-full hover:bg-[var(--surface)] text-[var(--muted)] shrink-0 transition-colors">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="6" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="18" r="2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-3">
          <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap leading-[1.42857]">
            {contentLong && !expanded
              ? renderContent(post.content.slice(0, 300) + "...")
              : renderContent(post.content)}
          </p>
          {contentLong && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-sm text-[var(--muted)] hover:text-[var(--primary)] font-semibold mt-1"
            >
              ...see more
            </button>
          )}
        </div>

        {/* Images */}
        {images.length > 0 && (
          <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-0.5"}>
            {images.slice(0, 4).map((url, i) => (
              <div
                key={i}
                className={`relative cursor-pointer overflow-hidden bg-[var(--surface)] ${
                  images.length === 1 ? "max-h-[512px]" : "aspect-square"
                }`}
                onClick={() => { setLightboxIndex(i); setImageExpanded(true); }}
              >
                <img
                  src={url}
                  alt={`Post image ${i + 1}`}
                  className={`w-full h-full ${images.length === 1 ? "object-contain" : "object-cover"} transition-transform hover:scale-[1.02]`}
                />
                {images.length > 4 && i === 3 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-[#EFECE3] text-2xl font-bold">+{images.length - 4}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Reactions count bar */}
        {(totalReactions > 0 || comments.length > 0) && (
          <div className="px-4 py-1.5 flex items-center justify-between text-xs text-[var(--muted)]">
            <div className="flex items-center gap-1">
              {totalReactions > 0 && (
                <>
                  <span className="flex -space-x-0.5">
                    {(topReactions.length > 0
                      ? topReactions.map(([type]) => REACTIONS.find((rx) => rx.type === type))
                      : [REACTIONS[0]]
                    )
                      .filter(Boolean)
                      .map((r, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[var(--primary)] text-[10px]"
                        >
                          {r!.emoji}
                        </span>
                      ))}
                  </span>
                  <span>{totalReactions}</span>
                </>
              )}
            </div>
            {comments.length > 0 && (
              <button
                onClick={() => setShowComments(!showComments)}
                className="hover:text-[var(--primary)] hover:underline"
              >
                {comments.length} comment{comments.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="border-t mx-4" style={{ borderColor: "var(--divider)" }} />
        <div className="flex items-center justify-around px-2 py-0.5">
          {/* Like with reaction picker */}
          <div
            className="relative flex-1"
            onMouseEnter={() => handleReactionHover(true)}
            onMouseLeave={() => handleReactionHover(false)}
          >
            {showReactions && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[var(--card)] border border-[var(--divider)] rounded-full px-2 py-1.5 flex items-center gap-0.5 shadow-xl shadow-black/30 z-20 animate-fadeIn">
                {REACTIONS.map((r) => (
                  <button
                    key={r.type}
                    onClick={() => handleReaction(r.type)}
                    className="group relative w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--surface)] hover:scale-125 transition-all duration-200"
                    title={r.label}
                  >
                    <span className="text-xl">{r.emoji}</span>
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-[var(--surface)] text-[var(--foreground)] text-[10px] font-semibold px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 py-3 px-3 rounded text-sm font-semibold transition-colors hover:bg-[var(--surface)] w-full justify-center ${
                activeReaction ? "text-[var(--primary)]" : "text-[var(--muted)]"
              }`}
            >
              {activeReaction ? (
                <span className="text-lg leading-none">{activeReaction.emoji}</span>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H14.23c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z"
                  />
                </svg>
              )}
              {activeReaction ? activeReaction.label : "Like"}
            </button>
          </div>

          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 py-3 px-3 rounded text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface)] flex-1 justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z"
              />
            </svg>
            Comment
          </button>

          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 py-3 px-3 rounded text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface)] flex-1 justify-center"
          >
            {copied ? (
              <>
                <svg className="w-5 h-5 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-[var(--success)]">Copied!</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
                  />
                </svg>
                Share
              </>
            )}
          </button>

          <button className="flex items-center gap-1.5 py-3 px-3 rounded text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface)] flex-1 justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
        </div>

        {/* Comments section */}
        {showComments && (
          <div className="border-t" style={{ borderColor: "var(--divider)" }}>
            {/* Comment input */}
            {user && (
              <div className="px-4 py-3 flex gap-2">
                <div className="w-8 h-8 rounded-full bg-[var(--primary)] flex items-center justify-center text-[#EFECE3] text-xs font-bold shrink-0 mt-0.5">
                  {profile?.company_name?.charAt(0)?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 relative">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment..."
                    className="w-full border border-[var(--divider)] rounded-full px-4 py-2 pr-20 text-sm text-[var(--foreground)] placeholder-[var(--muted)] bg-[var(--surface)] outline-none hover:bg-[var(--surface-hover)] focus:bg-[var(--surface)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)] transition-all"
                    onKeyDown={(e) => e.key === "Enter" && handleComment()}
                  />
                  {comment.trim() && (
                    <button
                      onClick={handleComment}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--primary)] hover:text-[var(--primary-hover)] font-semibold text-sm px-2 py-1 rounded transition-colors"
                    >
                      Post
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Comments list */}
            {comments.length > 0 && (
              <div className="px-4 pb-3 space-y-3">
                {comments.slice(0, commentCount).map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="w-8 h-8 rounded-full bg-[var(--surface-hover)] flex items-center justify-center text-[var(--foreground)] text-xs font-bold shrink-0 mt-0.5">
                      {(c.user_name || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="bg-[var(--surface)] rounded-lg px-3 py-2">
                        <p className="text-sm font-semibold text-[var(--foreground)] leading-tight">
                          {c.user_name}
                        </p>
                        <p className="text-sm text-[var(--foreground-secondary)] mt-0.5 leading-[1.42857]">
                          {renderContent(c.text)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-1">
                        <span className="text-xs text-[var(--muted)]">
                          {toDate(c.created_at)
                            ? formatDistanceToNow(toDate(c.created_at)!, { addSuffix: true })
                            : "Just now"}
                        </span>
                        <button className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
                          Like
                        </button>
                        <button className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {comments.length > commentCount && (
                  <button
                    onClick={() => setCommentCount((prev) => prev + 5)}
                    className="text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)] pl-10 transition-colors"
                  >
                    Load more comments
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Image lightbox */}
      {imageExpanded && images.length > 0 && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setImageExpanded(false)}
        >
          <button
            onClick={() => setImageExpanded(false)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-[var(--surface)] flex items-center justify-center text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors z-10"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <img
            src={images[lightboxIndex]}
            alt="Post image"
            className="max-w-full max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

