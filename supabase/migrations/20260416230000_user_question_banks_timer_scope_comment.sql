-- Optional scope on question_timer_config: per_question (default) vs whole_test (labeled Full Test in the app).

comment on column public.user_question_banks.question_timer_config is
  'Session timer JSON: seconds, display (countdown|countup), onExpire (reveal|reference), scope (per_question|whole_test = Full Test UI, default per_question). Null = no timer.';
