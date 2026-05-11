Supabase Storage Webhook / Extractor Setup

Overview
- This project includes a webhook endpoint at `/api/hooks/supabase-storage` which accepts POST requests when a PDF is uploaded.
- The endpoint fetches the uploaded PDF, extracts text, sanitizes it, and updates the matching `proposals.proposal_data` row in Supabase.

Security
- Set an environment variable `EXTRACTOR_WEBHOOK_SECRET` in your deployment (Vercel/Netlify/Next) to a strong random value.
- When configuring Supabase to call the webhook, include the header `x-extractor-secret: <YOUR_SECRET>` on requests.

Registering a webhook (Dashboard)
1. Open your Supabase project -> Storage -> Buckets -> open the `proposals` bucket.
2. Look for "Event/Notifications" or "Hooks" (depends on Supabase UI version). Add a new webhook URL:
   - URL: `https://your-app.example.com/api/hooks/supabase-storage`
   - Method: `POST`
   - Headers: `x-extractor-secret: <YOUR_SECRET>`
   - Events: choose `object_created` or equivalent for new objects.

If the Dashboard doesn't expose bucket webhooks, use a small polling Function or Edge Function that subscribes to storage changes and forwards events to this endpoint.

Testing locally
- Start your Next dev server: `npm run dev`
- From the project root run (PowerShell):

  curl -X POST http://localhost:3000/api/hooks/supabase-storage \
    -H "Content-Type: application/json" \
    -H "x-extractor-secret: <YOUR_SECRET>" \
    -d '{"url":"<PUBLIC_FILE_URL>"}'

- Response will either update proposals or return a preview.

Notes
- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (service role) are available to the server process so the endpoint can update rows.
- The endpoint currently matches proposals by `proposal_file` equality or `proposal_file` ILIKE `%name%` to find a row.
- For production, secure the endpoint behind a secret and consider validating Supabase event payloads if available.
