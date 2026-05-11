# ProcureNet Monorepo

This repository is now split into separate frontend and backend folders.

## Layout

- [frontend/](frontend/) - Next.js React UI and client-side Supabase integration
- [backend/](backend/) - FastAPI backend boundary used by the UI

## Current migration state

- The frontend now calls the FastAPI backend through `NEXT_PUBLIC_BACKEND_URL`.
- The FastAPI backend proxies `/api/*` requests to the Next.js app during the migration, so the existing UI flows keep working.

## Run locally

1. Start the frontend from `frontend/`.
2. Start the backend from `backend/` on port `8000`.
3. Set `NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000` in the frontend environment.
