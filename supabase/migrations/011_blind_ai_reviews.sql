-- The AI reviewer no longer sees how X rated a note, the raters' reasons or
-- the other notes on the post, so its recommendation is its own judgement and
-- not a reading of the ratings. It also names the labels that apply, so its
-- answer can be compared with a labeller's label by label.

-- The reviews written so far saw the ratings. A new review replaces a note's
-- old one, so this keeps a copy of them, to compare the two.
create table taste.ai_reviews_unblinded as select * from taste.ai_reviews;
alter table taste.ai_reviews_unblinded add primary key (source, note_id);

alter table taste.ai_reviews_unblinded enable row level security;
grant select on taste.ai_reviews_unblinded to authenticated;
create policy labellers_read on taste.ai_reviews_unblinded for select to authenticated using ((select taste.is_labeller()));
grant all on taste.ai_reviews_unblinded to service_role;

-- The names of the labels the reviewer gives the note, as in taste.labels.
alter table taste.ai_reviews add column labels text[] not null default '{}';

create or replace function taste.ai_review_card(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select jsonb_build_object('explanation', a.explanation, 'recommendation', a.recommendation, 'reasoning', a.reasoning,
                            'labels', to_jsonb(a.labels), 'model', a.model, 'createdAt', a.created_at)
    from ai_reviews a
   where a.source = p_source and a.note_id = p_note_id
$$;
