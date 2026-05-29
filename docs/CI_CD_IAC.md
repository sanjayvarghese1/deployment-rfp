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
