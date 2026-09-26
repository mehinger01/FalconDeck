-- Falcon Deck V2 - join-existing-school feature, Stage C (org location grant).
-- Per the reviewed Stage C design: lets a brand-new school's own admin
-- persist that organization's optional city/state after bootstrap_organization
-- creates it - without a new privileged RPC and without broadening
-- organizations' write surface beyond exactly those two columns.
--
-- Audited live before writing this migration:
--   - organizations has exactly one existing policy,
--     organizations_select_any_authenticated (SELECT, qual = true) - the
--     name added here does not collide with it or with anything else.
--   - public.app_is_admin(org_id uuid) already exists (used identically by
--     organization_settings/courses/bell_schedules' own admin-only write
--     policies) - reused unchanged, not redefined.
--   - organizations has no existing column-level privilege rows at all
--     (information_schema.column_privileges was empty) - this migration is
--     the first to grant anything narrower than whole-table privileges here.
--
-- Column-level GRANT + a row-level policy together is what makes this safe:
-- the GRANT alone would still let a caller attempt to write name/slug/id in
-- the same statement (a multi-column UPDATE only requires SELECT-able
-- privilege on the columns it actually SETs) - so restricting the GRANT to
-- (city, state) makes it a Postgres-enforced, structural impossibility to
-- rename a school or touch its slug/id through this policy, not merely an
-- RLS-trusted convention. The policy's own USING/WITH CHECK then restricts
-- *which row* - only an admin of that same organization, never another.
--
-- Deliberately NOT done here: no INSERT/DELETE grant, no broadening of the
-- existing SELECT policy, no change to organization_memberships RLS, no new
-- function.

grant update (city, state)
  on public.organizations
  to authenticated;

create policy organizations_update_own_location_admin_only
  on public.organizations
  for update
  to authenticated
  using (public.app_is_admin(id))
  with check (public.app_is_admin(id));
