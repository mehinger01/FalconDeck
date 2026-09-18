-- Falcon Deck V2 Supabase Foundation - Stage B, migration 11 of 13.
-- Table specs verbatim from docs/V2_DATABASE_SCHEMA.md §2.13 and §2.14
-- (+ §0.6 timestamps). Design Problem C (§6 of the schema doc): a lesson
-- belongs to a course and a date; lesson_class_sections links it to one or
-- more of a teacher's sections for that date. No LessonPlan/Occurrence
-- split, no LMS, no version-control system.

create table public.lessons (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  course_id text not null,
  lesson_date date not null,
  learning_target text not null default '',
  agenda_items jsonb not null default '[]',
  resources jsonb not null default '[]',
  announcements jsonb not null default '[]',
  materials text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_membership_id, id),
  foreign key (organization_id, course_id) references public.courses (organization_id, id)
);

-- course_id's composite FK (retained per §8): a lesson wired to a different
-- organization's course is a functional integrity error worth database
-- enforcement, same reasoning as class_sections.course_id (migration 6).
--
-- UNIQUE (organization_id, owner_membership_id, id) supports the composite
-- FK from lesson_class_sections below.
--
-- No unique constraint on (course_id, lesson_date), deliberately - see §6;
-- the real "one lesson per section per day" invariant lives on
-- lesson_class_sections.
--
-- materials (nullable, no default) maps to DailyLesson.materials -
-- teacher-facing free-text prep/materials list, optional since older
-- lessons and any lesson with nothing entered leave it unset. Added
-- post-lock: this field did not exist in DailyLesson when
-- V2_DATABASE_SCHEMA.md §2.13 was written (2026-08-27) and was introduced
-- later (2026-09-14) - compatibility-audit correction, not a design change.

alter table public.lessons enable row level security;

-- Strictly owner-only (V2_ARCHITECTURE.md §5), same pattern as
-- class_sections and teacher_period_assignments.
create policy "lessons_select"
  on public.lessons for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "lessons_insert"
  on public.lessons for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "lessons_update"
  on public.lessons for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "lessons_delete"
  on public.lessons for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create table public.lesson_class_sections (
  lesson_id text not null,
  class_section_id text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  lesson_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lesson_id, class_section_id),
  unique (class_section_id, lesson_date),
  foreign key (organization_id, owner_membership_id, lesson_id)
    references public.lessons (organization_id, owner_membership_id, id) on delete cascade,
  foreign key (organization_id, owner_membership_id, class_section_id)
    references public.class_sections (organization_id, owner_membership_id, id) on delete cascade
);

-- Both composite FKs retained with explicit ON DELETE CASCADE (§8) - the
-- highest-value case in the whole schema: they make it a
-- database-structural impossibility, not just an RLS-trusted assumption,
-- for this table to link a lesson and section belonging to different
-- teachers or different organizations.
--
-- UNIQUE (class_section_id, lesson_date) is the actual "at most one lesson
-- per section per day" invariant, matching findLessonForSection's current
-- behavior exactly (§2.14).

alter table public.lesson_class_sections enable row level security;

create policy "lesson_class_sections_select"
  on public.lesson_class_sections for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "lesson_class_sections_insert"
  on public.lesson_class_sections for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "lesson_class_sections_update"
  on public.lesson_class_sections for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "lesson_class_sections_delete"
  on public.lesson_class_sections for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));
