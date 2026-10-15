-- Falcon Deck Teacher Transition Content initiative - Stage B, migration 2 of 2.
-- New dedicated table for teacher-owned Present Mode transition/passing
-- screen overrides - see TransitionOverride's own doc comment
-- (types/transitionOverride.ts) and the transition-content design report
-- (Sections E/F/G) for the full design.
--
-- Deliberately NOT a foreign key of `lessons`/`lesson_class_sections` - an
-- override can exist for a (date, class_section_id) with no DailyLesson row
-- at all (design report Section 13: "no lesson today" must still resolve
-- safely), and this table must never force a lesson into existence just to
-- hold an override. Deliberately NOT a foreign key of
-- bell_schedules/schedule_blocks/schedule_block_overrides either - keyed by
-- destination class + date, never by schedule/block (design report
-- Section 5), so it is structurally impossible for a write here to touch
-- any shared-schedule table.
--
-- Tri-state materials/warmup override representation: a plain nullable
-- text column alone cannot distinguish "no override" from "explicitly
-- hidden" (both would be SQL NULL). Mirrors the existing
-- schedule_block_overrides.class_section_overridden + class_section_id
-- pattern (20260829120700_schedule_blocks.sql) rather than inventing a new
-- convention:
--   *_overridden = false             -> TypeScript undefined (no override, use the live lesson value)
--   *_overridden = true,  value NULL -> TypeScript null (explicitly hidden)
--   *_overridden = true,  value text -> TypeScript string (custom override text)
-- See lib/data/supabaseMapping.ts's transitionOverrideToRow/rowToTransitionOverride
-- for the exact round-trip and its own regression coverage.
--
-- `note` has no tri-state - there is no live default for it to fall back
-- to (design report Section 4), so a plain nullable text column is
-- sufficient: NULL/absent means nothing shown, any text is shown as-is.
--
-- `id` is a client-generated text primary key (generateId("transition-override")
-- - see lib/store/id.ts), matching lessons/class_sections' convention, NOT
-- teacher_period_assignments' `uuid default gen_random_uuid()` - per the
-- Stage A model foundation's locked id convention.

create table public.transition_overrides (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  owner_membership_id uuid not null references public.organization_memberships (id) on delete restrict,
  class_section_id text not null,
  transition_date date not null,
  materials_overridden boolean not null default false,
  materials_override text,
  warmup_overridden boolean not null default false,
  warmup_override text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_membership_id, transition_date, class_section_id),
  foreign key (organization_id, owner_membership_id, class_section_id)
    references public.class_sections (organization_id, owner_membership_id, id) on delete cascade,
  -- Closes the one state a boolean+nullable-value pair cannot otherwise
  -- prevent: FALSE + text (a stray override value sitting under
  -- "overridden=false", which the mapping layer would silently discard as
  -- "no override" - see rowToTransitionOverride's decodeOverrideField,
  -- which always returns undefined when overridden=false regardless of
  -- what `value` holds). Naming mirrors courses.courses_owner_matches_type
  -- (20260829120400_courses.sql), this schema's existing convention for a
  -- named cross-column CHECK. Deliberately no non-empty/trim restriction on
  -- the text itself - an empty string stays a technically valid custom
  -- override; only the FALSE+text combination is disallowed.
  constraint transition_overrides_materials_override_consistency
    check (materials_overridden or materials_override is null),
  constraint transition_overrides_warmup_override_consistency
    check (warmup_overridden or warmup_override is null)
);

-- The composite FK above is DB-enforced, not just RLS-trusted - same
-- pattern as teacher_period_assignments.class_section_id
-- (20260829120800_teacher_period_assignments.sql): it guarantees
-- class_section_id belongs to BOTH the same organization AND the same
-- teacher membership as the override row itself. A cross-teacher or
-- cross-organization override is a database-structural impossibility, not
-- just something RLS happens to prevent.
--
-- UNIQUE (owner_membership_id, transition_date, class_section_id) is the
-- real "at most one override per teacher, per date, per destination class"
-- invariant - matches findTransitionOverride's (date, classSectionId)
-- lookup exactly, scoped per-teacher since owner_membership_id is part of
-- the key (two different teachers may each have their own override for the
-- same class section and date, e.g. a co-taught section).
--
-- No trigger maintains `updated_at` on UPDATE - there is no such trigger
-- anywhere in this schema (confirmed by audit; every other table's
-- `updated_at` is either set once at INSERT via `default now()` or written
-- explicitly by the app from a TypeScript-side timestamp field, e.g.
-- DailyLesson.updatedAt via lessonToRow). TransitionOverride carries no
-- createdAt/updatedAt field in its Stage A locked TypeScript shape, so this
-- follows teacher_period_assignments' own precedent exactly: the insert
-- type omits both timestamp columns and lets `default now()` cover INSERT
-- only; an UPDATE that doesn't touch these columns leaves updated_at at its
-- original value. Purely informational/ops columns, not read by the app.

alter table public.transition_overrides enable row level security;

-- Strictly owner-only (V2_ARCHITECTURE.md §5), same pattern as lessons and
-- teacher_period_assignments: SELECT/DELETE use app_owns_membership()
-- alone; INSERT/UPDATE's WITH CHECK use app_owns_membership_in_org() so a
-- write can never attach this row's organization_id to a membership from a
-- different organization. No admin/same-organization exception - a
-- teacher's transition overrides are exactly as private as their lessons.
create policy "transition_overrides_select"
  on public.transition_overrides for select
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

create policy "transition_overrides_insert"
  on public.transition_overrides for insert
  to authenticated
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "transition_overrides_update"
  on public.transition_overrides for update
  to authenticated
  using (public.app_owns_membership(owner_membership_id))
  with check (public.app_owns_membership_in_org(owner_membership_id, organization_id));

create policy "transition_overrides_delete"
  on public.transition_overrides for delete
  to authenticated
  using (public.app_owns_membership(owner_membership_id));

-- REQUIRED, per the lesson learned in 20260915211502_authenticated_table_grants.sql:
-- CREATE TABLE grants nothing to PUBLIC/authenticated by default in
-- Postgres - RLS policies only decide *which rows* a role may see/write
-- once that role already has the underlying table privilege. Every table
-- created before that corrective migration needed a retrofit; this table
-- is the first genuinely new one created SINCE it, so its grant is added
-- here, at creation time, rather than risking the same "permission denied
-- for table transition_overrides" gap it took a dedicated corrective
-- migration to discover and close.
grant select, insert, update, delete on table public.transition_overrides to authenticated;
