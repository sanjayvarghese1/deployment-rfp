# Terraform IaC

This directory contains the Terraform stack for the Vercel frontend.

What it manages:

- Vercel project connected to the GitHub repository
- Production environment variables used by the Next.js app
- Optional custom Vercel domain

What is already managed separately:

- The Render backend service is already defined in `render.yaml`

GitLab CI usage:

GitLab CI no longer runs Terraform jobs automatically. Terraform is left here for manual use when you intentionally want to manage the Vercel project configuration yourself.

When Terraform runs in GitLab CI, it uses GitLab-managed HTTP state with these runtime variables:

- `TF_STATE_NAME` (defaults to `deployment-rfp`)
- `TF_HTTP_ADDRESS`
- `TF_HTTP_LOCK_ADDRESS`
- `TF_HTTP_UNLOCK_ADDRESS`
- `TF_HTTP_USERNAME`
- `TF_HTTP_PASSWORD`

Run locally if needed:

```bash
cd terraform
terraform init
terraform fmt -recursive
terraform validate
terraform plan
```

If the Vercel project already exists, import it into Terraform state once before applying:

```bash
cd terraform
terraform import vercel_project.frontend prj_KAMfDTWuibMhTjj9Jo2i2F6Muehu
```

Required GitLab CI/CD variables:

- `vercel_api_token`
- `vercel_git_repository` in `owner/repo` form
- `DEPLOYED_BACKEND_URL`
- `DEPLOYED_FRONTEND_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`
- `supabase_service_role_key`
- `openrouter_api_key`
- `openrouter_base_url`
- `openrouter_primary_model`
- `openrouter_intake_model`
- `openrouter_fallback_model`
- `openrouter_analysis_model`
- `langfuse_secret_key`
- `langfuse_public_key`
- `langfuse_base_url`
- `pdfshift_api_key`
- `pdfshift_sandbox`
- `analysis_scoring_strictness`
- `analysis_full_score_confidence`
- `llm_guard_enable`
- `email_user`
- `email_pass`

Optional variables:

- `vercel_team_id`
- `vercel_custom_domain`
- `extractor_webhook_secret`
