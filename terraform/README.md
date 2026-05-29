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

Run locally if needed:

```bash
cd terraform
terraform init
terraform fmt -recursive
terraform validate
terraform plan
```

Required GitLab CI/CD variables:

- `TF_VAR_vercel_api_token`
- `TF_VAR_vercel_git_repository` in `owner/repo` form
- `TF_VAR_vercel_backend_url`
- `TF_VAR_next_public_supabase_url`
- `TF_VAR_next_public_supabase_anon_key`
- `TF_VAR_supabase_service_role_key`
- `TF_VAR_openrouter_api_key`
- `TF_VAR_langfuse_secret_key`
- `TF_VAR_langfuse_public_key`
- `TF_VAR_email_user`
- `TF_VAR_email_pass`

Optional variables:

- `TF_VAR_vercel_team_id`
- `TF_VAR_vercel_custom_domain`
- `TF_VAR_pdfshift_api_key`
- `TF_VAR_extractor_webhook_secret`
