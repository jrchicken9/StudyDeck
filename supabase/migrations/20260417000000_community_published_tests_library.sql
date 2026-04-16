-- Community: published Work Shop tests, library saves, and broader read policies.

alter table public.user_question_banks
  add column if not exists published_at timestamptz null;

comment on column public.user_question_banks.published_at is
  'When set, the test appears in the community feed and other signed-in users can read it (and add it to their library).';

create table if not exists public.user_community_library (
  user_id uuid not null references auth.users (id) on delete cascade,
  bank_id uuid not null references public.user_question_banks (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, bank_id)
);

create index if not exists user_community_library_bank_id_idx
  on public.user_community_library (bank_id);

comment on table public.user_community_library is
  'Tests a learner saved from the community into My Tests (keeps access if the author later unpublishes).';

alter table public.user_community_library enable row level security;

drop policy if exists "user_community_library_select_own" on public.user_community_library;
create policy "user_community_library_select_own"
  on public.user_community_library
  for select
  to authenticated
  using (user_id = auth.uid());

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
    )
  );

drop policy if exists "user_community_library_delete_own" on public.user_community_library;
create policy "user_community_library_delete_own"
  on public.user_community_library
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Replace single owner-only policy on banks with operation-specific policies.
drop policy if exists "user_question_banks_owner" on public.user_question_banks;

drop policy if exists "user_question_banks_select" on public.user_question_banks;
create policy "user_question_banks_select"
  on public.user_question_banks
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or published_at is not null
    or exists (
      select 1
      from public.user_community_library l
      where l.bank_id = user_question_banks.id
        and l.user_id = auth.uid()
    )
  );

drop policy if exists "user_question_banks_insert" on public.user_question_banks;
create policy "user_question_banks_insert"
  on public.user_question_banks
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_question_banks_update" on public.user_question_banks;
create policy "user_question_banks_update"
  on public.user_question_banks
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_question_banks_delete" on public.user_question_banks;
create policy "user_question_banks_delete"
  on public.user_question_banks
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Read questions for banks that are published or saved in the learner's library.
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
          b.published_at is not null
          or exists (
            select 1
            from public.user_community_library l
            where l.bank_id = b.id
              and l.user_id = auth.uid()
          )
        )
    )
  );
