-- Community: post likes (feed ranking) and per-test ratings after sessions.

-- ——— Banks: like count + aggregate test (session) ratings ———

alter table public.user_question_banks
  add column if not exists community_like_count integer not null default 0;

alter table public.user_question_banks
  add column if not exists test_rating_sum integer not null default 0;

alter table public.user_question_banks
  add column if not exists test_rating_count integer not null default 0;

comment on column public.user_question_banks.community_like_count is
  'Denormalized count of community_bank_likes rows; maintained by trigger.';

comment on column public.user_question_banks.test_rating_sum is
  'Sum of star ratings for this test after completed sessions.';

comment on column public.user_question_banks.test_rating_count is
  'Number of distinct raters who rated this test.';

-- ——— One like per learner per published bank ———

create table if not exists public.community_bank_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  bank_id uuid not null references public.user_question_banks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, bank_id)
);

create index if not exists community_bank_likes_bank_idx
  on public.community_bank_likes (bank_id);

comment on table public.community_bank_likes is
  'Signed-in learners like a Community post (bank); used for feed ordering.';

alter table public.community_bank_likes enable row level security;

drop policy if exists "community_bank_likes_select_own" on public.community_bank_likes;
create policy "community_bank_likes_select_own"
  on public.community_bank_likes
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "community_bank_likes_insert_own" on public.community_bank_likes;
create policy "community_bank_likes_insert_own"
  on public.community_bank_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.user_question_banks b
      where b.id = bank_id
        and b.published_at is not null
        and b.user_id <> auth.uid()
        and (
          b.publication_audience = 'everyone'
          or (
            b.publication_audience = 'friends'
            and (
              exists (
                select 1
                from public.user_friendships f
                where f.user_id = auth.uid()
                  and f.friend_user_id = b.user_id
              )
            )
          )
        )
    )
  );

drop policy if exists "community_bank_likes_delete_own" on public.community_bank_likes;
create policy "community_bank_likes_delete_own"
  on public.community_bank_likes
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ——— One test rating per learner per bank (after session; enforced in app) ———

create table if not exists public.community_test_ratings (
  rater_user_id uuid not null references auth.users (id) on delete cascade,
  bank_id uuid not null references public.user_question_banks (id) on delete cascade,
  rating smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rater_user_id, bank_id),
  constraint community_test_ratings_range check (rating >= 1 and rating <= 5)
);

create index if not exists community_test_ratings_bank_idx
  on public.community_test_ratings (bank_id);

comment on table public.community_test_ratings is
  'Star rating for a published test after a learner completes a session.';

alter table public.community_test_ratings enable row level security;

drop policy if exists "community_test_ratings_select_own" on public.community_test_ratings;
create policy "community_test_ratings_select_own"
  on public.community_test_ratings
  for select
  to authenticated
  using (rater_user_id = auth.uid());

drop policy if exists "community_test_ratings_insert_own" on public.community_test_ratings;
create policy "community_test_ratings_insert_own"
  on public.community_test_ratings
  for insert
  to authenticated
  with check (
    rater_user_id = auth.uid()
    and exists (
      select 1
      from public.user_question_banks b
      where b.id = bank_id
        and b.published_at is not null
        and b.user_id <> auth.uid()
        and (
          b.publication_audience = 'everyone'
          or (
            b.publication_audience = 'friends'
            and exists (
              select 1
              from public.user_friendships f
              where f.user_id = auth.uid()
                and f.friend_user_id = b.user_id
            )
          )
        )
    )
  );

drop policy if exists "community_test_ratings_update_own" on public.community_test_ratings;
create policy "community_test_ratings_update_own"
  on public.community_test_ratings
  for update
  to authenticated
  using (rater_user_id = auth.uid())
  with check (rater_user_id = auth.uid());

drop policy if exists "community_test_ratings_delete_own" on public.community_test_ratings;
create policy "community_test_ratings_delete_own"
  on public.community_test_ratings
  for delete
  to authenticated
  using (rater_user_id = auth.uid());

-- ——— Maintain community_like_count ———

create or replace function public.recount_community_likes_for_bank(target_bank uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_bank is null then
    return;
  end if;
  update public.user_question_banks b
  set community_like_count = coalesce(
    (select count(*)::integer from public.community_bank_likes l where l.bank_id = target_bank),
    0
  )
  where b.id = target_bank;
end;
$$;

revoke all on function public.recount_community_likes_for_bank(uuid) from public;

create or replace function public.community_bank_likes_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recount_community_likes_for_bank(old.bank_id);
    return old;
  end if;
  perform public.recount_community_likes_for_bank(new.bank_id);
  return new;
end;
$$;

revoke all on function public.community_bank_likes_after_write() from public;

drop trigger if exists community_bank_likes_count_aiud on public.community_bank_likes;
create trigger community_bank_likes_count_aiud
  after insert or delete on public.community_bank_likes
  for each row
  execute function public.community_bank_likes_after_write();

-- ——— Maintain test_rating_sum / test_rating_count on banks ———

create or replace function public.refresh_bank_test_rating_stats(target_bank uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_bank is null then
    return;
  end if;
  update public.user_question_banks b
  set
    test_rating_sum = coalesce(s.s, 0),
    test_rating_count = coalesce(s.c, 0)
  from (
    select
      coalesce(sum(r.rating)::integer, 0) as s,
      count(*)::integer as c
    from public.community_test_ratings r
    where r.bank_id = target_bank
  ) s
  where b.id = target_bank;
end;
$$;

revoke all on function public.refresh_bank_test_rating_stats(uuid) from public;

create or replace function public.community_test_ratings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_bank_test_rating_stats(old.bank_id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.bank_id is distinct from new.bank_id then
    perform public.refresh_bank_test_rating_stats(old.bank_id);
  end if;
  perform public.refresh_bank_test_rating_stats(new.bank_id);
  return new;
end;
$$;

revoke all on function public.community_test_ratings_after_write() from public;

drop trigger if exists community_test_ratings_stats_aiud on public.community_test_ratings;
create trigger community_test_ratings_stats_aiud
  after insert or update or delete on public.community_test_ratings
  for each row
  execute function public.community_test_ratings_after_write();

-- Backfill like counts and test aggregates
select public.recount_community_likes_for_bank(b.id)
from public.user_question_banks b
where exists (select 1 from public.community_bank_likes l where l.bank_id = b.id);

select public.refresh_bank_test_rating_stats(b.id)
from public.user_question_banks b
where exists (select 1 from public.community_test_ratings r where r.bank_id = b.id);
