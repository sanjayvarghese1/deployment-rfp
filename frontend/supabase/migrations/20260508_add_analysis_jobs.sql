-- Create persistent background analysis job storage
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

alter table public.analysis_jobs enable row level security;

create policy "analysis_jobs_authenticated_select"
on public.analysis_jobs
for select
using (auth.uid() is not null);

create policy "analysis_jobs_authenticated_write"
on public.analysis_jobs
for insert
with check (auth.uid() is not null);

create policy "analysis_jobs_authenticated_update"
on public.analysis_jobs
for update
using (auth.uid() is not null)
with check (auth.uid() is not null);

create policy "analysis_jobs_authenticated_delete"
on public.analysis_jobs
for delete
using (auth.uid() is not null);