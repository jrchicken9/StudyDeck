-- User-owned practice question banks (MCQ, 3 choices; same shape as static JSON exams).

create table if not exists public.user_question_banks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled test',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_questions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.user_question_banks (id) on delete cascade,
  stem text not null,
  choices jsonb not null,
  correct_index smallint not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint user_questions_correct_range check (correct_index >= 0 and correct_index <= 2),
  constraint user_questions_choices_array check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 3)
);

create index if not exists user_questions_bank_id_idx on public.user_questions (bank_id);
create index if not exists user_question_banks_user_id_idx on public.user_question_banks (user_id);

create or replace function public.touch_user_question_bank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bid uuid;
begin
  if tg_op = 'DELETE' then
    bid := old.bank_id;
  else
    bid := new.bank_id;
  end if;
  update public.user_question_banks
  set updated_at = now()
  where id = bid;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists user_questions_touch_bank on public.user_questions;
create trigger user_questions_touch_bank
  after insert or update or delete on public.user_questions
  for each row
  execute function public.touch_user_question_bank();

alter table public.user_question_banks enable row level security;
alter table public.user_questions enable row level security;

drop policy if exists "user_question_banks_owner" on public.user_question_banks;
create policy "user_question_banks_owner"
  on public.user_question_banks
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_questions_owner_select" on public.user_questions;
create policy "user_questions_owner_select"
  on public.user_questions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_question_banks b
      where b.id = bank_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "user_questions_owner_insert" on public.user_questions;
create policy "user_questions_owner_insert"
  on public.user_questions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.user_question_banks b
      where b.id = bank_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "user_questions_owner_update" on public.user_questions;
create policy "user_questions_owner_update"
  on public.user_questions
  for update
  to authenticated
  using (
    exists (
      select 1 from public.user_question_banks b
      where b.id = bank_id and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.user_question_banks b
      where b.id = bank_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "user_questions_owner_delete" on public.user_questions;
create policy "user_questions_owner_delete"
  on public.user_questions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.user_question_banks b
      where b.id = bank_id and b.user_id = auth.uid()
    )
  );

comment on table public.user_question_banks is 'User-created MCQ banks for StudyDeck practice.';
comment on table public.user_questions is 'Three string choices in JSON array; correct_index 0–2.';
