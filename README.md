# Procurement Link

Procurement Link is a procurement and RFP platform with a Next.js frontend, a FastAPI backend boundary, and Supabase-powered data and authentication.

## Website

- Local development website: [http://localhost:3000](http://localhost:3000)
- If you deploy the app to a public host, replace this link with the production URL in this README and in `NEXT_PUBLIC_APP_URL`.

## Repository Layout

- [frontend/](frontend/) - Next.js application, UI components, API routes, and Supabase integration
- [backend/](backend/) - FastAPI service that proxies requests during the migration
- [render.yaml](render.yaml) - Render configuration for the backend service

## What The App Does

- Company signup and authentication through Supabase
- Procurement feed, company profiles, contracts, messages, and notifications
- AI-assisted RFP generation and proposal analysis
- Vendor proposal upload and review workflows
- Background analysis jobs and progress tracking

## How To Run Locally

### Frontend

1. Open a terminal in `frontend/`.
2. Install dependencies with `npm install`.
3. Copy your environment values into `.env.local`.
4. Start the app with `npm run dev`.
5. Open [http://localhost:3000](http://localhost:3000).

### Backend

1. Open a terminal in `backend/`.
2. Create and activate a Python environment.
3. Install dependencies with `pip install -r requirements.txt`.
4. Start the API with `uvicorn app.main:app --reload --port 8000`.

### Required Environment Values

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=proposals`
- `OPENROUTER_API_KEY`
- `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000`
- `NEXT_PUBLIC_APP_URL=http://localhost:3000`

## Typical Workflow

1. Start the backend on port `8000`.
2. Start the frontend on port `3000`.
3. Sign in or create an account.
4. Create or view contracts and RFPs.
5. Upload vendor proposals and review analysis results.

## Deployment Notes

- The backend is configured for Render in [render.yaml](render.yaml).
- The frontend is ready for a Vercel-style deployment or any host that supports Next.js.
- After deployment, update the website link above and set production values for `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_BACKEND_URL`.

## Infrastructure as Code

Terraform is now scaffolded in [terraform/](terraform/) and can be executed from GitLab CI.

- Vercel project configuration and production environment variables are managed in Terraform.
- The Render backend is already defined declaratively in [render.yaml](render.yaml).
- GitLab CI runs `terraform fmt`, `terraform validate`, `terraform plan`, and a manual `terraform apply` using GitLab remote state.

Recommended GitLab variables for Terraform are documented in [terraform/README.md](terraform/README.md).

## GitLab CI/CD

The repository now includes a GitLab pipeline in [`.gitlab-ci.yml`](.gitlab-ci.yml) with these checks:

- validation: frontend linting and backend compile checks
- unit: backend pytest coverage for the health endpoints and job store
- build: frontend production build
- integration: local backend and frontend smoke tests
- render: frontend PDF generation smoke test against the hosted PDF route
- deploy: triggers the Vercel production deploy hook from GitLab on `main`
- deploy verification: optional checks against the live Vercel and Render URLs

Set these variables in GitLab CI/CD settings when you want GitLab to drive Vercel/CD or live deployment verification:

- `VERCEL_DEPLOY_HOOK_URL` for the Vercel production deploy hook
- `DEPLOYED_FRONTEND_URL` for the Vercel site
- `DEPLOYED_BACKEND_URL` for the Render backend

GitLab and GitHub do not sync automatically just because both remotes exist in the local clone. If you want both hosting platforms to receive the same commits, push to both remotes or configure repository mirroring. The GitLab deploy job only runs when the commit reaches GitLab.

The deploy verification job checks the backend health endpoint, the frontend redirect, and the PDF generation route end to end.

## Troubleshooting

- If the frontend cannot reach the backend, confirm `NEXT_PUBLIC_BACKEND_URL` is set correctly.
- If uploads or analysis fail, verify the Supabase storage bucket and service role key.
- If AI features fail, check the `OPENROUTER_API_KEY` value.
