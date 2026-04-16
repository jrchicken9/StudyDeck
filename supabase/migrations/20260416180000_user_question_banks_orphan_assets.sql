-- Visuals/tables kept on the bank but not attached to any question (e.g. after last Detach).

alter table public.user_question_banks
  add column if not exists orphan_assets jsonb not null default '[]'::jsonb;

comment on column public.user_question_banks.orphan_assets is
  'JSON array of {kind: image|table, ...} not linked to any user_questions row; reusable from Manual add / Edit.';
