-- Falcon Deck V2 Supabase Foundation - Stage B, migration 3 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.3.
-- Also introduces the three SECURITY DEFINER helper functions every later
-- migration's RLS policies reuse (plan §2).

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role text not null default 'teacher' check (role in ('teacher', 'admin')),
  status text not null default 'active' check (status in ('active', 'invited', 'removed')),
  subject_area text,
  local_data_migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

-- Helper functions exist for two reasons (plan §2):
-- (a) organization_memberships' own admin-read policy would otherwise query
--     its own table from within its own RLS policy, which Postgres can
--     treat as infinite recursion - SECURITY DEFINER (owned by a role that
--     bypasses RLS) sidesteps that.
-- (b) reused across all 19 tables' policies instead of restating the same
--     EXISTS subquery 19 times.
-- `set search_path = public` guards against search_path hijacking on a
-- SECURITY DEFINER function; every reference inside is schema-qualified
-- regardless.

create function public.app_is_member(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create function public.app_is_admin(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'admin'
  );
$$;

-- Requires status = 'active', not just a matching id + user_id: a 'removed'
-- membership must not continue satisfying teacher-owner RLS policies on any
-- table that gates on app_owns_membership(). The row itself is retained
-- (owner_membership_id is ON DELETE RESTRICT everywhere, per
-- V2_DATABASE_SCHEMA.md §0.4) - this only revokes RLS access, it never
-- deletes data.
create function public.app_owns_membership(membership_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.id = membership_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

alter table public.organization_memberships enable row level security;

-- A user always reads their own row(s), regardless of status - a removed
-- teacher can still see that they were removed. An admin reads/writes every
-- row within their own organization; never across organizations
-- (V2_ARCHITECTURE.md §5). Deliberately no self-serve "join school" insert
-- path yet - membership rows are created only by the seed script / trusted
-- service-role tooling until a future onboarding milestone adds a
-- narrowly-scoped self-insert policy (plan §2). Note this policy's
-- self-read clause is intentionally NOT status-gated (unlike
-- app_owns_membership(), which every other table's owner-only policy uses).
create policy "organization_memberships_select_own_or_admin"
  on public.organization_memberships for select
  to authenticated
  using (user_id = auth.uid() or public.app_is_admin(organization_id));

create policy "organization_memberships_insert_admin_only"
  on public.organization_memberships for insert
  to authenticated
  with check (public.app_is_admin(organization_id));

create policy "organization_memberships_update_admin_only"
  on public.organization_memberships for update
  to authenticated
  using (public.app_is_admin(organization_id))
  with check (public.app_is_admin(organization_id));

create policy "organization_memberships_delete_admin_only"
  on public.organization_memberships for delete
  to authenticated
  using (public.app_is_admin(organization_id));

-- Defense-in-depth: organization_id and user_id must never change after
-- insert. RLS's WITH CHECK only sees the NEW row, so it cannot compare
-- against the pre-update value on its own - a BEFORE UPDATE trigger is the
-- standard, smallest robust mechanism for enforcing column immutability.
-- Legitimate admin edits to role/status/subject_area/local_data_migrated_at
-- via organization_memberships_update_admin_only are unaffected - this only
-- blocks changing which organization or which user a membership row is for.
create function public.prevent_membership_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
    raise exception 'organization_id and user_id are immutable on organization_memberships';
  end if;
  return new;
end;
$$;

create trigger organization_memberships_identity_immutable
  before update on public.organization_memberships
  for each row execute function public.prevent_membership_identity_change();
