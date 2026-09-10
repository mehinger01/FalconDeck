-- Falcon Deck V2 Supabase Foundation - Stage B, migration 1 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.1 (+ §0.6 timestamps).
-- `profiles` mirrors auth.users 1:1 and is the platform-scoped identity every
-- organization_membership hangs off of.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user reads/updates only their own row (V2_DATABASE_SCHEMA.md §2.1). No
-- client-facing insert/delete policy: handle_new_user() below creates the
-- row atomically on signup via SECURITY DEFINER, bypassing RLS.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Standard Supabase pattern: create the matching profile row the moment a
-- new auth.users row is created, so profile creation is atomic with signup
-- and no application code is involved in the common path.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
