-- Allow variable-length choices for imported/custom question banks.

alter table public.user_questions
  drop constraint if exists user_questions_correct_range,
  drop constraint if exists user_questions_choices_array;

alter table public.user_questions
  add constraint user_questions_choices_array
    check (
      jsonb_typeof(choices) = 'array'
      and jsonb_array_length(choices) >= 2
      and jsonb_array_length(choices) <= 26
    ),
  add constraint user_questions_correct_range
    check (
      correct_index >= 0
      and correct_index < jsonb_array_length(choices)
    );

comment on table public.user_questions is
  'MCQ choices stored in JSON array (2-26 non-empty strings); correct_index must reference a valid option.';
