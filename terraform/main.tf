locals {
  environment_variables = {
    NEXT_PUBLIC_APP_URL                 = { value = var.vercel_frontend_url, sensitive = true }
    NEXT_PUBLIC_BACKEND_URL             = { value = var.vercel_backend_url, sensitive = true }
    NEXT_PUBLIC_SUPABASE_URL            = { value = var.next_public_supabase_url, sensitive = true }
    NEXT_PUBLIC_SUPABASE_ANON_KEY       = { value = var.next_public_supabase_anon_key, sensitive = true }
    SUPABASE_SERVICE_ROLE_KEY           = { value = var.supabase_service_role_key, sensitive = true }
    NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET = { value = var.next_public_supabase_storage_bucket, sensitive = true }
    OPENROUTER_API_KEY                  = { value = var.openrouter_api_key, sensitive = true }
    OPENROUTER_BASE_URL                 = { value = var.openrouter_base_url, sensitive = true }
    OPENROUTER_PRIMARY_MODEL            = { value = var.openrouter_primary_model, sensitive = true }
    OPENROUTER_INTAKE_MODEL             = { value = var.openrouter_intake_model, sensitive = true }
    OPENROUTER_FALLBACK_MODEL           = { value = var.openrouter_fallback_model, sensitive = true }
    OPENROUTER_ANALYSIS_MODEL           = { value = var.openrouter_analysis_model, sensitive = true }
    LANGFUSE_SECRET_KEY                 = { value = var.langfuse_secret_key, sensitive = true }
    LANGFUSE_PUBLIC_KEY                 = { value = var.langfuse_public_key, sensitive = true }
    LANGFUSE_BASE_URL                   = { value = var.langfuse_base_url, sensitive = true }
    PDFSHIFT_API_KEY                    = { value = var.pdfshift_api_key, sensitive = true }
    PDFSHIFT_SANDBOX                    = { value = var.pdfshift_sandbox, sensitive = true }
    EMAIL_SERVICE                       = { value = var.email_service, sensitive = true }
    EMAIL_USER                          = { value = var.email_user, sensitive = true }
    EMAIL_PASS                          = { value = var.email_pass, sensitive = true }
    EXTRACTOR_WEBHOOK_SECRET            = { value = var.extractor_webhook_secret, sensitive = true }
    ANALYSIS_SCORING_STRICTNESS         = { value = var.analysis_scoring_strictness, sensitive = true }
    ANALYSIS_FULL_SCORE_CONFIDENCE      = { value = var.analysis_full_score_confidence, sensitive = true }
    LLM_GUARD_ENABLE                    = { value = var.llm_guard_enable, sensitive = true }
    OLLAMA_BASE_URL                     = { value = var.ollama_base_url, sensitive = true }
  }
}

resource "vercel_project" "frontend" {
  name             = var.vercel_project_name
  framework        = "nextjs"
  root_directory   = "frontend"
  install_command  = "npm ci"
  build_command    = "npm run build"
  output_directory = ".next"

  git_repository = {
    type              = "github"
    repo              = var.vercel_git_repository
    production_branch = "main"
  }
}

import {
  to = vercel_project.frontend
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu"
}

import {
  to = vercel_project_environment_variable.frontend["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/8BuITgTMDHgQfO9A"
}

import {
  to = vercel_project_environment_variable.frontend["NEXT_PUBLIC_BACKEND_URL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/K8hxE6XaqlnJCwUK"
}

import {
  to = vercel_project_environment_variable.frontend["NEXT_PUBLIC_APP_URL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/zi4HN8TumiWVdgxF"
}

import {
  to = vercel_project_environment_variable.frontend["PDFSHIFT_API_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/XBpAklbTV9cZ3vAU"
}

import {
  to = vercel_project_environment_variable.frontend["NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/HEvDnTrCISiiB4pa"
}

import {
  to = vercel_project_environment_variable.frontend["NEXT_PUBLIC_SUPABASE_URL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/VoWzlYx7LSsJlfKk"
}

import {
  to = vercel_project_environment_variable.frontend["LANGFUSE_PUBLIC_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/F1GKsZgF2fUKNrV3"
}

import {
  to = vercel_project_environment_variable.frontend["LANGFUSE_SECRET_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/lUZGQMNvGsBW72SP"
}

import {
  to = vercel_project_environment_variable.frontend["OPENROUTER_PRIMARY_MODEL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/i2DWHcxBFtmxRRPp"
}

import {
  to = vercel_project_environment_variable.frontend["OPENROUTER_FALLBACK_MODEL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/NQfLVwamnK3QAX6b"
}

import {
  to = vercel_project_environment_variable.frontend["OPENROUTER_INTAKE_MODEL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/o2OJ1BBKqtw1k2Rm"
}

import {
  to = vercel_project_environment_variable.frontend["LANGFUSE_BASE_URL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/CYl3nofESnLAfhvk"
}

import {
  to = vercel_project_environment_variable.frontend["OPENROUTER_BASE_URL"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/96gZXSP2bQSLYKGV"
}

import {
  to = vercel_project_environment_variable.frontend["SUPABASE_SERVICE_ROLE_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/CoBE0v8UQqPWBC5a"
}

import {
  to = vercel_project_environment_variable.frontend["OPENROUTER_API_KEY"]
  id = "prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu/KuKOXxVTVWBsDeZh"
}

resource "vercel_project_environment_variable" "frontend" {
  for_each = local.environment_variables

  project_id = vercel_project.frontend.id
  key        = each.key
  value      = each.value.value
  target     = ["production"]
  sensitive  = each.value.sensitive
}

resource "vercel_project_domain" "frontend" {
  count      = var.vercel_custom_domain == null || var.vercel_custom_domain == "" ? 0 : 1
  project_id = vercel_project.frontend.id
  domain     = var.vercel_custom_domain
}