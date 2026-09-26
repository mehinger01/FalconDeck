-- Falcon Deck V2 - join-existing-school feature, Stage D (active-schedule
-- RLS hardening only). No table/column changes - teacher_schedule_preferences
-- and bell_schedules already have every column this migration needs (Stage A).
--
-- Problem this closes: Stage A's composite FK
-- (organization_id, active_bell_schedule_id) -> bell_schedules(organization_id, id)
-- already makes a cross-organization active_bell_schedule_id structurally
-- impossible. It does NOT stop a teacher from setting their own
-- active_bell_schedule_id to a DIFFERENT teacher's private (owner_type='teacher')
-- schedule within the SAME organization - the FK only proves "a real schedule
-- row in this org," not "a schedule this caller may legitimately use." Since
-- an authenticated user can call Supabase directly (not just through this
-- app's UI), this must be enforced at the RLS boundary, not only in
-- application code.
--
-- Audited live before writing this migration:
--   teacher_schedule_preferences_insert: INSERT, with_check =
--     app_owns_membership_in_org(owner_membership_id, organization_id)
--   teacher_schedule_preferences_update: UPDATE,
--     using = app_owns_membership(owner_membership_id),
--     with_check = app_owns_membership_in_org(owner_membership_id, organization_id)
--   bell_schedules_select: SELECT,
--     qual = (owner_type='organization' AND app_is_member(organization_id))
--         OR (owner_type='teacher' AND app_owns_membership(owner_membership_id))
--   (teacher_schedule_preferences_delete/_select and bell_schedules_insert/
--    _update/_delete are unrelated to this change and are not touched.)
--
-- Design: reuse bell_schedules' existing ownership MODEL (org-owned, or
-- teacher-owned by this same membership) by restating the same two-way
-- disjunction directly in this EXISTS, rather than only trusting
-- bell_schedules_select to enforce it. This is deliberate belt-and-suspenders,
-- not an independence claim: this EXISTS runs as the calling authenticated
-- role, not a role that bypasses RLS, so bell_schedules' own SELECT policy
-- (bell_schedules_select) genuinely ALSO applies to this nested table access
-- - a row this EXISTS's own conditions would otherwise treat as a match
-- could still be filtered out first by bell_schedules_select, the same as
-- any other query against that table. The two layers are not independent;
-- they simply encode the same ownership rule (confirmed identical above:
-- app_is_member(organization_id) for org-owned, app_owns_membership(owner_membership_id)
-- for teacher-owned) and so are expected to always agree here - but this
-- policy is not written to rely SOLELY on bell_schedules_select agreeing:
-- restating the check explicitly means this WITH CHECK's own correctness
-- can be audited from this file alone, without having to trust that
-- bell_schedules_select is never changed out from under it. This is the
-- same ownership shape already used throughout this schema (courses.owner_type,
-- bell_schedules.owner_type, school_year_calendars.owner_type), not a new
-- independent model - see the architecture review this migration implements.
--
-- Not recursive: the EXISTS subquery reads public.bell_schedules, which has
-- no policy referencing teacher_schedule_preferences (confirmed by the live
-- audit above) - there is no cycle. As noted above, bell_schedules_select
-- DOES genuinely apply to this nested access (this is ordinary RLS
-- behavior for any authenticated, non-BYPASSRLS role querying an
-- RLS-enabled table from inside another policy's expression) - the
-- "not recursive" claim here is only that evaluating bell_schedules_select
-- never in turn re-evaluates teacher_schedule_preferences' own policies,
-- which would be the actual cycle to worry about, and does not occur.
--
-- No SECURITY DEFINER RPC and no trigger: a plain RLS WITH CHECK expression
-- is sufficient (validated below) and is the smallest, most consistent
-- mechanism with how every other ownership boundary in this schema is
-- enforced.
--
-- CORRECTED after review: bell_schedules has its OWN columns named
-- organization_id and owner_membership_id. Inside the EXISTS subquery
-- below, an UNQUALIFIED reference to organization_id/owner_membership_id
-- resolves to the innermost enclosing scope with a matching column name -
-- that is bell_schedules (aliased b), NOT the outer teacher_schedule_preferences
-- row being checked. Postgres raises no error for this; it silently binds
-- to the wrong column (b.organization_id = b.organization_id,
-- b.owner_membership_id = b.owner_membership_id - both tautologically
-- true), which would have made the entire ownership check a no-op: any
-- teacher-owned schedule row would satisfy "b.owner_type = 'teacher' and
-- b.owner_membership_id = b.owner_membership_id" regardless of whose
-- membership actually owns it. Proven empirically (read-only, no writes)
-- before this correction: a synthetic outer row with garbage,
-- non-matching organization_id/owner_membership_id values still satisfied
-- the unqualified comparison against a real bell_schedules row - and,
-- once each reference was qualified with the outer row's own alias, the
-- same comparison correctly returned false. The two references below are
-- now explicitly qualified with public.teacher_schedule_preferences - the
-- policy table's own name is available as its correlation name inside a
-- USING/WITH CHECK expression, exactly as a custom alias would be in an
-- ordinary query, and qualifying it is what makes the inner EXISTS resolve
-- against the OUTER row instead of shadowing itself against bell_schedules'
-- identically-named columns. active_bell_schedule_id needed no such
-- qualification (bell_schedules has no column of that name, so it was
-- never ambiguous), but is qualified below too, for self-consistency and
-- as defense-in-depth against a future column ever being added to
-- bell_schedules with that name.
--
-- ALTER POLICY changes ONLY the clause(s) named - each statement below
-- restates just WITH CHECK; the existing USING clause on
-- teacher_schedule_preferences_update, and the role list on both policies,
-- are untouched. The new clause is added with AND, strictly narrowing the
-- existing check - it can never make a previously-rejected write succeed,
-- only reject some writes the old check would have allowed (assuming the
-- qualification below is correct, which it has been verified to be).

alter policy teacher_schedule_preferences_insert
  on public.teacher_schedule_preferences
  with check (
    app_owns_membership_in_org(owner_membership_id, organization_id)
    and (
      active_bell_schedule_id is null
      or exists (
        select 1
        from public.bell_schedules b
        where b.id = public.teacher_schedule_preferences.active_bell_schedule_id
          and b.organization_id = public.teacher_schedule_preferences.organization_id
          and (
            b.owner_type = 'organization'
            or (b.owner_type = 'teacher' and b.owner_membership_id = public.teacher_schedule_preferences.owner_membership_id)
          )
      )
    )
  );

alter policy teacher_schedule_preferences_update
  on public.teacher_schedule_preferences
  with check (
    app_owns_membership_in_org(owner_membership_id, organization_id)
    and (
      active_bell_schedule_id is null
      or exists (
        select 1
        from public.bell_schedules b
        where b.id = public.teacher_schedule_preferences.active_bell_schedule_id
          and b.organization_id = public.teacher_schedule_preferences.organization_id
          and (
            b.owner_type = 'organization'
            or (b.owner_type = 'teacher' and b.owner_membership_id = public.teacher_schedule_preferences.owner_membership_id)
          )
      )
    )
  );
