-- Optional visual asset per custom question (image/data URL from DOCX imports).

alter table public.user_questions
  add column if not exists media_url text;

comment on column public.user_questions.media_url is
  'Optional visual reference for the question (URL or data URI) used when a diagram/image is required.';
