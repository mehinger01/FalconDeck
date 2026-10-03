-- Falcon Deck Stage E (Bell Schedule CSV Import) - atomic creation RPC.
--
-- Creates exactly one teacher-owned bell_schedules row plus all of its
-- schedule_blocks rows inside a single Postgres transaction. A plpgsql
-- function body commits or rolls back as one unit (see
-- 20260914140000_bootstrap_organization.sql's own doc comment for this same
-- guarantee) - this replaces the ordinary save()/applyDiff whole-AppData
-- diff path for THIS one write only, because that path issues the
-- bell_schedules and schedule_blocks writes as two separate, independent
-- upsert calls (lib/data/supabaseDataRepository.ts's applyDiff). A failure
-- between those two calls can leave an orphan schedule row with zero
-- blocks - the Stage E design review flagged this as unacceptable for a
-- bulk, multi-row import. This function cannot produce that outcome: any
-- failure anywhere in its body - an explicit validation check or a
-- constraint violation on either INSERT - rolls back every write it already
-- made this call.
--
-- V1 scope (teacher-private import only, per the approved Stage E design):
--   - always owner_type = 'teacher', source = 'imported'
--   - only the 5 Stage E CSV kinds are accepted - instructional, passing,
--     lunch, prep, enrichment. 'custom' is a real, separately-existing kind
--     (schedule_blocks.kind's own CHECK constraint allows it) but Stage E's
--     CSV format deliberately excludes it, so this RPC enforces the same
--     boundary rather than exposing a capability the UI doesn't support.
--     custom_kind_label is never read from the payload - always written as
--     NULL.
--   - never activates the schedule (teacher_schedule_preferences untouched)
--   - never creates teacher_period_assignments, schedule_block_overrides,
--     or class-section mappings
--   - never creates or modifies an organization-owned/shared schedule
--   - never modifies any existing schedule row
--
-- Authority comes solely from auth.uid() plus an independently-verified
-- ACTIVE membership in the caller-supplied p_organization_id - same pattern
-- as 20260924222129_join_existing_school_stage_b_rpc.sql's
-- join_existing_school (a caller-supplied id is only ever used after being
-- checked against the caller's own real rows, never written anywhere
-- unchecked). owner_membership_id is derived here, never accepted as a
-- parameter; owner_type and source are hard-coded, never accepted at all -
-- a CSV (or a crafted direct RPC call bypassing the app's own UI) cannot
-- grant itself shared/admin status or any other authority this function
-- doesn't already hard-code.
--
-- No advisory lock is needed here, unlike bootstrap_organization/
-- join_existing_school: those guard a global "at most one active
-- membership" invariant that a concurrent call could violate. This function
-- creates an independent new row identified by a caller-generated id (the
-- same client-generates-ids convention every other locally-created
-- schedule/course/section in this app already uses - see lib/store/id.ts's
-- generateId); two concurrent calls by the same user simply create two
-- independent schedules, which is ordinary concurrent usage, not a race to
-- close.

create or replace function public.import_bell_schedule(
  p_organization_id uuid,
  p_id text,
  p_name text,
  p_blocks jsonb,
  p_time_zone text default 'America/Detroit'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership_id uuid;
  v_trimmed_name text := btrim(p_name);
  v_block_count integer;
  v_distinct_block_id_count integer;
  v_has_student_facing_block boolean := false;
  v_block jsonb;
  v_index integer := 0;
  v_start time;
  v_end time;
  v_kind text;
  v_label text;
  v_block_id text;
  v_prev_end time;
  v_prev_label text;
  v_sorted_label text;
  v_sorted_start time;
  v_sorted_end time;
  v_result jsonb;
begin
  -- (1) Identity: auth.uid() is the only trusted identity input - never a
  -- caller-supplied user id, and never anything from user_metadata. Same
  -- convention as bootstrap_organization/join_existing_school.
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  -- (2) Authority: independently verify the caller has an ACTIVE membership
  -- in p_organization_id - never trusted as given. membership_id is
  -- resolved here, never accepted as a parameter, so a caller cannot write
  -- as another teacher's membership even if they guessed its id.
  select m.id into v_membership_id
  from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = v_user_id
    and m.status = 'active';

  if v_membership_id is null then
    raise exception 'You do not have an active membership in this organization.' using errcode = '42501';
  end if;

  -- (3) Validate the schedule name server-side - client-side validation is
  -- a UX nicety only, never trusted here (same convention as
  -- bootstrap_organization's organization-name check).
  if v_trimmed_name is null or v_trimmed_name = '' then
    raise exception 'Schedule name is required.' using errcode = '22023';
  end if;
  if length(v_trimmed_name) > 200 then
    raise exception 'Schedule name is too long.' using errcode = '22023';
  end if;

  if p_id is null or btrim(p_id) = '' then
    raise exception 'Schedule id is required.' using errcode = '22023';
  end if;

  -- (4) Validate the blocks payload shape and content before writing
  -- anything. jsonb_typeof guards against a caller sending something other
  -- than a JSON array for p_blocks.
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'At least one schedule block is required.' using errcode = '22023';
  end if;

  v_block_count := jsonb_array_length(p_blocks);
  if v_block_count = 0 then
    raise exception 'At least one schedule block is required.' using errcode = '22023';
  end if;

  select count(distinct value ->> 'id') into v_distinct_block_id_count
  from jsonb_array_elements(p_blocks);
  if v_distinct_block_id_count <> v_block_count then
    raise exception 'Duplicate block id in import payload.' using errcode = '22023';
  end if;

  -- (4a) Per-row validation, in payload order.
  for v_block in select value from jsonb_array_elements(p_blocks)
  loop
    v_index := v_index + 1;
    v_block_id := v_block ->> 'id';
    v_label := btrim(v_block ->> 'label');
    v_kind := v_block ->> 'kind';

    if v_block_id is null or btrim(v_block_id) = '' then
      raise exception 'Block % is missing an id.', v_index using errcode = '22023';
    end if;
    if v_label is null or v_label = '' then
      raise exception 'Block % is missing a name.', v_index using errcode = '22023';
    end if;
    if length(v_label) > 200 then
      raise exception 'Block % name is too long.', v_index using errcode = '22023';
    end if;
    -- Only the 5 Stage E CSV kinds are accepted - 'custom' is deliberately
    -- excluded (see module comment above), even though
    -- schedule_blocks.kind's own CHECK constraint would otherwise allow it.
    if v_kind is null or v_kind not in ('instructional', 'passing', 'lunch', 'prep', 'enrichment') then
      raise exception 'Block % has an unrecognized type.', v_index using errcode = '22023';
    end if;
    if v_kind in ('instructional', 'enrichment') then
      v_has_student_facing_block := true;
    end if;

    begin
      v_start := (v_block ->> 'start_time')::time;
      v_end := (v_block ->> 'end_time')::time;
    exception when others then
      raise exception 'Block % has an invalid start or end time.', v_index using errcode = '22023';
    end;

    -- No cross-midnight representation exists at this column type (`time`,
    -- not `interval`/a day-spanning type) - end <= start is rejected
    -- outright rather than interpreted as wrapping to the next day, same as
    -- schedule_blocks_time_range's own CHECK constraint this mirrors.
    if v_end <= v_start then
      raise exception 'Block % ends at or before it starts.', v_index using errcode = '22023';
    end if;
  end loop;

  if not v_has_student_facing_block then
    raise exception 'At least one class/instructional block is required.' using errcode = '22023';
  end if;

  -- (4b) Whole-payload overlap check - same semantic rule as
  -- lib/schedule/validateSchedule.ts: sorted by start_time, a block's
  -- end_time strictly after the next block's start_time is an overlap. This
  -- is NOT enforced by any table constraint (schedule_blocks_time_range
  -- only checks a single row's own end > start), so it must be checked
  -- here - never left to the browser/CSV layer alone, which a direct RPC
  -- call could bypass entirely. Gaps between blocks remain valid and are
  -- never flagged.
  --
  -- Two blocks sharing the exact same start_time are structurally caught by
  -- this same check regardless of sort tie-breaking: whichever sorts first
  -- already has end_time > its own start_time (enforced per-row above), and
  -- that start_time equals the other block's start_time by assumption, so
  -- v_prev_end > v_sorted_start is guaranteed true. This also means an
  -- exact duplicate block row (identical start/end, whatever else differs)
  -- is always caught here too - no separate duplicate-detection pass is
  -- needed.
  v_prev_end := null;
  v_prev_label := null;

  for v_sorted_label, v_sorted_start, v_sorted_end in
    select value ->> 'label', (value ->> 'start_time')::time, (value ->> 'end_time')::time
    from jsonb_array_elements(p_blocks)
    order by (value ->> 'start_time')::time
  loop
    if v_prev_end is not null and v_prev_end > v_sorted_start then
      raise exception 'Block "%" overlaps with "%".', v_prev_label, v_sorted_label using errcode = '22023';
    end if;
    v_prev_end := v_sorted_end;
    v_prev_label := v_sorted_label;
  end loop;

  -- (5) Create the schedule. owner_type/source are hard-coded - never
  -- accepted from the caller. id is the caller-generated value (see module
  -- comment above); its own PRIMARY KEY is the uniqueness backstop - a
  -- collision raises unique_violation, which aborts this entire call (see
  -- the module comment on function-level atomicity), identical to how
  -- bootstrap_organization treats a slug collision.
  insert into public.bell_schedules (
    id, organization_id, owner_type, owner_membership_id, profile_key,
    name, description, time_zone, is_default, source, needs_configuration
  )
  values (
    p_id, p_organization_id, 'teacher', v_membership_id, null,
    v_trimmed_name, null, coalesce(p_time_zone, 'America/Detroit'), false, 'imported', false
  );

  -- (6) Create every block in one bulk INSERT - a single statement, so a
  -- constraint violation on any one row (e.g. schedule_blocks_time_range,
  -- defense-in-depth beyond the explicit loop checks above) aborts the
  -- whole statement, which in turn aborts this whole function call.
  --
  -- position is NEVER taken from the payload's own array order (caller
  -- ordering is untrusted) - it is derived here from chronological
  -- start_time order via row_number(), with the block's own id as a
  -- deterministic tiebreaker for any (impossible, per the overlap check
  -- above) same-start-time case. class_section_id/is_lunch_window are
  -- never set by an import - out of scope per the module comment above.
  -- custom_kind_label is always NULL - never read from the payload.
  insert into public.schedule_blocks (
    id, bell_schedule_id, organization_id, owner_type, owner_membership_id,
    position, label, kind, custom_kind_label, start_time, end_time,
    class_section_id, is_lunch_window
  )
  select
    ordered.value ->> 'id',
    p_id,
    p_organization_id,
    'teacher',
    v_membership_id,
    ordered.chronological_position,
    btrim(ordered.value ->> 'label'),
    ordered.value ->> 'kind',
    null,
    (ordered.value ->> 'start_time')::time,
    (ordered.value ->> 'end_time')::time,
    null,
    false
  from (
    select
      value,
      (row_number() over (
        order by (value ->> 'start_time')::time, value ->> 'id'
      ) - 1)::integer as chronological_position
    from jsonb_array_elements(p_blocks)
  ) as ordered;

  -- (7) Return the complete, canonical created row set - the caller
  -- converts this directly into a BellSchedule via the exact same
  -- rowsToBellSchedule() the ordinary load() path already uses (see
  -- lib/data/supabaseMapping.ts), so the client never has to guess at what
  -- was actually persisted. Blocks are returned ordered by their STORED
  -- position (the chronological order assigned above), not payload order.
  select jsonb_build_object(
    'schedule', to_jsonb(s.*),
    'blocks', coalesce((
      select jsonb_agg(to_jsonb(sb.*) order by sb.position)
      from public.schedule_blocks sb
      where sb.bell_schedule_id = p_id
    ), '[]'::jsonb)
  )
  into v_result
  from public.bell_schedules s
  where s.id = p_id;

  return v_result;
end;
$$;

comment on function public.import_bell_schedule(uuid, text, text, jsonb, text) is
  'Stage E (Bell Schedule CSV Import): atomically creates one teacher-owned bell_schedules row plus all of its schedule_blocks rows in a single transaction - all-or-nothing, never leaves an orphan schedule with zero blocks. Accepts only the 5 Stage E kinds (instructional, passing, lunch, prep, enrichment) - custom is rejected and custom_kind_label is always NULL. Rejects overlapping blocks (schedule_blocks has no DB constraint against this) and assigns schedule_blocks.position from chronological start_time order, never from caller array order. Authority comes solely from auth.uid() plus an independently-verified active membership in p_organization_id; owner_type/source are hard-coded (teacher/imported) and never accepted as input. Never activates the schedule, never creates teacher_period_assignments/schedule_block_overrides/class-section mappings, never touches an organization-owned schedule or an existing schedule row.';

revoke execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) from public;
revoke execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) from anon;
grant execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) to authenticated;
