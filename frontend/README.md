# ProcureNet — Procurement Network Platform

A LinkedIn-style procurement network where organizations post contracts, generate RFPs using AI, and vendors submit proposals analyzed by AI.

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React, Tailwind CSS
- **Backend & Database:** Supabase (Auth, Postgres, Storage)
- **AI:** OpenRouter API (MiniMax m2.7 with m2.5 fallback)
- **Deployment:** Vercel-compatible

## Features

- Company signup & authentication (Supabase Auth)
- LinkedIn-style social feed (posts, likes, comments)
- Company directory with search & industry filter
- Company profiles with followers, reviews, posts, contracts
- Contract posting with AI-powered RFP generation
- Vendor proposal submission with file upload
- AI proposal analysis with scoring & risk assessment
- AI Insights dashboard with vendor ranking
- Real-time messaging between companies
- Notifications system
- Company reviews & ratings
- Profile management with image upload

## Project Structure

```
src/
├── app/
│   ├── api/ai/
│   │   ├── generate-rfp/route.ts    # AI RFP generation endpoint
│   │   └── analyze-proposal/route.ts # AI proposal analysis endpoint
│   ├── companies/
│   │   ├── page.tsx                  # Company directory
│   │   └── [id]/page.tsx            # Company profile
│   ├── contracts/
│   │   ├── page.tsx                  # Contracts listing
│   │   ├── new/page.tsx             # Create contract + RFP
│   │   └── [id]/page.tsx            # Contract detail + proposals
│   ├── insights/page.tsx            # AI Insights dashboard
│   ├── login/page.tsx               # Login page
│   ├── signup/page.tsx              # Signup page
│   ├── messages/page.tsx            # Messaging system
│   ├── notifications/page.tsx       # Notifications
│   ├── profile/page.tsx             # User profile & settings
│   ├── layout.tsx                   # Root layout
│   └── page.tsx                     # Home feed
├── components/
│   ├── Navbar.tsx
│   ├── PostCard.tsx
│   ├── ContractCard.tsx
│   ├── MessageBox.tsx
│   └── ProfileHeader.tsx
├── contexts/
│   └── AuthContext.tsx              # Supabase Auth context
└── services/
    ├── supabase.ts                  # Supabase client
    └── aiService.ts                 # AI API client
```

## Database Schema

The schema is defined in [supabase/schema.sql](supabase/schema.sql). It creates the core tables used by the app:

- `users`
- `posts`
- `contracts`
- `proposals`
- `messages`
- `notifications`
- `reviews`
- `analysis_reports`
- `analysis_jobs`

## Setup & Run Locally

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

**Supabase Setup:**
1. Create a project in [Supabase](https://supabase.com)
2. Open the SQL editor and run [supabase/schema.sql](supabase/schema.sql)
3. Create or verify the `proposals` storage bucket and keep it public
4. Apply the `analysis_jobs` migration in [supabase/migrations/20260508_add_analysis_jobs.sql](supabase/migrations/20260508_add_analysis_jobs.sql) so background analysis progress persists
5. Copy the project URL and anon key into `.env.local`
6. Add the service role key for the upload route and server-side writes

**Required environment variables:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET=proposals`

**OpenRouter Setup:**
1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Add it to `.env.local` as `OPENROUTER_API_KEY`
3. Keep these defaults unless you need overrides:
    - `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`
    - `OPENROUTER_PRIMARY_MODEL=minimax/minimax-m2.7`
    - `OPENROUTER_FALLBACK_MODEL=minimax/minimax-m2.5`

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 4. Access from other laptops on your network

```bash
npm run dev -- -H 0.0.0.0
```

Other devices can access via `http://<your-local-ip>:3000`

## Deploy to Vercel

1. Push to GitHub
2. Import in [Vercel](https://vercel.com)
3. Add the Supabase, OpenRouter, Langfuse, and email environment variables in the Vercel dashboard
4. Deploy

## Modular Development

Each section is independent for parallel development:

| Developer | Section                  | Files                                    |
|-----------|--------------------------|------------------------------------------|
| Dev 1     | Auth & Profile           | `login/`, `signup/`, `profile/`, AuthContext |
| Dev 2     | Social Feed              | `page.tsx`, PostCard                     |
| Dev 3     | Contracts & RFP          | `contracts/`, ContractCard, AI routes    |
| Dev 4     | Proposals & AI Insights  | `contracts/[id]/`, `insights/`           |
| Dev 5     | Messaging & Notifications| `messages/`, `notifications/`, MessageBox|
| Dev 6     | Companies & Reviews      | `companies/`, ProfileHeader              |

