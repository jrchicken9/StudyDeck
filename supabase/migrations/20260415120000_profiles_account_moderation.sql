-- Account moderation: active | suspended | restricted | banned (app-enforced; see AuthContext).

alter table public.profiles
  add column if not exists account_status text not null default 'active'
    constraint profiles_account_status_check
      check (account_status in ('active', 'suspended', 'restricted', 'banned'));

alter table public.profiles
  add column if not exists moderation_note text;

alter table public.profiles
  add column if not exists moderation_updated_at timestamptz;

create index if not exists profiles_account_status_idx on public.profiles (account_status);

comment on column public.profiles.account_status is
  'active: normal. suspended/restricted: no exam access. banned: only /account/moderation until cleared.';

create or replace function public.admin_set_account_status(
  target_id uuid,
  new_status text,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_id is null then
    raise exception 'target_id required';
  end if;
  if new_status is null or new_status not in ('active', 'suspended', 'restricted', 'banned') then
    raise exception 'invalid status';
  end if;
  if not exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;
  if target_id = auth.uid() and new_status = 'banned' then
    raise exception 'cannot ban your own account';
  end if;

  update public.profiles
  set
    account_status = new_status,
    moderation_note = nullif(trim(note), ''),
    moderation_updated_at = now()
  where id = target_id;
end;
$$;

revoke all on function public.admin_set_account_status(uuid, text, text) from public;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;
