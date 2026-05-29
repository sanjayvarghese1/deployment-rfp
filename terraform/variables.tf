variable "vercel_api_token" {
  description = "Vercel API token used by Terraform and GitLab CI."
  type        = string
  sensitive   = true
}

variable "vercel_team_id" {
  description = "Optional Vercel team slug or ID."
  type        = string
  default     = null
}

variable "vercel_project_name" {
  description = "Vercel project name."
  type        = string
  default     = "deployment-rfp"
}

variable "vercel_git_repository" {
  description = "GitLab repository in owner/repo form."
  type        = string
}

variable "vercel_custom_domain" {
  description = "Optional custom production domain."
  type        = string
  default     = null
}

variable "vercel_frontend_url" {
  description = "Production frontend URL used by the app."
  type        = string
  default     = "https://deployment-rfp.vercel.app"
}

variable "vercel_backend_url" {
  description = "Production backend URL used by the app."
  type        = string
}

variable "next_public_supabase_url" {
  type        = string
  description = "Supabase project URL."
}

variable "next_public_supabase_anon_key" {
  type        = string
  description = "Supabase anon key."
  sensitive   = true
}

variable "supabase_service_role_key" {
  type        = string
  description = "Supabase service role key."
  sensitive   = true
}

variable "next_public_supabase_storage_bucket" {
  type        = string
  description = "Supabase storage bucket name."
  default     = "proposals"
}

variable "openrouter_api_key" {
  type        = string
  description = "OpenRouter API key."
  sensitive   = true
}

variable "openrouter_base_url" {
  type        = string
  description = "OpenRouter base URL."
  default     = "https://openrouter.ai/api/v1"
}

variable "openrouter_primary_model" {
  type        = string
  default     = "minimax/minimax-m2.7"
}

variable "openrouter_intake_model" {
  type        = string
  default     = "minimax/minimax-m2.7"
}

variable "openrouter_fallback_model" {
  type        = string
  default     = "minimax/minimax-m2.5"
}

variable "openrouter_analysis_model" {
  type        = string
  default     = "minimax/minimax-m2.7"
}

variable "langfuse_secret_key" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "langfuse_public_key" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "langfuse_base_url" {
  type        = string
  default     = "https://cloud.langfuse.com"
}

variable "pdfshift_api_key" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "pdfshift_sandbox" {
  type        = string
  default     = "false"
}

variable "email_service" {
  type        = string
  default     = "gmail"
}

variable "email_user" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "email_pass" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "extractor_webhook_secret" {
  type        = string
  default     = ""
  sensitive   = true
}

variable "analysis_scoring_strictness" {
  type        = string
  default     = "balanced"
}

variable "analysis_full_score_confidence" {
  type        = string
  default     = "0.9"
}

variable "llm_guard_enable" {
  type        = string
  default     = "true"
}

variable "ollama_base_url" {
  type        = string
  default     = "http://localhost:11434"
}