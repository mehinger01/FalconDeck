-- Falcon Deck V2 Supabase Foundation - Stage B, migration 9 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.10.
-- The bridge table the whole V2 architecture is built around: lets a
-- teacher attach class sections to an org-owned schedule block without
-- cloning the schedule.

create table public.teacher_period_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  schedule_block_id text not null,
  override_weekday text check (override_weekday in ('sunday','monday','tuesday','wednesday','thursday','friday','saturday')),
  class_section_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, schedule_block_id)
    references public.schedule_blocks (organization_id, id) on delete cascade,
  foreign key (organization_id, owner_membership_id, class_section_id)
    references public.class_sections (organization_id, owner_membership_id, id) on delete cascade
);

-- Both composite FKs above are DB-enforced, not just RLS-trusted:
-- schedule_block_id's guarantees the referenced block belongs to the same
-- organization as the assignment; class_section_id's guarantees the
-- referenced section belongs to the same organization AND same teacher.

-- Postgres treats every NULL as distinct in a plain unique constraint, so a
-- single UNIQUE (owner_membership_id, schedule_block_id, override_weekday)
-- would silently allow duplicate base (non-weekday) assignments. This pair
-- of partial unique indexes closes that gap: _base for the NULL case,
-- _weekday for ordinary composite uniqueness on real weekday values.
create unique index teacher_period_assignments_base
  on public.teacher_period_assignments (owner_membership_id, schedule_block_id)
  where override_weekday is null;

create unique index teacher_period_assignments_weekday
  on public.teacher_period_assignments (owner_membership_id, schedule_block_id, override_weekday)
  where override_weekday is not null;

alter table public.teacher_period_assignments enable row level security;

-- Strictly owner-only (V2_ARCHITECTURE.md §5). SELECT/DELETE use
-- app_owns_membership() alone; INSERT/UPDATE's WITH CHECK use
-- app_owns_membership_in_org() per the architecture decision applied
-- consistently since courses.
create policy "teacher_period_assignments_select"
  on public.teacher_period_assignments for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "teacher_period_assignments_insert"
  on public.teacher_period_assignments for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "teacher_period_assignments_update"
  on public.teacher_period_assignments for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "teacher_period_assignments_delete"
  on public.teacher_period_assignments for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));
