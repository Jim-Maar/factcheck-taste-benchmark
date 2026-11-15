-- What is said in the videos of X posts, so a labeller and the AI reviewer
-- can follow a post whose point is in its video. One row per video, keyed by
-- the id X gives the video (src/core/xVideo.ts), so the same video quoted in
-- another post shares the transcript. scripts/import/transcripts.ts fills it.
-- An empty transcript means the video has no speech.

create table taste.x_video_transcripts (
  video_id text primary key,
  transcript text not null,
  language text,
  duration_seconds numeric,
  model text not null,
  created_at timestamptz not null default now()
);

alter table taste.x_video_transcripts enable row level security;
grant select on taste.x_video_transcripts to authenticated;
create policy labellers_read on taste.x_video_transcripts for select to authenticated using ((select taste.is_labeller()));
grant all on taste.x_video_transcripts to service_role;

-- The transcripts of every video a post shows: in the post, in the post it
-- quotes and in its thread. Keyed by video id, empty when there are none.
create function taste.post_transcripts(p_post_parts jsonb) returns jsonb
language sql stable set search_path = taste as $$
  select coalesce(jsonb_object_agg(t.video_id, jsonb_build_object('text', t.transcript, 'language', t.language)), '{}')
    from x_video_transcripts t
   where t.video_id in (select (regexp_matches(p_post_parts::text, 'video\.twimg\.com/(?:amplify_video|ext_tw_video)/(\d+)/', 'g'))[1])
$$;

-- The cards carry the transcripts with the post.
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
                         else p.referenced || jsonb_build_object('kind', p.referenced_kind) end,
      'thread', p.thread,
      'transcripts', post_transcripts(jsonb_build_array(p.media, p.referenced, p.thread))),
    'otherNotes', n.other_notes,
    'verdict', v.verdict,
    'labels', note_label_list('x', n.note_id),
    'ai', ai_review_card('x', n.note_id),
    'comment', note_comment_card('x', n.note_id),
    'accuracy', (select a.accuracy from accuracy a where a.source = 'x' and a.note_id = n.note_id))
    from x_notes n
    join x_notewriters w on w.author_id = n.author_id
    left join x_posts p on p.tweet_id = n.tweet_id
    left join verdicts v on v.source = 'x' and v.note_id = n.note_id
   where n.note_id = any (p_ids)
$$;
