-- Publication audience (everyone | friends) and pricing tier (free | paid stub).
-- Friendships table for friends-only visibility (population UI can follow later).

create table if not exists public.user_friendships (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  constraint user_friendships_no_self check (user_id <> friend_user_id)
);

create index if not exists user_friendships_friend_idx on public.user_friendships (friend_user_id);

comment on table public.user_friendships is
  'Friend link: expect both (a,b) and (b,a) when two users are friends. Used for friends-only community tests.';

alter table public.user_friendships enable row level security;

drop policy if exists "user_friendships_select_own" on public.user_friendships;
create policy "user_friendships_select_own"
  on public.user_friendships
  for select
  to authenticated
  using (user_id = auth.uid() or friend_user_id = auth.uid());

alter table public.user_question_banks
  add column if not exists publication_audience text;

alter table public.user_question_banks
  add column if not exists publication_pricing text;

update public.user_question_banks
set publication_audience = 'everyone'
where publication_audience is null or publication_audience not in ('everyone', 'friends');

update public.user_question_banks
set publication_pricing = 'free'
where publication_pricing is null or publication_pricing not in ('free', 'paid');

alter table public.user_question_banks
  alter column publication_audience set default 'everyone',
  alter column publication_audience set not null;

alter table public.user_question_banks
  alter column publication_pricing set default 'free',
  alter column publication_pricing set not null;

alter table public.user_question_banks
  drop constraint if exists user_question_banks_publication_audience_chk;

alter table public.user_question_banks
  add constraint user_question_banks_publication_audience_chk
  check (publication_audience in ('everyone', 'friends'));

alter table public.user_question_banks
  drop constraint if exists user_question_banks_publication_pricing_chk;

alter table public.user_question_banks
  add constraint user_question_banks_publication_pricing_chk
  check (publication_pricing in ('free', 'paid'));

comment on column public.user_question_banks.publication_audience is
  'everyone: discoverable by any signed-in learner. friends: only the author and users linked in user_friendships.';

comment on column public.user_question_banks.publication_pricing is
  'free or paid; payment gating is not enforced yet.';

-- ——— RLS: tighten published visibility ———

drop policy if exists "user_question_banks_select" on public.user_question_banks;
create policy "user_question_banks_select"
  on public.user_question_banks
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.user_community_library l
      where l.bank_id = user_question_banks.id
        and l.user_id = auth.uid()
    )
    or (
      published_at is not null
      and (
        publication_audience = 'everyone'
        or (
          publication_audience = 'friends'
          and (
            user_id = auth.uid()
            or exists (
              select 1
              from public.user_friendships f
              where f.user_id = auth.uid()
                and f.friend_user_id = user_question_banks.user_id
            )
          )
        )
      )
    )
  );

drop policy if exists "user_questions_community_select" on public.user_questions;
create policy "user_questions_community_select"
  on public.user_questions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_question_banks b
      where b.id = bank_id
        and (
          b.user_id = auth.uid()
          or exists (
            select 1
            from public.user_community_library l
            where l.bank_id = b.id
              and l.user_id = auth.uid()
          )
          or (
            b.published_at is not null
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
        )
    )
  );

drop policy if exists "user_community_library_insert_own" on public.user_community_library;
create policy "user_community_library_insert_own"
  on public.user_community_library
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.user_question_banks b
      where b.id = bank_id
        and b.user_id <> auth.uid()
        and b.published_at is not null
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
