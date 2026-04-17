-- Public publisher label for Community (optional; falls back to name on profile).

alter table public.profiles
  add column if not exists community_public_name text;

comment on column public.profiles.community_public_name is
  'Shown on Community posts and publisher profile instead of legal name when set. Max 80 chars; empty clears to fallback.';

-- ——— Replace RPC: single display_name for all viewers ———
-- OUT-parameter signature changed from (first_name, last_name, …) → (display_name, …);
-- PostgreSQL requires DROP before CREATE; CREATE OR REPLACE cannot change return row type.

drop function if exists public.community_authors_for_ids(uuid[]);

create function public.community_authors_for_ids(target_ids uuid[])
returns table (
  id uuid,
  display_name text,
  publisher_rating_sum integer,
  publisher_rating_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (p.id)
    p.id,
    coalesce(
      nullif(trim(p.community_public_name), ''),
      nullif(trim(both ' ' from concat_ws(' ', p.first_name, p.last_name)), ''),
      'Member'
    ) as display_name,
    p.publisher_rating_sum,
    p.publisher_rating_count
  from public.profiles p
  where p.id = any(target_ids)
    and exists (
      select 1
      from public.user_question_banks b
      where b.user_id = p.id
        and b.published_at is not null
        and (
          b.publication_audience = 'everyone'
          or (
            b.publication_audience = 'friends'
            and (
              b.user_id = auth.uid()
              or exists (
                select 1
                from public.user_friendships f
                where f.user_id = auth.uid()
                  and f.friend_user_id = b.user_id
              )
            )
          )
        )
    )
  order by p.id;
$$;

revoke all on function public.community_authors_for_ids(uuid[]) from public;
grant execute on function public.community_authors_for_ids(uuid[]) to authenticated;

comment on function public.community_authors_for_ids(uuid[]) is
  'Returns publisher id, display label (public name or name fallback), and rating aggregates for Community.';

-- ——— Learners set their own public Community name (no broad profiles UPDATE) ———

create or replace function public.set_my_community_public_name(new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := trim(coalesce(new_name, ''));
begin
  if length(t) > 80 then
    raise exception 'Community public name must be at most 80 characters';
  end if;
  if t = '' then
    t := null;
  end if;
  update public.profiles
  set community_public_name = t
  where id = auth.uid();
end;
$$;

revoke all on function public.set_my_community_public_name(text) from public;
grant execute on function public.set_my_community_public_name(text) to authenticated;
