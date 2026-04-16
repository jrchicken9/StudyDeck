-- Optional per-question time limit (seconds) for custom test practice sessions.

alter table public.user_question_banks
  add column if not exists per_question_time_limit_sec integer null;

comment on column public.user_question_banks.per_question_time_limit_sec is
  'Max seconds per question in practice; null = no limit. App enforces 15–600 when set.';
