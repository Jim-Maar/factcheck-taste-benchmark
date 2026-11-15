-- Several models can review the same note, so their answers can be compared:
-- a review is now one per note and model, and saving again with the same
-- model replaces only that model's review. scripts/ai/run.ts runs a model
-- over a set of notes, one harness session per note, and saves what that
-- session used, so models can be compared on cost too.

alter table taste.ai_reviews drop constraint ai_reviews_pkey;
alter table taste.ai_reviews add primary key (source, note_id, model);

-- What the review's session used, as the harness reported it. Null for a
-- review saved by hand. cost_usd is null when the price isn't known: Codex
-- reports tokens but not dollars, and scripts/ai/prices.json may lack the model.
alter table taste.ai_reviews
  add column harness text,
  add column input_tokens bigint,
  add column cached_input_tokens bigint,
  add column output_tokens bigint,
  add column cost_usd numeric(10, 4);

-- A note's AI reviews as the cards carry them: a list, by model, empty when
-- there are none.
create or replace function taste.ai_review_card(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select coalesce(jsonb_agg(jsonb_build_object('explanation', a.explanation, 'recommendation', a.recommendation, 'reasoning', a.reasoning,
                                               'labels', to_jsonb(a.labels), 'model', a.model, 'createdAt', a.created_at)
                            order by a.model), '[]')
    from ai_reviews a
   where a.source = p_source and a.note_id = p_note_id
$$;

-- The AI recommendation filter: what the models recommend when they agree,
-- 'split' when they don't, and 'none' before any has reviewed the note.
create view taste.ai_recommendations as
select source, note_id,
       case when bool_and(recommendation = 'taste_failure') then 'taste_failure'
            when bool_and(recommendation = 'fine') then 'fine'
            else 'split' end as recommendation
  from taste.ai_reviews
 group by source, note_id;

-- The filter views as in 007, but joining the agreed recommendation, not the
-- one review a note had.
create or replace view taste.x_note_fields as
select n.note_id,
       n.written,
       n.status,
       n.author_id as notewriter,
       w.name as notewriter_name,
       n.helpful_ratings + n.somewhat_helpful_ratings + n.not_helpful_ratings as ratings,
       n.helpful_ratings,
       n.not_helpful_ratings,
       case when n.helpful_ratings + n.not_helpful_ratings > 0
            then n.helpful_ratings::float8 / (n.helpful_ratings + n.not_helpful_ratings) end as helpful_share,
       (extract(epoch from n.rated_at - n.written) / 3600)::float8 as hours_to_rated,
       n.rater_not_helpful_reasons,
       n.rater_helpful_reasons,
       n.classification,
       n.writer_reasons,
       n.media_note,
       n.collaborative_note,
       n.other_notes_state as other_notes,
       case when p.available then 'available' when p.available = false then 'unavailable' else 'not_fetched' end as post,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note_text, p.text, p.referenced ->> 'text', p.author_name, p.author_handle) as search_text,
       coalesce(a.recommendation, 'none') as ai_recommendation
  from taste.x_notes n
  join taste.x_notewriters w on w.author_id = n.author_id
  left join taste.x_posts p on p.tweet_id = n.tweet_id
  left join taste.verdicts v on v.source = 'x' and v.note_id = n.note_id
  left join taste.note_label_names l on l.source = 'x' and l.note_id = n.note_id
  left join taste.ai_recommendations a on a.source = 'x' and a.note_id = n.note_id;

create or replace view taste.cn_note_fields as
select n.id::text as note_id,
       n.created_at as written,
       n.rating_status as status,
       n.helpful_count + n.somewhat_helpful_count + n.not_helpful_count as votes,
       n.helpful_count as helpful_votes,
       n.somewhat_helpful_count as somewhat_votes,
       n.not_helpful_count as not_helpful_votes,
       n.p_helpful,
       n.writer,
       i.source as platform,
       i.project_id::text as creator,
       pr.name as creator_name,
       i.views,
       coalesce(s.sources, 0) as sources,
       n.status as published,
       coalesce(v.verdict, 'unjudged') as verdict,
       coalesce(l.labels, '{}') as labels,
       n.shuffle,
       concat_ws(' ', n.note, c.claim, c.context_quote, i.title, pr.name) as search_text,
       coalesce(a.recommendation, 'none') as ai_recommendation
  from taste.cn_notes n
  join taste.cn_claims c on c.id = n.claim_id
  join taste.cn_items i on i.id = c.item_id
  left join taste.cn_projects pr on pr.id = i.project_id
  left join (select note_id, count(distinct url) as sources from taste.cn_note_sources group by note_id) s on s.note_id = n.id
  left join taste.verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
  left join taste.note_label_names l on l.source = 'commonnotes' and l.note_id = n.id::text
  left join taste.ai_recommendations a on a.source = 'commonnotes' and a.note_id = n.id::text;
