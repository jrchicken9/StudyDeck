-- Friendlier default name for user-owned tests (displayed in UI).
alter table public.user_question_banks
  alter column title set default 'Untitled test';
