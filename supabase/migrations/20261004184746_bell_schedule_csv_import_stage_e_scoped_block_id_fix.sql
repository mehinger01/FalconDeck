-- Falcon Deck Stage E (Bell Schedule CSV Import) - corrective migration.
--
-- Fixes a defect in public.import_bell_schedule (see
-- 20261003195952_bell_schedule_csv_import_stage_e_rpc.sql, already applied):
-- schedule_blocks.id was being written as the raw, caller-supplied local
-- block id (e.g. "block-<uuid>") instead of the canonical scoped
-- representation every other write path in this app uses
-- (lib/data/scopedCloudId.ts's scopedCloudId(parentId, localId) - see
-- lib/data/supabaseMapping.ts's scheduleBlockToRow/scheduleBlockCloudId for
-- the existing convention this RPC failed to follow). schedule_blocks.id is
-- a single global primary key; a local ScheduleBlock id is only ever
-- guaranteed unique within its own BellSchedule, so the ordinary
-- (non-import) save path has always scoped it to its parent schedule's id
-- before writing. The read path (lib/data/supabaseMapping.ts's
-- rowsToBellSchedule) unconditionally calls parseScopedCloudId(block.id) and
-- throws if no unescaped ":" separator is found - exactly the failure a
-- schedule imported through the unfixed RPC produces when /schedule
-- attempts to load it.
--
-- This migration CREATE OR REPLACEs public.import_bell_schedule with the
-- IDENTICAL signature and restates its entire body verbatim (Postgres has
-- no way to patch a single statement in place - same reasoning
-- 20260914140000_bootstrap_organization.sql's own lock-key-correction
-- migration documents), changing ONLY how schedule_blocks.id is
-- constructed:
--
--   bell_schedules.id                  = p_id (raw)              - unchanged
--   schedule_blocks.bell_schedule_id    = p_id (raw)              - unchanged
--   schedule_blocks.id                  = scopedCloudId(p_id, localBlockId) - FIXED (was raw localBlockId)
--
-- Canonical escaping replicated exactly from scopedCloudId.ts's
-- escapeComponent(id): backslash is escaped first (\ -> \\), then colon
-- (: -> \:), applied independently to each of the two components before
-- joining with a single literal ":" - never a bare concatenation, which is
-- NOT equivalent whenever either component contains ":" or "\" (something
-- this function's own validation does not forbid in p_id or a block id, so
-- real escaping - not a shortcut - is required for correctness).
--
-- No other behavior changes: identical authority/membership checks,
-- identical name/id/payload validation (including the whole-payload overlap
-- guard and the 5-kind restriction), identical owner_type='teacher'/
-- source='imported' hard-coding, identical atomicity (one function
-- invocation, one implicit transaction - any exception rolls back
-- everything), identical returned JSON shape, and it still never activates
-- the schedule, never creates teacher_period_assignments or
-- schedule_block_overrides, and never touches an organization-owned or
-- existing schedule.

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
  v_escaped_schedule_id text;
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
  --
  -- CORRECTIVE FIX (this migration): schedule_blocks.id must be the
  -- canonical scoped representation - lib/data/scopedCloudId.ts's
  -- scopedCloudId(p_id, localBlockId) - never the raw local block id alone.
  -- v_escaped_schedule_id is computed once here (the schedule id is the
  -- same for every row in this bulk insert); each row additionally escapes
  -- its own block id the same way before the two are joined with a single
  -- literal ":" - replicating escapeComponent's exact two-step order
  -- (backslash first, then colon) so this can never diverge from what
  -- scopedCloudId() would produce client-side for the same (p_id,
  -- localBlockId) pair, which is what every future ordinary edit
  -- (applyDiff) will recompute when looking up/updating/deleting this same
  -- row. bell_schedule_id stays the RAW p_id - it is a plain foreign key to
  -- bell_schedules.id, which is never itself a scoped/composite value; only
  -- schedule_blocks.id (the global primary key) needs scoping.
  v_escaped_schedule_id := replace(replace(p_id, '\', '\\'), ':', '\:');

  insert into public.schedule_blocks (
    id, bell_schedule_id, organization_id, owner_type, owner_membership_id,
    position, label, kind, custom_kind_label, start_time, end_time,
    class_section_id, is_lunch_window
  )
  select
    v_escaped_schedule_id || ':' || replace(replace(ordered.value ->> 'id', '\', '\\'), ':', '\:'),
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
  'Stage E (Bell Schedule CSV Import): atomically creates one teacher-owned bell_schedules row plus all of its schedule_blocks rows in a single transaction - all-or-nothing, never leaves an orphan schedule with zero blocks. Accepts only the 5 Stage E kinds (instructional, passing, lunch, prep, enrichment) - custom is rejected and custom_kind_label is always NULL. Rejects overlapping blocks (schedule_blocks has no DB constraint against this) and assigns schedule_blocks.position from chronological start_time order, never from caller array order. schedule_blocks.id is stored as the canonical scoped representation (scopedCloudId(p_id, localBlockId) - escape backslash then colon, join with ":") - never the raw local block id, which the read path (parseScopedCloudId) cannot otherwise recover (corrected by 20261004184746_bell_schedule_csv_import_stage_e_scoped_block_id_fix.sql; see that migration for the defect this fixes). Authority comes solely from auth.uid() plus an independently-verified active membership in p_organization_id; owner_type/source are hard-coded (teacher/imported) and never accepted as input. Never activates the schedule, never creates teacher_period_assignments/schedule_block_overrides/class-section mappings, never touches an organization-owned schedule or an existing schedule row.';

-- Security posture explicitly restated here (unchanged from the original
-- migration) so this corrective migration is self-auditing: CREATE OR
-- REPLACE preserves the function's OID, and therefore its existing
-- GRANT/REVOKE state, on its own - these statements are not strictly
-- required to re-establish anything, but are restated verbatim so a reader
-- of this file alone (without cross-referencing the original) can confirm
-- the intended posture: no PUBLIC or anon execution, authenticated keeps
-- EXECUTE, and postgres's EXECUTE grant is explicitly restated rather than
-- left to be inferred from ownership alone.
revoke execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) from public;
revoke execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) from anon;
grant execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.import_bell_schedule(uuid, text, text, jsonb, text) to postgres;
