-- StudyDeck: account access control
-- Run this in the Supabase SQL editor (or via CLI) on your project.
--
-- After migration:
-- 1) Approve yourself: insert into public.app_admins (user_id) values ('<your-auth-user-uuid>');
--    Also set your profile approved: update public.profiles set approved_at = now() where id = '<uuid>';
-- 2) Optional: add public.profiles to the supabase_realtime publication if you want live approval updates.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create index if not exists profiles_approved_at_idx on public.profiles (approved_at);

alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.app_admins a
      where a.user_id = auth.uid()
    )
  );

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own"
  on public.app_admins
  for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

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
  set approved_at = now()
  where id = target_id;
end;
$$;

revoke all on function public.admin_approve_profile(uuid) from public;
grant execute on function public.admin_approve_profile(uuid) to authenticated;
