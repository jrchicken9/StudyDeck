-- Ordered supplementary assets (images, tables) for custom questions.
-- Legacy `media_url` remains the first image URL when present for backward compatibility.

alter table public.user_questions
  add column if not exists assets jsonb;

comment on column public.user_questions.assets is
  'Ordered array of {kind: image|table, ...} for quiz display; use media_url for legacy single-image rows.';
