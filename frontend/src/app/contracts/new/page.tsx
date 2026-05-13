"use client";

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { generateRFP } from "@/services/aiService";
import { supabase } from "@/services/supabase";

export default function NewContractPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    project_title: "",
    description: "",
    budget: "",
    deadline: "",
    industry: "",
    required_certifications: "",
    mission_objective: "",
  });
  const [rfpDocument, setRfpDocument] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleGenerateRFP = async () => {
    setGenerating(true);
    try {
      const rfp = await generateRFP(form);
      setRfpDocument(rfp);
    } catch {
      alert("Failed to generate RFP. Make sure your API key is configured.");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!user) return;
    setPublishing(true);
    try {
      const { error } = await supabase.from("contracts").insert({
        id: uuidv4(),
        title: form.project_title,
        description: form.description,
        budget: form.budget,
        deadline: form.deadline,
        industry: form.industry,
        required_certifications: form.required_certifications,
        mission_objective: form.mission_objective,
        rfp_document: rfpDocument,
        posted_by: user.id,
        posted_by_name: profile?.company_name || "Unknown",
        created_at: new Date().toISOString(),
        status: "open",
      });

      if (error) {
        throw error;
      }

      router.push("/contracts");
    } catch {
      alert("Failed to publish contract.");
    } finally {
      setPublishing(false);
    }
  };

  useEffect(() => {
    if (!user && !profile) router.push("/login");
  }, [user, profile, router]);

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center"><div className="w-8 h-8 border-3 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-[var(--foreground)] mb-6">Post New Contract</h1>
      <div className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Project Title *</label>
          <input name="project_title" value={form.project_title} onChange={handleChange} required className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Description *</label>
          <textarea name="description" value={form.description} onChange={handleChange} rows={3} className="input-field" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Budget ($)</label>
            <input name="budget" value={form.budget} onChange={handleChange} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Deadline</label>
            <input name="deadline" type="date" value={form.deadline} onChange={handleChange} className="input-field" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Industry</label>
          <input name="industry" value={form.industry} onChange={handleChange} className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Required Certifications</label>
          <input name="required_certifications" value={form.required_certifications} onChange={handleChange} className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Mission Objective *</label>
          <textarea name="mission_objective" value={form.mission_objective} onChange={handleChange} rows={3} placeholder="Describe what you need accomplished..." className="input-field" />
        </div>

        <div className="pt-4 border-t border-[var(--divider)]">
          <button
            onClick={handleGenerateRFP}
            disabled={generating || !form.mission_objective}
            className="bg-[#000000] text-[#EFECE3] px-6 py-2.5 rounded-full text-sm font-medium hover:bg-[#D4D1C8] disabled:opacity-50 transition-all duration-200 shadow-sm"
          >
            {generating ? "Generating RFP..." : "Generate RFP with AI"}
          </button>
        </div>

        {rfpDocument && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">Generated RFP Document</label>
            <textarea
              value={rfpDocument}
              onChange={(e) => setRfpDocument(e.target.value)}
              rows={20}
              className="input-field font-mono"
            />
          </div>
        )}

        <div className="flex justify-end pt-4">
          <button
            onClick={handlePublish}
            disabled={publishing || !form.project_title}
            className="btn-primary px-8 py-2.5 text-sm font-medium"
          >
            {publishing ? "Publishing..." : "Publish Contract"}
          </button>
        </div>
      </div>
    </div>
  );
}

