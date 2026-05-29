# CI/CD and IaC Handoff

This document explains how the GitLab pipeline, GitHub mirroring, Vercel auto-build flow, and the optional Terraform stack fit together in this repository.

## Goal

The setup has two jobs:

1. Keep the application validated on merge requests.
2. Keep deployment triggered from GitHub after GitLab mirrors `main`.

The repo now uses GitLab for CI and GitHub/Vercel for CD.

## Pipeline Structure

The GitLab pipeline in [`.gitlab-ci.yml`](../.gitlab-ci.yml) is split into these stages:

- `validate` - frontend lint and backend compile checks
- `unit` - backend pytest suite
- `build` - frontend production build
- `integration` - local backend and frontend smoke tests
- `routing` - extra frontend route smoke checks
- `render` - frontend PDF smoke test
- `mirror` - pushes `main` from GitLab to GitHub

## Why Terraform Is Not in CI

Terraform still exists for manual use, but GitLab CI no longer runs it.

That means:

- the CI pipeline stays focused on validation and testing
- deployment is owned by the GitHub mirror and Vercel auto-builds
- Terraform is available if you need to manage Vercel settings manually

## Terraform Responsibilities

Terraform lives in [`terraform/`](../terraform/) and manages the Vercel frontend side of the stack.

It defines:

- the Vercel project
- the production branch (`main`)
- production environment variables for the app
- optional custom domain support

The Terraform README lists the required CI variables in [`terraform/README.md`](../terraform/README.md).

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

- the mirror job is for code sync, not for deploying Vercel directly

Vercel should auto-build from GitHub after the mirror completes.

## Full Runtime Flow

Typical path for a change on `main`:

1. Code is pushed to GitLab.
2. `mirror:github` pushes the same commit to GitHub.
3. Vercel sees the GitHub commit and auto-builds.
4. The live URL updates automatically if the build succeeds.

## Validation Flow on Merge Requests

On merge requests, the pipeline still performs safety checks:

- frontend linting
- backend compile checks
- backend unit tests
- frontend build
- integration smoke tests
- route smoke tests
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

Terraform variables are only needed if you decide to manage Vercel manually with Terraform outside CI.

## Practical Rule Of Thumb

- If you want GitHub to remain the deploy trigger, keep `mirror:github` enabled.
- If you want GitHub/Vercel to own CD, do not add deploy-hook jobs back into GitLab CI.

## Detailed Pipeline Documentation (current)

This project uses a GitLab-first CI with an optional push mirror to GitHub so Vercel can continue to deploy from GitHub. The following explains current jobs, important variables, and expected behavior so operators can reliably test mirroring.

- **Primary pipeline file**: [`.gitlab-ci.yml`](../.gitlab-ci.yml)
- **Runs on**: `main` (full pipeline), and merge requests (validation subset).

- **Key jobs and intent**:
	- `validate`: linting and static checks for frontend/backend.
	- `unit`: runs backend `pytest` to validate business logic.
	- `build`: performs a production frontend build (used for integration test assets).
	- `integration`: lightweight integration and smoke tests that exercise backend APIs.
	- `routing` / `route-smoke`: verify important frontend routes render correctly under Next.js server.
	- `render` / `pdf-render-smoke`: exercise the PDF generation API; note this job may fail if third-party PDF services (PDFShift) return 403 — treat as an expected external failure unless you add a fallback PDF provider.
	- `mirror:github`: push `main` to the GitHub remote. This job is the mechanism that keeps GitHub in sync and triggers Vercel builds. It requires the mirror token and repository variables listed below.

- **Essential CI variables** (GitLab CI/CD → Variables):
	- `GITHUB_MIRROR_REPOSITORY` — set to `owner/repo` for the GitHub target.
	- `GITHUB_MIRROR_TOKEN` — a personal access token with `repo` scope that can push to the target.
	- `OPENROUTER_API_KEY`, `LANGFUSE_KEY`, `PDFSHIFT_KEY`, `SUPABASE_SERVICE_ROLE` — these are protected values used by smoke tests; the `frontend:smoke-quick` job is configured to run automatically on `main` where protected variables are available.

- **Mirroring behavior and timing**:
	- The `mirror:github` job pushes the GitLab `main` ref to GitHub. If GitHub has diverged, the push will fail (fast-forward requirement). You should resolve remote divergence locally or enable force pushes carefully.
	- Mirroring is a push of commits/refs (the git objects). It does not selectively push files — the exact commit(s) created in GitLab are replicated on GitHub.
	- If you want to *test* mirroring, push a commit to GitLab only and verify GitHub receives it. Depending on your GitLab mirroring configuration, there may be a short delay while the mirror job runs.

- **Troubleshooting**:
	- If mirroring fails with `non-fast-forward`, fetch `origin/main` locally, rebase or merge as appropriate, then push from GitLab or push directly to GitHub if desired.
	- If the mirror job does not run, confirm `mirror:github` is present in `.gitlab-ci.yml` and that it is not protected by manual-only rules.
	- Check GitLab Project → Settings → Repository → Mirroring repositories for native mirror errors and timestamps.

If you want, I will now commit this documentation update and push it to GitLab only so you can observe whether GitHub receives it via your configured mirror.
