import { createClient } from "@supabase/supabase-js";

// Supabase client for browser/client-side
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for RFP-related tables
export interface Contract {
  id?: string;
  title: string;
  description: string;
  budget: string;
  deadline: string;
  industry: string;
  status: string;
  posted_by: string;
  posted_by_name: string;
  poster_verified: boolean;
  rfp_metadata: Record<string, unknown>;
  rfp_qa: Record<string, unknown> | any;
  rfp_sections: Record<string, string>;
  rfp_section_labels: Record<string, string>;
  rfp_pdf_base64: string;
  rfp_decomposition?: Record<string, any>;
  rfp_template?: string;
  uploaded_pdf_name: string;
  uploaded_pdf_analysis: Record<string, unknown>;
  created_at?: string;
}

export interface Notification {
  id?: string;
  user_id: string;
  type: string;
  title?: string;
  message: string;
  read: boolean;
  timestamp?: string;
}

export interface UserProfile {
  id: string;
  company_name: string;
  email: string;
  industry?: string;
  location?: string;
  website?: string;
  description?: string;
  rating?: number;
  followers?: string[];
  created_at?: string;
  profile_image?: string;
  verified?: boolean;
  licenses?: { name: string; url: string; uploaded_at: string }[];
  founded_year?: string;
  company_size?: string;
  specialties?: string[];
  phone?: string;
  registration_number?: string;
  mandatory_rfp_sections?: string[];
}

// Contract operations
export async function createContract(contract: Contract) {
  const { data, error } = await supabase.from("contracts").insert([contract]).select();
  if (error) throw error;
  return data?.[0];
}

export async function getContract(id: string) {
  const { data, error } = await supabase.from("contracts").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

// Notification operations
export async function createNotification(notification: Notification) {
  const { data, error } = await supabase.from("notifications").insert([notification]).select();
  if (error) throw error;
  return data?.[0];
}

export async function getNotifications(userId: string) {
  const { data, error } = await supabase.from("notifications").select("*").eq("user_id", userId).order("timestamp", { ascending: false });
  if (error) throw error;
  return data;
}

// User profile operations
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error && error.code !== "PGRST116") throw error; // PGRST116 = row not found
  return data || null;
}

export async function updateUserProfile(userId: string, profile: Partial<UserProfile>) {
  const { data, error } = await supabase.from("profiles").update(profile).eq("id", userId).select();
  if (error) throw error;
  return data?.[0];
}

// Storage operations
export async function uploadFile(bucket: string, path: string, file: File) {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  return data;
}

export async function getPublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFile(bucket: string, path: string) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}


