-- Falcon Deck V2 Supabase Foundation - Stage B, migration 7 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.6.
-- Second dual-owned table, same owner_type discriminator pattern as courses
-- (§0.3).

create table public.bell_schedules (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_type text not null check (owner_type in ('organization', 'teacher')),
  owner_membership_id uuid references public.organization_memberships (id) on delete restrict,
  profile_key text,
  name text not null,
  description text,
  time_zone text not null default 'America/Detroit',
  is_default boolean not null default false,
  source text check (source in ('built-in', 'custom', 'imported')),
  needs_configuration boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bell_schedules_owner_matches_type check (
    (owner_type = 'organization' and owner_membership_id is null) or
    (owner_type = 'teacher' and owner_membership_id is not null)
  ),
  unique (organization_id, id)
);

-- Supports the composite FK from school_year_calendars (a later migration).
create unique index bell_schedules_profile_key
  on public.bell_schedules (organization_id, profile_key) where profile_key is not null;

alter table public.bell_schedules enable row level security;

-- Same dual-owned policy shape as courses (V2_DATABASE_SCHEMA.md §2.6,
-- V2_ARCHITECTURE.md §5): SELECT/DELETE ownership-based; INSERT/UPDATE's
-- WITH CHECK use app_owns_membership_in_org() for the teacher-owned branch.
create policy "bell_schedules_select"
  on public.bell_schedules for select
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_member(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create policy "bell_schedules_insert"
  on public.bell_schedules for insert
  to authenticated
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "bell_schedules_update"
  on public.bell_schedules for update
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  )
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "bell_schedules_delete"
  on public.bell_schedules for delete
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );
