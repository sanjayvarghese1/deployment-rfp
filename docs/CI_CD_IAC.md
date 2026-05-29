# Current GitLab pipeline (concise)

This document describes the active pipeline as defined in `.gitlab-ci.yml` (stages, jobs, and important notes). It deliberately focuses only on the pipeline that runs today.

Stages (in order):
- `validate`
- `iac`
- `unit`
- `build`
- `integration`
- `render`
- `mirror`

Active jobs and short descriptions:
- `frontend:validate` (stage: `validate`) — installs frontend deps and runs ESLint; artifacts: `lint_output.json`/`lint_output.txt`.
- `backend:validate` (stage: `validate`) — installs backend deps and runs `python -m compileall`.
- `ci:precheck` (stage: `validate`) — checks required protected env vars when running on `main` and fails fast if any required secret is missing.
- `terraform:fmt` / `terraform:validate` (stage: `validate`) — Terraform formatting and validation (run for MRs and `main`), using the `.terraform_base` image setup.
- `backend:unit` (stage: `unit`) — runs `pytest` for backend unit tests.
- `frontend:build` (stage: `build`) — builds the Next.js frontend (creates `.env.local` from configured vars then runs `npm run build`).
- `terraform:plan` / `terraform:apply` (stage: `iac`) — manual Terraform plan/apply steps that operate against a remote HTTP state; these are manual `when: manual` jobs restricted to `main`.
- `backend:integration` (stage: `integration`) — starts local backend and runs integration smoke script against it.
- `frontend:routing` (stage: `integration`) — builds and starts the frontend, then runs routing and route+API smoke checks.
- `frontend:smoke-quick` (stage: `integration`) — lightweight request-only smoke that runs `analysis-smoke.mjs` and `rfp-generate-smoke.mjs` against a deployed `DEPLOYED_FRONTEND_URL`; auto-runs on `main` only so protected variables are available.
- `frontend:render` (stage: `render`) — builds and starts frontend then runs rendering, analysis, rfp-generate and pdf-render smoke scripts; may surface PDF provider errors (e.g., PDFShift 403).
- `mirror:github` (stage: `mirror`) — pushes `HEAD:main` to the GitHub remote using `GITHUB_MIRROR_TOKEN` and `GITHUB_MIRROR_REPOSITORY`. Runs on `main`.

Important variables and notes:
- The pipeline expects several protected variables to be configured in GitLab CI/CD when running full checks on `main`. Notable names: `GITHUB_MIRROR_REPOSITORY`, `GITHUB_MIRROR_TOKEN`, `OPENROUTER_API_KEY`, `LANGFUSE_SECRET_KEY`, `PDFSHIFT_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `vercel_api_token`, `DEPLOYED_BACKEND_URL`, `DEPLOYED_FRONTEND_URL`.
- The Terraform jobs rely on `.terraform_base` which downloads Terraform v1.11.3 and maps CI variables to `TF_VAR_*` environment variables before running `terraform`.
- The `mirror:github` job performs a normal `git push` to GitHub; if GitHub has diverged, the push will fail with a non-fast-forward error and needs manual resolution.

How to test mirroring safely:
1. Make a small documentation commit and push only to GitLab:

```bash
git add docs/CI_CD_IAC.md
git commit -m "docs(ci): sync docs for current pipeline"
git push gitlab main
```

2. Wait for the GitLab pipeline to run `mirror:github` (it runs on `main`) and then fetch `origin/main` locally to confirm the commit arrived.

Notes on scope:
- This document intentionally documents *only* the pipeline present in `.gitlab-ci.yml`. For Terraform operational guidance, see `terraform/README.md`.

If you want this file further shortened to a single-stage job list or converted into a markdown checklist of required GitLab variables, tell me which format you prefer and I'll update it.
