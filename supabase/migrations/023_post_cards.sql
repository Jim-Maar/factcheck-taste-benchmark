-- The notewriter eval tab shows posts by their id, with no note of the
-- database attached. So the post part of a Community Notes card becomes a
-- function of its own, which the cards and the eval tab share.

create function taste.x_post_card(p_tweet_id text) returns jsonb
language sql stable set search_path = taste as $$
  select jsonb_build_object(
      'id', wanted.tweet_id, 'available', p.available, 'text', p.text, 'handle', p.author_handle, 'name', p.author_name,
      'postedAt', p.posted_at, 'media', coalesce(p.media, '[]'),
      'referenced', case when p.referenced is null then null
                         else p.referenced || jsonb_build_object('kind', p.referenced_kind) end,
      'thread', p.thread,
      'transcripts', post_transcripts(jsonb_build_array(p.media, p.referenced, p.thread)))
    from (values (p_tweet_id)) wanted (tweet_id)
    left join x_posts p on p.tweet_id = wanted.tweet_id
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
    'post', x_post_card(n.tweet_id),
    'otherNotes', n.other_notes,
    'verdict', v.verdict,
    'labels', note_label_list('x', n.note_id),
    'ai', ai_review_card('x', n.note_id),
    'comment', note_comment_card('x', n.note_id),
    'accuracy', (select a.accuracy from accuracy a where a.source = 'x' and a.note_id = n.note_id),
    'needsNote', (select q.answer from needs_note q where q.source = 'x' and q.note_id = n.note_id))
    from x_notes n
    join x_notewriters w on w.author_id = n.author_id
    left join verdicts v on v.source = 'x' and v.note_id = n.note_id
   where n.note_id = any (p_ids)
$$;

-- The posts of these ids, as the cards show them, for signed-in labellers.
create function taste.x_post_cards(p_tweet_ids text[]) returns table (tweet_id text, post jsonb)
language plpgsql stable security definer set search_path = taste as $$
begin
  perform require_labeller();
  return query select wanted.id, x_post_card(wanted.id) from unnest(p_tweet_ids) wanted (id);
end;
$$;

revoke execute on function taste.x_post_cards(text[]) from public, anon;
grant execute on function taste.x_post_cards(text[]) to authenticated;
