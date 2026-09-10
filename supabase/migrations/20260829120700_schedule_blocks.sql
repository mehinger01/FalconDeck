-- Falcon Deck V2 Supabase Foundation - Stage B, migration 8 of 13.
-- Table specs verbatim from docs/V2_DATABASE_SCHEMA.md §2.7 and §2.8.
-- Both tables carry their own denormalized owner_type/owner_membership_id/
-- organization_id (§0.2) rather than joining to their parent bell_schedule
-- for RLS - deliberate denormalization, not accidental duplication. Neither
-- table has an owner_matches_type CHECK constraint: §0.3 applies that
-- constraint only to courses/bell_schedules; here, owner_type/
-- owner_membership_id consistency with the parent row is named explicitly
-- in §8 as an application-layer invariant, not a DB-enforced one.

create table public.schedule_blocks (
  id text primary key,
  bell_schedule_id text not null references public.bell_schedules (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_type text not null check (owner_type in ('organization', 'teacher')),
  owner_membership_id uuid references public.organization_memberships (id) on delete restrict,
  position integer not null,
  label text not null,
  kind text not null check (kind in ('instructional', 'enrichment', 'prep', 'lunch', 'passing', 'custom')),
  custom_kind_label text,
  start_time time not null,
  end_time time not null,
  class_section_id text references public.class_sections (id) on delete set null,
  is_lunch_window boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bell_schedule_id, position),
  unique (organization_id, id),
  constraint schedule_blocks_time_range check (end_time > start_time)
);

alter table public.schedule_blocks enable row level security;

create policy "schedule_blocks_select"
  on public.schedule_blocks for select
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_member(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create policy "schedule_blocks_insert"
  on public.schedule_blocks for insert
  to authenticated
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "schedule_blocks_update"
  on public.schedule_blocks for update
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  )
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "schedule_blocks_delete"
  on public.schedule_blocks for delete
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create table public.schedule_block_overrides (
  id text primary key,
  schedule_block_id text not null references public.schedule_blocks (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_type text not null check (owner_type in ('organization', 'teacher')),
  owner_membership_id uuid references public.organization_memberships (id) on delete restrict,
  weekday text not null check (weekday in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  label text,
  kind text check (kind in ('instructional', 'enrichment', 'prep', 'lunch', 'passing', 'custom')),
  custom_kind_label text,
  class_section_overridden boolean not null default false,
  class_section_id text references public.class_sections (id) on delete set null,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_block_id, weekday),
  constraint schedule_block_overrides_time_range check (start_time is null or end_time is null or end_time > start_time)
);

alter table public.schedule_block_overrides enable row level security;

create policy "schedule_block_overrides_select"
  on public.schedule_block_overrides for select
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_member(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );

create policy "schedule_block_overrides_insert"
  on public.schedule_block_overrides for insert
  to authenticated
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "schedule_block_overrides_update"
  on public.schedule_block_overrides for update
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  )
  with check (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership_in_org(owner_membership_id, organization_id))
  );

create policy "schedule_block_overrides_delete"
  on public.schedule_block_overrides for delete
  to authenticated
  using (
    (owner_type = 'organization' and public.app_is_admin(organization_id))
    or (owner_type = 'teacher' and public.app_owns_membership(owner_membership_id))
  );
