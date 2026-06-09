-- Supabase schema for ProcureNet
-- Run this in the Supabase SQL editor after creating your project.

create extension if not exists pgcrypto;

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Company profiles tied to auth.users
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  company_name text not null,
  industry text,
  location text,
  website text,
  description text,
  rating numeric(3,1) not null default 0,
  followers uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  profile_image text,
  banner_image text,
  verified boolean not null default false,
  licenses jsonb not null default '[]'::jsonb,
  founded_year text,
  company_size text,
  specialties text[] not null default '{}'::text[],
  phone text,
  registration_number text
);

create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create index if not exists users_company_name_idx on public.users using btree (company_name);
create index if not exists users_industry_idx on public.users using btree (industry);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    company_name,
    industry,
    location,
    website,
    description,
    user_type,
    rating,
    followers,
    created_at,
    updated_at,
    profile_image,
    verified,
    licenses,
    founded_year,
    company_size,
    specialties,
    phone,
    registration_number
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'company_name', 'New Company'),
    new.raw_user_meta_data->>'industry',
    new.raw_user_meta_data->>'location',
    new.raw_user_meta_data->>'website',
    new.raw_user_meta_data->>'description',
    coalesce(new.raw_user_meta_data->>'user_type', 'vendor'),
    0,
    '{}'::uuid[],
    now(),
    now(),
    '',
    false,
    '[]'::jsonb,
    '',
    '',
    '{}'::text[],
    '',
    ''
  )
  on conflict (id) do update set
    email = excluded.email,
    company_name = excluded.company_name,
    industry = coalesce(excluded.industry, public.users.industry),
    location = coalesce(excluded.location, public.users.location),
    website = coalesce(excluded.website, public.users.website),
    description = coalesce(excluded.description, public.users.description),
    user_type = coalesce(excluded.user_type, public.users.user_type);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Posted contracts / RFPs
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  budget text,
  deadline text,
  industry text,
  required_certifications text,
  mission_objective text,
  rfp_document text,
  rfp_pdf_base64 text,
  rfp_file_name text,
  rfp_metadata jsonb,
  rfp_qa jsonb,
  rfp_template text,
  rfp_sections jsonb,
  rfp_section_labels jsonb,
  rfp_decomposition jsonb,
  posted_by uuid references public.users (id) on delete set null,
  posted_by_name text,
  poster_verified boolean not null default false,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_analysis_result jsonb
);

create trigger contracts_set_updated_at
before update on public.contracts
for each row execute function public.set_updated_at();

create index if not exists contracts_posted_by_idx on public.contracts using btree (posted_by);
create index if not exists contracts_status_idx on public.contracts using btree (status);
create index if not exists contracts_created_at_idx on public.contracts using btree (created_at desc);

-- Vendor proposals
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  vendor_id uuid not null references public.users (id) on delete cascade,
  vendor_name text not null,
  price text,
  timeline text,
  experience text,
  proposal_data text,
  extracted_text text,
  proposal_file text,
  proposal_file_name text,
  proposal_type text,
  ai_score numeric(5,2),
  risk_level text,
  status text not null default 'submitted',
  accepted_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger proposals_set_updated_at
before update on public.proposals
for each row execute function public.set_updated_at();

create index if not exists proposals_contract_id_idx on public.proposals using btree (contract_id);
create index if not exists proposals_vendor_id_idx on public.proposals using btree (vendor_id);
create index if not exists proposals_created_at_idx on public.proposals using btree (created_at desc);

-- Direct messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users (id) on delete cascade,
  receiver_id uuid not null references public.users (id) on delete cascade,
  text text not null,
  read boolean not null default false,
  timestamp timestamptz not null default now()
);

create index if not exists messages_sender_id_idx on public.messages using btree (sender_id);
create index if not exists messages_receiver_id_idx on public.messages using btree (receiver_id);
create index if not exists messages_timestamp_idx on public.messages using btree (timestamp desc);

-- Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null,
  title text,
  message text not null,
  read boolean not null default false,
  timestamp timestamptz not null default now()
);

create index if not exists notifications_user_id_idx on public.notifications using btree (user_id);
create index if not exists notifications_timestamp_idx on public.notifications using btree (timestamp desc);

-- Social posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.users (id) on delete cascade,
  company_name text not null,
  content text not null,
  image_url text,
  images text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  likes uuid[] not null default '{}'::uuid[],
  reactions jsonb not null default '[]'::jsonb,
  comments jsonb not null default '[]'::jsonb
);

create index if not exists posts_company_id_idx on public.posts using btree (company_id);
create index if not exists posts_created_at_idx on public.posts using btree (created_at desc);

-- Company reviews
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.users (id) on delete cascade,
  reviewer_id uuid not null references public.users (id) on delete cascade,
  reviewer_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists reviews_company_id_idx on public.reviews using btree (company_id);
create index if not exists reviews_created_at_idx on public.reviews using btree (created_at desc);

-- Cached AI analysis reports
create table if not exists public.analysis_reports (
  cache_key text primary key,
  contract jsonb,
  vendors jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger analysis_reports_set_updated_at
before update on public.analysis_reports
for each row execute function public.set_updated_at();

-- Background analysis jobs so long-running analysis can continue after navigation
create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  status text not null default 'queued',
  progress text,
  request jsonb not null,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger analysis_jobs_set_updated_at
before update on public.analysis_jobs
for each row execute function public.set_updated_at();

create index if not exists analysis_jobs_contract_id_idx on public.analysis_jobs using btree (contract_id);
create index if not exists analysis_jobs_status_idx on public.analysis_jobs using btree (status);
create index if not exists analysis_jobs_created_at_idx on public.analysis_jobs using btree (created_at desc);

-- Supabase Storage bucket used by proposal uploads
insert into storage.buckets (id, name, public)
values ('proposals', 'proposals', true)
on conflict (id) do update
set public = excluded.public;

-- Row Level Security
alter table public.users enable row level security;
alter table public.contracts enable row level security;
alter table public.proposals enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.posts enable row level security;
alter table public.reviews enable row level security;
alter table public.analysis_reports enable row level security;

-- USERS
create policy "users_select_all"
on public.users
for select
using (true);

create policy "users_insert_own_row"
on public.users
for insert
with check (auth.uid() = id);

create policy "users_update_own_row"
on public.users
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "users_delete_own_row"
on public.users
for delete
using (auth.uid() = id);

-- CONTRACTS
create policy "contracts_select_open_or_owner"
on public.contracts
for select
using (status in ('open', 'closed') or posted_by = auth.uid());

create policy "contracts_insert_owner"
on public.contracts
for insert
with check (posted_by = auth.uid());

create policy "contracts_update_owner"
on public.contracts
for update
using (posted_by = auth.uid())
with check (posted_by = auth.uid());

create policy "contracts_delete_owner"
on public.contracts
for delete
using (posted_by = auth.uid());

-- PROPOSALS
create policy "proposals_select_vendor_or_owner"
on public.proposals
for select
using (
  vendor_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_id
      and c.posted_by = auth.uid()
  )
);

create policy "proposals_insert_own"
on public.proposals
for insert
with check (vendor_id = auth.uid());

create policy "proposals_update_vendor_or_owner"
on public.proposals
for update
using (
  vendor_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_id
      and c.posted_by = auth.uid()
  )
)
with check (
  vendor_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_id
      and c.posted_by = auth.uid()
  )
);

create policy "proposals_delete_vendor_or_owner"
on public.proposals
for delete
using (
  vendor_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_id
      and c.posted_by = auth.uid()
  )
);

-- MESSAGES
create policy "messages_select_participants"
on public.messages
for select
using (sender_id = auth.uid() or receiver_id = auth.uid());

create policy "messages_insert_authenticated"
on public.messages
for insert
with check (auth.uid() is not null and sender_id = auth.uid());

create policy "messages_update_participants"
on public.messages
for update
using (sender_id = auth.uid() or receiver_id = auth.uid())
with check (sender_id = auth.uid() or receiver_id = auth.uid());

create policy "messages_delete_participants"
on public.messages
for delete
using (sender_id = auth.uid() or receiver_id = auth.uid());

-- NOTIFICATIONS
create policy "notifications_select_own"
on public.notifications
for select
using (user_id = auth.uid());

create policy "notifications_insert_authenticated"
on public.notifications
for insert
with check (auth.uid() is not null);

create policy "notifications_update_own"
on public.notifications
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "notifications_delete_own"
on public.notifications
for delete
using (user_id = auth.uid());

-- POSTS
create policy "posts_select_all"
on public.posts
for select
using (true);

create policy "posts_insert_own"
on public.posts
for insert
with check (company_id = auth.uid());

create policy "posts_update_authenticated"
on public.posts
for update
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "posts_delete_owner"
on public.posts
for delete
using (company_id = auth.uid());

-- REVIEWS
create policy "reviews_select_all"
on public.reviews
for select
using (true);

create policy "reviews_insert_own"
on public.reviews
for insert
with check (reviewer_id = auth.uid());

create policy "reviews_update_owner"
on public.reviews
for update
using (reviewer_id = auth.uid())
with check (reviewer_id = auth.uid());

create policy "reviews_delete_owner"
on public.reviews
for delete
using (reviewer_id = auth.uid());

-- ANALYSIS REPORTS
create policy "analysis_reports_authenticated_select"
on public.analysis_reports
for select
using (auth.uid() is not null);

create policy "analysis_reports_authenticated_write"
on public.analysis_reports
for insert
with check (auth.uid() is not null);

create policy "analysis_reports_authenticated_update"
on public.analysis_reports
for update
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "analysis_reports_authenticated_delete"
on public.analysis_reports
for delete
using (auth.uid() is not null);
