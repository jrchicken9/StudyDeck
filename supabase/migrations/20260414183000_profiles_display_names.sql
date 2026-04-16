-- Store first / last name on profiles for admin UI (from auth user metadata at signup).

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data->>'first_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'last_name'), '')
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        first_name = coalesce(
          nullif(excluded.first_name, ''),
          public.profiles.first_name
        ),
        last_name = coalesce(
          nullif(excluded.last_name, ''),
          public.profiles.last_name
        );
  return new;
end;
$$;

-- Backfill from existing auth metadata (Supabase migrations run with privileges to read auth.users).
update public.profiles p
set
  first_name = nullif(trim(u.raw_user_meta_data->>'first_name'), ''),
  last_name = nullif(trim(u.raw_user_meta_data->>'last_name'), '')
from auth.users u
where u.id = p.id;
