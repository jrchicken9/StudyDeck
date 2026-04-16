-- Rich per-question timer options for custom tests (direction, reveal vs reference).

alter table public.user_question_banks
  add column if not exists question_timer_config jsonb null;

comment on column public.user_question_banks.question_timer_config is
  'Per-question timer: {seconds, display: countdown|countup, onExpire: reveal|reference}. Null = off.';

-- Move legacy integer limits into JSON (countdown + auto-reveal).
update public.user_question_banks
set question_timer_config = jsonb_build_object(
  'seconds', per_question_time_limit_sec,
  'display', 'countdown',
  'onExpire', 'reveal'
)
where per_question_time_limit_sec is not null
  and (question_timer_config is null);

update public.user_question_banks
set per_question_time_limit_sec = null
where question_timer_config is not null;
