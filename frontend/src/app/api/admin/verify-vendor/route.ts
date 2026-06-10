import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized: Missing header" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    // Use the anon key to authenticate the caller token
    const authSupabase = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
    const { data: { user }, error: authError } = await authSupabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized: Invalid token" }, { status: 401 });
    }

    // Fetch caller's profile to verify they are the admin (ylogx)
    const { data: profile, error: profileError } = await authSupabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Unauthorized: Profile not found" }, { status: 401 });
    }

    const isAdmin = profile.company_name === "ylogx" || profile.email === "admin@example.com";
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden: Admin access only" }, { status: 403 });
    }

    // 2. Parse request payload
    const { targetUserId, approved, updatedLicenses, notificationId, requesterCompanyName } = await req.json();
    if (!targetUserId) {
      return NextResponse.json({ error: "Missing targetUserId" }, { status: 400 });
    }

    // 3. Update target user using service role client (bypasses RLS)
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const { error: userUpdateErr } = await adminSupabase
      .from("users")
      .update({
        verified: approved,
        licenses: updatedLicenses,
      })
      .eq("id", targetUserId);

    if (userUpdateErr) throw userUpdateErr;

    // Send notification to requesting company
    const messageText = approved
      ? "Your company verification request has been approved! A verification badge is now displayed on your profile."
      : "Your company verification request has been rejected. Please review your documents and upload a valid registration or licensing certificate to submit again.";

    const { error: notifErr } = await adminSupabase.from("notifications").insert({
      id: crypto.randomUUID(),
      user_id: targetUserId,
      type: approved ? "proposal_accepted" : "proposal_rejected",
      title: approved ? "Verification Approved" : "Verification Rejected",
      message: messageText,
      read: false,
      timestamp: new Date().toISOString(),
    });
    if (notifErr) console.warn("Failed to notify vendor of verification:", notifErr);

    // Update admin's verification notification to show processed status
    if (notificationId) {
      const updatedMessage = `${approved ? "Approved" : "Rejected"} verification request for Company "${requesterCompanyName || "Unknown"}".`;
      const { error: adminNotifErr } = await adminSupabase
        .from("notifications")
        .update({
          type: approved ? "proposal_accepted" : "proposal_rejected", // change type so it's no longer pending_verification
          message: updatedMessage,
          read: true,
        })
        .eq("id", notificationId);
      if (adminNotifErr) console.warn("Failed to update admin notification:", adminNotifErr);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("verify-vendor error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
