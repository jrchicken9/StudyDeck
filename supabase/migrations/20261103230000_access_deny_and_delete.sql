-- Deny a pending account with an optional note, and let an admin delete another account.

alter table public.profiles
  add column if not exists access_denied_at timestamptz;

alter table public.profiles
  add column if not exists access_denial_note text;

comment on column public.profiles.access_denial_note is
  'Optional reason or steps shown to the person after access is denied.';

create or replace function public.admin_approve_profile(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null then
    raise exception 'target_id required';
  end if;
  if not exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;
  update public.profiles
  set
    approved_at = now(),
    access_denied_at = null,
    access_denial_note = null
  where id = target_id;
end;
$$;

create or replace function public.admin_deny_profile(target_id uuid, note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null then
    raise exception 'target_id required';
  end if;
  if not exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;
  if target_id = auth.uid() then
    raise exception 'cannot deny your own account';
  end if;
  update public.profiles
  set
    approved_at = null,
    access_denied_at = now(),
    access_denial_note = nullif(trim(note), '')
  where id = target_id;
end;
$$;

create or replace function public.admin_delete_account(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if target_id is null then
    raise exception 'target_id required';
  end if;
  if not exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;
  if target_id = auth.uid() then
    raise exception 'cannot remove your own account';
  end if;
  delete from auth.users where id = target_id;
end;
$$;

revoke all on function public.admin_approve_profile(uuid) from public;
grant execute on function public.admin_approve_profile(uuid) to authenticated;

revoke all on function public.admin_deny_profile(uuid, text) from public;
grant execute on function public.admin_deny_profile(uuid, text) to authenticated;

revoke all on function public.admin_delete_account(uuid) from public;
grant execute on function public.admin_delete_account(uuid) to authenticated;
