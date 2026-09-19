-- Falcon Deck V2 Supabase Foundation - Stage B, migration 10 of 13.
-- Table specs verbatim from docs/V2_DATABASE_SCHEMA.md §2.11 and §2.12
-- (+ §0.6 timestamps). Organization-owned Master Calendar: a school has a
-- canonical calendar, shared by every teacher, rather than each teacher
-- owning a separate imported copy (V2_ARCHITECTURE.md §2.7).

create table public.school_year_calendars (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  school_year text not null,
  time_zone text not null default 'America/Detroit',
  first_student_day date,
  last_student_day date,
  is_canonical boolean not null default false,
  default_bell_schedule_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, default_bell_schedule_id)
    references public.bell_schedules (organization_id, id)
);

-- Any number of rows may exist per (organization_id, school_year) - drafts,
-- alternates, future per-program variants. The partial unique index enforces
-- only "at most one canonical calendar per organization per school year",
-- the actual invariant that matters (§2.11).
create unique index school_year_calendars_one_canonical
  on public.school_year_calendars (organization_id, school_year)
  where is_canonical;

alter table public.school_year_calendars enable row level security;

-- SELECT for any member; admin-only writes (§2.11).
create policy "school_year_calendars_select"
  on public.school_year_calendars for select
  to authenticated
  using (public.app_is_member(organization_id));

create policy "school_year_calendars_insert"
  on public.school_year_calendars for insert
  to authenticated
  with check (public.app_is_admin(organization_id));

create policy "school_year_calendars_update"
  on public.school_year_calendars for update
  to authenticated
  using (public.app_is_admin(organization_id))
  with check (public.app_is_admin(organization_id));

create policy "school_year_calendars_delete"
  on public.school_year_calendars for delete
  to authenticated
  using (public.app_is_admin(organization_id));

create table public.school_calendar_exceptions (
  id text primary key,
  school_year_calendar_id text not null references public.school_year_calendars (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  type text not null check (type in ('no-school', 'no-students', 'special-bell')),
  title text not null,
  bell_schedule_id text references public.bell_schedules (id) on delete set null,
  source_schedule_profile text,
  dismissal_time text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_calendar_exceptions_date_range check (end_date >= start_date)
);

-- bell_schedule_id uses a plain, single-column FK with ON DELETE SET NULL,
-- not a composite (organization_id, bell_schedule_id) FK: SET NULL on that
-- composite would attempt to null organization_id too, which is NOT NULL on
-- this table. Same-organization validation for this field is an
-- application-layer invariant (§2.12/§8).
--
-- No overlap-prevention constraint, deliberately - the app's own
-- detectCalendarConflicts + skip/replace resolution UI already handles
-- this; a DB-level exclusion constraint would fight that workflow (§2.12).
--
-- school_calendar_exceptions_date_range is added beyond the doc's literal
-- SQL, mirroring the precedent set by schedule_blocks_time_range /
-- schedule_block_overrides_time_range in migration 8: a basic sanity check
-- every other date/time range in this schema enforces.

alter table public.school_calendar_exceptions enable row level security;

-- SELECT for any member; admin-only writes (§2.12).
create policy "school_calendar_exceptions_select"
  on public.school_calendar_exceptions for select
  to authenticated
  using (public.app_is_member(organization_id));

create policy "school_calendar_exceptions_insert"
  on public.school_calendar_exceptions for insert
  to authenticated
  with check (public.app_is_admin(organization_id));

create policy "school_calendar_exceptions_update"
  on public.school_calendar_exceptions for update
  to authenticated
  using (public.app_is_admin(organization_id))
  with check (public.app_is_admin(organization_id));

create policy "school_calendar_exceptions_delete"
  on public.school_calendar_exceptions for delete
  to authenticated
  using (public.app_is_admin(organization_id));
