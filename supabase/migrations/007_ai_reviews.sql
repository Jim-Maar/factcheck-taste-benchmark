-- An AI reviewer's explanation of a note and its recommended verdict. A
-- Claude agent writes these with the service key, through scripts/ai. The
-- site shows them on the cards, and a card updates as soon as its review is
-- written, because the table is in Supabase's realtime publication.

create table taste.ai_reviews (
  source text not null check (source in ('x', 'commonnotes')),
  note_id text not null,
  explanation text not null,
  recommendation text not null check (recommendation in ('taste_failure', 'fine')),
  reasoning text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (source, note_id)
);

alter table taste.ai_reviews enable row level security;
grant select on taste.ai_reviews to authenticated;
create policy labellers_read on taste.ai_reviews for select to authenticated using ((select taste.is_labeller()));
grant all on taste.ai_reviews to service_role;

-- Realtime sends a labeller every insert and update, after checking the read
-- rule above for that labeller.
alter publication supabase_realtime add table taste.ai_reviews;

-- A note's AI review as the cards carry it, or null.
create function taste.ai_review_card(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select jsonb_build_object('explanation', a.explanation, 'recommendation', a.recommendation, 'reasoning', a.reasoning,
                            'model', a.model, 'createdAt', a.created_at)
    from ai_reviews a
   where a.source = p_source and a.note_id = p_note_id
$$;

create or replace function taste.x_cards(p_ids text[]) returns table (note_id text, card jsonb)
language sql stable set search_path = taste as $$
  select n.note_id, jsonb_build_object(
    'noteId', n.note_id,
    'noteText', n.note_text,
    'status', n.status,
    'written', n.written,
    'notewriter', jsonb_build_object('id', w.author_id, 'name', w.name, 'isOurs', w.is_ours),
    'ratings', jsonb_build_object(
      'helpful', n.helpful_ratings, 'somewhatHelpful', n.somewhat_helpful_ratings, 'notHelpful', n.not_helpful_ratings,
      'helpfulReasons', n.helpful_tags, 'notHelpfulReasons', n.not_helpful_tags),
    'writerAnswers', jsonb_build_object(
      'classification', n.classification, 'reasons', to_jsonb(n.writer_reasons), 'trustworthySources', n.trustworthy_sources,
      'mediaNote', n.media_note, 'collaborativeNote', n.collaborative_note),
    'post', jsonb_build_object(
      'id', n.tweet_id, 'available', p.available, 'text', p.text, 'handle', p.author_handle, 'name', p.author_name,
      'postedAt', p.posted_at, 'media', coalesce(p.media, '[]'),
      'referenced', case when p.referenced is null then null
                         else p.referenced || jsonb_build_object('kind', p.referenced_kind) end),
    'otherNotes', n.other_notes,
    'verdict', v.verdict,
    'labels', note_label_list('x', n.note_id),
    'ai', ai_review_card('x', n.note_id))
    from x_notes n
    join x_notewriters w on w.author_id = n.author_id
    left join x_posts p on p.tweet_id = n.tweet_id
    left join verdicts v on v.source = 'x' and v.note_id = n.note_id
   where n.note_id = any (p_ids)
$$;

create or replace function taste.cn_cards(p_ids text[]) returns table (note_id text, card jsonb)
language sql stable set search_path = taste as $$
  select n.id::text, jsonb_build_object(
    'note', jsonb_build_object(
      'id', n.id, 'claim_id', n.claim_id, 'note', n.note,
      'sources', coalesce((select jsonb_agg(jsonb_build_object('url', s.url, 'sort_order', s.sort_order) order by s.sort_order)
                             from cn_note_sources s where s.note_id = n.id), '[]'),
      'has_source_details', exists (select 1 from cn_note_sources s where s.note_id = n.id and s.quote is not null),
      'helpful_count', n.helpful_count, 'somewhat_helpful_count', n.somewhat_helpful_count, 'not_helpful_count', n.not_helpful_count,
      'author_id', n.author_id, 'author_name', n.author_name, 'improved_from_note_id', n.improved_from_note_id,
      'status', n.status, 'created_at', n.created_at,
      'claim', jsonb_build_object(
        'id', c.id, 'item_id', c.item_id, 'claim', c.claim, 'context_quote', c.context_quote,
        'context_paragraph', c.context_paragraph, 'image_urls', c.image_urls, 'updated_quote', c.updated_quote,
        'context_url', c.context_url, 'start_seconds', c.start_seconds, 'end_seconds', c.end_seconds)),
    'ratingStatus', n.rating_status,
    'pHelpful', n.p_helpful,
    'writer', n.writer,
    'post', jsonb_build_object('id', i.id, 'project_id', i.project_id, 'url', i.url, 'title', i.title,
                               'published_at', i.published_at, 'created_at', i.created_at),
    'platform', i.source,
    'views', i.views,
    'project', case when pr.id is null then null
                    else jsonb_build_object('id', pr.id, 'slug', pr.slug, 'name', pr.name, 'feed_url', pr.feed_url, 'avatar_url', pr.avatar_url) end,
    'verdict', v.verdict,
    'labels', note_label_list('commonnotes', n.id::text),
    'ai', ai_review_card('commonnotes', n.id::text))
    from cn_notes n
    join cn_claims c on c.id = n.claim_id
    join cn_items i on i.id = c.item_id
    left join cn_projects pr on pr.id = i.project_id
    left join verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
   where n.id::text = any (p_ids)
$$;

-- Both views gain the AI recommendation as a filter field.
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
  left join taste.ai_reviews a on a.source = 'x' and a.note_id = n.note_id;

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
  left join taste.ai_reviews a on a.source = 'commonnotes' and a.note_id = n.id::text;
