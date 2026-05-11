# FastAPI Backend

This backend is the new API boundary for the React frontend.

Current state:
- Exposes `/api/*` and proxies requests to the existing Next.js server during migration.
- Keeps the frontend working while the API layer is being ported route-by-route.

Run locally:

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Set `FRONTEND_BASE_URL` if the Next.js app is not running at `http://127.0.0.1:3000`.
