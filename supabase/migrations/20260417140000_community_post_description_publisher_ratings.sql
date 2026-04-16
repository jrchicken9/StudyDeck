-- Community posts: optional long description on banks; publisher reputation (1–5 stars).

-- ——— Banks: community-facing copy from the publisher ———

alter table public.user_question_banks
  add column if not exists publication_description text;

comment on column public.user_question_banks.publication_description is
  'Shown on Community with the published test; set or edited when publishing.';

-- ——— Profiles: aggregate publisher rating (maintained by trigger) ———

alter table public.profiles
  add column if not exists publisher_rating_sum integer not null default 0;

alter table public.profiles
  add column if not exists publisher_rating_count integer not null default 0;

comment on column public.profiles.publisher_rating_sum is
  'Sum of star ratings (1–5) this user received as a Community publisher.';

comment on column public.profiles.publisher_rating_count is
  'Number of distinct raters for this publisher.';

-- ——— One row per rater → publisher ———

create table if not exists public.publisher_ratings (
  rater_user_id uuid not null references auth.users (id) on delete cascade,
  publisher_user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rater_user_id, publisher_user_id),
  constraint publisher_ratings_no_self check (rater_user_id <> publisher_user_id),
  constraint publisher_ratings_rating_range check (rating >= 1 and rating <= 5)
);

create index if not exists publisher_ratings_publisher_idx
  on public.publisher_ratings (publisher_user_id);

comment on table public.publisher_ratings is
  'Signed-in learners rate a publisher (not an individual test). Aggregates on profiles.';

alter table public.publisher_ratings enable row level security;

drop policy if exists "publisher_ratings_select_own" on public.publisher_ratings;
create policy "publisher_ratings_select_own"
  on public.publisher_ratings
  for select
  to authenticated
  using (rater_user_id = auth.uid());

drop policy if exists "publisher_ratings_insert_own" on public.publisher_ratings;
create policy "publisher_ratings_insert_own"
  on public.publisher_ratings
  for insert
  to authenticated
  with check (
    rater_user_id = auth.uid()
    and rater_user_id <> publisher_user_id
  );

drop policy if exists "publisher_ratings_update_own" on public.publisher_ratings;
create policy "publisher_ratings_update_own"
  on public.publisher_ratings
  for update
  to authenticated
  using (rater_user_id = auth.uid())
  with check (
    rater_user_id = auth.uid()
    and rater_user_id <> publisher_user_id
  );

drop policy if exists "publisher_ratings_delete_own" on public.publisher_ratings;
create policy "publisher_ratings_delete_own"
  on public.publisher_ratings
  for delete
  to authenticated
  using (rater_user_id = auth.uid());

-- ——— Recompute profile aggregates ———

create or replace function public.refresh_publisher_rating_stats(publisher_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if publisher_id is null then
    return;
  end if;
  update public.profiles p
  set
    publisher_rating_sum = coalesce(s.s, 0),
    publisher_rating_count = coalesce(s.c, 0)
  from (
    select
      coalesce(sum(r.rating)::integer, 0) as s,
      count(*)::integer as c
    from public.publisher_ratings r
    where r.publisher_user_id = publisher_id
  ) s
  where p.id = publisher_id;
end;
$$;

revoke all on function public.refresh_publisher_rating_stats(uuid) from public;

create or replace function public.publisher_ratings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_publisher_rating_stats(old.publisher_user_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.publisher_user_id is distinct from new.publisher_user_id then
    perform public.refresh_publisher_rating_stats(old.publisher_user_id);
  end if;
  perform public.refresh_publisher_rating_stats(new.publisher_user_id);
  return new;
end;
$$;

revoke all on function public.publisher_ratings_after_write() from public;

drop trigger if exists publisher_ratings_stats_aiud on public.publisher_ratings;
create trigger publisher_ratings_stats_aiud
  after insert or update or delete on public.publisher_ratings
  for each row
  execute function public.publisher_ratings_after_write();

-- Backfill aggregates (no-op if table empty)
select public.refresh_publisher_rating_stats(p.id)
from public.profiles p
where exists (
  select 1 from public.publisher_ratings r where r.publisher_user_id = p.id
);

-- ——— Safe author rows for Community (definer; avoids widening full profiles SELECT) ———

create or replace function public.community_authors_for_ids(target_ids uuid[])
returns table (
  id uuid,
  first_name text,
  last_name text,
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
    p.first_name,
    p.last_name,
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
