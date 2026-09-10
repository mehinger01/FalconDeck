-- Falcon Deck V2 Supabase Foundation - Stage B, migration 2 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.2.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

alter table public.organizations enable row level security;

-- SELECT for any authenticated user (needed later so onboarding can list
-- schools to join - not built in this milestone, but the policy shape is
-- right from day one, per V2_DATABASE_SCHEMA.md §2.2).
create policy "organizations_select_any_authenticated"
  on public.organizations for select
  to authenticated
  using (true);

-- No insert/update/delete policy for anon/authenticated: under RLS, a
-- command with no matching policy is denied for every role except one that
-- bypasses RLS (service_role). Only scripts/seed-ohhs.ts (service role)
-- writes here - see docs/V2_DATABASE_SCHEMA.md §2.2 ("write restricted to
-- service-role/trusted tooling").
