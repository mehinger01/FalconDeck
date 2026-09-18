-- Falcon Deck V2 Supabase Foundation - Stage B, migration 13 of 13.
-- Table specs verbatim from docs/V2_DATABASE_SCHEMA.md §2.17, §2.18, §2.19
-- (+ §0.6 timestamps). Three small, teacher-scoped, strictly-owner-only
-- tables closing out the 19-table V2 foundation schema.

create table public.class_presentation_settings (
  class_section_id text primary key references public.class_sections (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  arrival_instructions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.class_presentation_settings enable row level security;

-- Strictly owner-only (§2.17).
create policy "class_presentation_settings_select"
  on public.class_presentation_settings for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "class_presentation_settings_insert"
  on public.class_presentation_settings for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "class_presentation_settings_update"
  on public.class_presentation_settings for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "class_presentation_settings_delete"
  on public.class_presentation_settings for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create table public.classroom_experience_settings (
  owner_membership_id uuid primary key references public.organization_memberships (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  final_five_message text not null default '',
  show_end_of_day_screen boolean not null default true,
  end_of_day_message text not null default 'Have a great afternoon.',
  clean_screen_default_message text not null default 'Work Time',
  show_clock_on_clean_screen boolean not null default true,
  transition_countdown_enabled boolean not null default true,
  transition_arrival_instructions_enabled boolean not null default true,
  watermark_override_storage_path text,
  watermark_override_opacity numeric(3,2) check (watermark_override_opacity is null or watermark_override_opacity between 0 and 1),
  bell_offset_seconds integer not null default 0
    check (bell_offset_seconds between -120 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- watermark_override_storage_path: NULL => render the organization's
-- default (organization_settings); set => the teacher's own wins (§2.18).
-- Primary key is owner_membership_id itself (1:1), same shape as
-- organization_settings' organization_id PK in migration 4.
--
-- bell_offset_seconds maps to ClassroomExperienceSettings.bellOffsetSeconds
-- - calibrates Falcon Deck's displayed/schedule-driving clock to the
-- school's actual bell system. Range and default match
-- BELL_OFFSET_MIN_SECONDS/BELL_OFFSET_MAX_SECONDS/clampBellOffsetSeconds in
-- lib/schedule/time.ts exactly. Added post-lock: this field did not exist
-- in ClassroomExperienceSettings when V2_DATABASE_SCHEMA.md §2.18 was
-- written (2026-08-27) and was introduced later (2026-09-06) -
-- compatibility-audit correction, not a design change.

alter table public.classroom_experience_settings enable row level security;

create policy "classroom_experience_settings_select"
  on public.classroom_experience_settings for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "classroom_experience_settings_insert"
  on public.classroom_experience_settings for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "classroom_experience_settings_update"
  on public.classroom_experience_settings for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "classroom_experience_settings_delete"
  on public.classroom_experience_settings for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create table public.teacher_schedule_preferences (
  owner_membership_id uuid primary key references public.organization_memberships (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lunch_wave text not null default 'none' check (lunch_wave in ('A', 'B', 'C', 'none')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.teacher_schedule_preferences enable row level security;

create policy "teacher_schedule_preferences_select"
  on public.teacher_schedule_preferences for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "teacher_schedule_preferences_insert"
  on public.teacher_schedule_preferences for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "teacher_schedule_preferences_update"
  on public.teacher_schedule_preferences for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "teacher_schedule_preferences_delete"
  on public.teacher_schedule_preferences for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));
