# CI/CD and IaC Handoff

This document explains how the GitLab pipeline, GitHub mirroring, Vercel deploy flow, and Terraform stack fit together in this repository.

## Goal

The setup has two jobs:

1. Keep the application validated on merge requests.
2. Keep production deployment state and Vercel configuration controlled from `main`.

The repo now supports both GitHub-driven deploys and GitLab-driven orchestration.

## Pipeline Structure

The GitLab pipeline in [`.gitlab-ci.yml`](../.gitlab-ci.yml) is split into these stages:

- `validate` - frontend lint and backend compile checks
- `unit` - backend pytest suite
- `build` - frontend production build
- `iac` - Terraform formatting, validation, planning, and manual apply
- `integration` - local backend and frontend smoke tests
- `render` - frontend PDF smoke test
- `mirror` - pushes `main` from GitLab to GitHub
- `deploy` - triggers a Vercel production deploy hook
- `deploy_verify` - optional checks against live URLs

## Why Terraform Is on `main`

Terraform manages production Vercel configuration and environment variables.

That means:

- `terraform:plan` and `terraform:apply` must only run on `main`
- the Vercel project definition should not drift between branches
- production env vars should come from one source of truth

At the same time, `terraform:fmt` and `terraform:validate` still run on merge requests, so the `iac` stage remains visible and useful before merge.

## Why `iac` Was Missing Before

GitLab only shows a stage when at least one job in that stage is present in the current pipeline.

If every Terraform job is restricted to `main`, merge-request pipelines have no jobs in `iac`, so the stage disappears.

The fix was:

- keep `terraform:plan` and `terraform:apply` `main`-only
- allow `terraform:fmt` and `terraform:validate` on merge requests

## Terraform Responsibilities

Terraform lives in [`terraform/`](../terraform/) and manages the Vercel frontend side of the stack.

It defines:

- the Vercel project
- the production branch (`main`)
- production environment variables for the app
- optional custom domain support

The Terraform README lists the required CI variables in [`terraform/README.md`](../terraform/README.md).

## GitLab Remote State

Terraform uses GitLab remote state, not local state.

In the pipeline, the jobs configure:

- `TF_STATE_NAME`
- `TF_HTTP_ADDRESS`
- `TF_HTTP_LOCK_ADDRESS`
- `TF_HTTP_UNLOCK_ADDRESS`
- `TF_HTTP_USERNAME`
- `TF_HTTP_PASSWORD`

That gives the pipeline a consistent shared state backend for `plan` and `apply`.

## Mirror Flow

GitLab and GitHub do not sync automatically.

To keep the existing GitHub-triggered deployment flow alive, the pipeline includes `mirror:github`.

What it does:

- runs on `main`
- pushes the GitLab `main` commit to the GitHub remote
- preserves the existing GitHub-based deploy path

Required variables:

- `GITHUB_MIRROR_REPOSITORY` in `owner/repo` form
- `GITHUB_MIRROR_TOKEN`, a GitHub token with write access to the repository

Important:

- use the mirror job or a direct Vercel deploy hook, not both, unless you want duplicate deploys
- the mirror job is for code sync, not for deploying Vercel directly

## Vercel Deploy Flow

The `vercel:deploy` job triggers a Vercel production deploy hook from GitLab.

This is useful when GitLab should actively drive CD instead of only mirroring code.

Required variable:

- `VERCEL_DEPLOY_HOOK_URL`

This job also only runs on `main`.

## Deployment Verification

The `deploy:verify` job is optional and only runs when live URLs are provided.

It checks:

- backend health
- frontend routing / redirect behavior
- PDF generation route behavior

Required variables:

- `DEPLOYED_FRONTEND_URL`
- `DEPLOYED_BACKEND_URL`

## Full Runtime Flow

Typical path for a change on `main`:

1. Code is pushed to GitLab.
2. `mirror:github` pushes the same commit to GitHub.
3. GitHub-triggered deploys still work because GitHub has the same commit.
4. `vercel:deploy` can also trigger production deployment from GitLab if enabled.
5. `deploy:verify` can confirm the live URLs after deployment.

## Validation Flow on Merge Requests

On merge requests, the pipeline still performs safety checks:

- frontend linting
- backend compile checks
- backend unit tests
- frontend build
- Terraform formatting and validation
- integration smoke tests
- render smoke test

This keeps the branch useful for review without modifying production state.

## Approach Taken

The changes were made in the smallest safe increments:

1. Inspect the existing pipeline and Terraform ownership.
2. Identify why `iac` disappeared on merge requests.
3. Restore MR-visible Terraform checks without opening up deploy jobs.
4. Add GitLab-side mirroring so GitHub deploy triggers stay intact.
5. Document the branch rules, required variables, and deployment flow.

## What To Configure In GitLab

Add these variables in GitLab CI/CD settings:

- `GITHUB_MIRROR_REPOSITORY`
- `GITHUB_MIRROR_TOKEN`
- `VERCEL_DEPLOY_HOOK_URL`
- `DEPLOYED_FRONTEND_URL`
- `DEPLOYED_BACKEND_URL`

Terraform also needs the `TF_VAR_*` inputs listed in [`terraform/README.md`](../terraform/README.md).

## Practical Rule Of Thumb

- If you want GitHub to remain the deploy trigger, keep `mirror:github` enabled.
- If you want GitLab to trigger Vercel directly, use `VERCEL_DEPLOY_HOOK_URL`.
- If you use direct GitLab deploys, avoid also using the Vercel hook in GitHub-based automation unless duplicate deploys are acceptable.
