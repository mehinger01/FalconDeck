-- Falcon Deck V2 Supabase Foundation - Stage B, migration 5 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.5.
-- First of the two dual-owned tables (owner_type discriminator, shared by
-- courses and bell_schedules per §0.3).

create table public.courses (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_type text not null check (owner_type in ('organization', 'teacher')),
  owner_membership_id uuid references public.organization_memberships (id) on delete restrict,
  name text not null,
  color_hex text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_owner_matches_type check (
    (owner_type = 'organization' and owner_membership_id is null) or
    (owner_type = 'teacher' and owner_membership_id is not null)
  ),
  unique (organization_id, id)
);

create unique index courses_catalog_name_ci
  on public.courses (organization_id, lower(name)) where owner_type = 'organization';

-- Extends app_owns_membership(): also requires organization_id to match the
-- membership's own organization_id. app_owns_membership() alone proves the
-- current user actively holds owner_membership_id, but not that it belongs
-- to the same organization as the row being written - closes the gap
-- V2_DATABASE_SCHEMA.md §8 names ("the universal
-- organization_id-vs-owner_membership_id consistency gap") at the RLS layer
-- for writes. Defined once here; reused by every later teacher-owned
-- table's INSERT/UPDATE WITH CHECK.
create function public.app_owns_membership_in_org(membership_id uuid, org_id uuid)
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
      and m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

alter table public.courses enable row level security;

-- Dual-owned policy shape (V2_DATABASE_SCHEMA.md §2.5, V2_ARCHITECTURE.md
-- §5). SELECT/DELETE stay ownership-based: a malformed cross-org
-- teacher-owned row should never be creatable, so there is nothing extra to
-- guard on read/delete. INSERT's WITH CHECK and UPDATE's WITH CHECK use
-- app_owns_membership_in_org() so a write can never attach a teacher-owned
-- row's organization_id to a membership from a different organization.
-- UPDATE's USING clause stays ownership-based, matching SELECT/DELETE.
create policy "courses_select"
  on public.courses for select
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_member(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create policy "courses_insert"
  on public.courses for insert
  to authenticated
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "courses_update"
  on public.courses for update
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  )
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "courses_delete"
  on public.courses for delete
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );
