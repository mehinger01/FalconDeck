-- Falcon Deck V2 Supabase Foundation - Stage B, migration 4 of 13.
-- Table spec verbatim from docs/V2_DATABASE_SCHEMA.md §2.4.

create table public.organization_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  display_name text not null default '',
  watermark_storage_path text,
  watermark_opacity numeric(3,2) not null default 0.35 check (watermark_opacity between 0 and 1),
  branding_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_settings enable row level security;

-- Organization branding is the default every teacher's Present Mode renders
-- with (V2_ARCHITECTURE.md §2.4) - readable by any member. Writable only by
-- admins; a teacher's own override lives on classroom_experience_settings
-- (a later migration), never here. watermark_storage_path holds a Supabase
-- Storage path, not an inline base64 image (V2_DATABASE_SCHEMA.md §2.4).
create policy "organization_settings_select_member"
  on public.organization_settings for select
  to authenticated
  using (public.app_is_member(organization_id));

create policy "organization_settings_insert_admin_only"
  on public.organization_settings for insert
  to authenticated
  with check (public.app_is_admin(organization_id));

create policy "organization_settings_update_admin_only"
  on public.organization_settings for update
  to authenticated
  using (public.app_is_admin(organization_id))
  with check (public.app_is_admin(organization_id));

create policy "organization_settings_delete_admin_only"
  on public.organization_settings for delete
  to authenticated
  using (public.app_is_admin(organization_id));
