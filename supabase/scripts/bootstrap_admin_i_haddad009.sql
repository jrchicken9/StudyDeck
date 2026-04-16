-- Run once in Supabase Dashboard → SQL Editor (runs as postgres; bypasses RLS).
-- Promotes i.haddad009@gmail.com to app admin and approves exam access.
-- If your email differs, change the `em` value in the block below.

do $$
declare
  em constant text := 'i.haddad009@gmail.com';
  uid uuid;
begin
  select u.id
  into uid
  from auth.users u
  where lower(trim(u.email)) = lower(trim(em))
  limit 1;

  if uid is null then
    raise exception
      'No auth.users row for %. Sign up first, confirm email if required, then run this script again.',
      em;
  end if;

  insert into public.app_admins (user_id)
  values (uid)
  on conflict (user_id) do nothing;

  insert into public.profiles (id, email, approved_at)
  values (uid, em, now())
  on conflict (id) do update
    set
      approved_at = now(),
      email = coalesce(public.profiles.email, excluded.email);
end $$;

-- Optional: confirm
select
  u.id,
  u.email,
  p.approved_at,
  (select count(*) from public.app_admins a where a.user_id = u.id) > 0 as is_admin
from auth.users u
left join public.profiles p on p.id = u.id
where lower(trim(u.email)) = lower(trim('i.haddad009@gmail.com'));
