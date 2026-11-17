-- The AI reviewer also answers whether the post needs a community note at
-- all, the question labellers answer in taste.needs_note (migration 16). Null
-- for reviews made before the reviewer was asked.
alter table taste.ai_reviews add column needs_note text check (needs_note in ('yes', 'no'));

create or replace function taste.ai_review_card(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select coalesce(jsonb_agg(jsonb_build_object('explanation', a.explanation, 'recommendation', a.recommendation, 'reasoning', a.reasoning,
                                               'labels', to_jsonb(a.labels), 'needsNote', a.needs_note, 'model', a.model, 'createdAt', a.created_at)
                            order by a.model), '[]')
    from ai_reviews a
   where a.source = p_source and a.note_id = p_note_id
$$;
