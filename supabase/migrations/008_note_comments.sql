-- One shared comment per note, which every labeller can write, change or
-- clear. label_history keeps every change, like it does for verdicts.

create table taste.note_comments (
  source text not null check (source in ('x', 'commonnotes')),
  note_id text not null,
  comment text not null check (length(trim(comment)) > 0),
  updated_at timestamptz not null default now(),
  primary key (source, note_id)
);

alter table taste.note_comments enable row level security;
grant select, insert, update, delete on taste.note_comments to authenticated;
grant all on taste.note_comments to service_role;
create policy labellers_read on taste.note_comments for select to authenticated using ((select taste.is_labeller()));
create policy labellers_insert on taste.note_comments for insert to authenticated with check ((select taste.is_labeller()));
create policy labellers_update on taste.note_comments for update to authenticated using ((select taste.is_labeller())) with check ((select taste.is_labeller()));
create policy labellers_delete on taste.note_comments for delete to authenticated using ((select taste.is_labeller()));

alter table taste.label_history drop constraint label_history_kind_check;
alter table taste.label_history add constraint label_history_kind_check check (kind in ('verdict', 'label', 'comment'));

create function taste.log_note_comment() returns trigger
language plpgsql security definer set search_path = taste as $$
begin
  if tg_op = 'DELETE' then
    insert into label_history (source, note_id, kind, old_value) values (old.source, old.note_id, 'comment', old.comment);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.comment = new.comment then return new; end if;
  insert into label_history (source, note_id, kind, old_value, new_value)
  values (new.source, new.note_id, 'comment', case when tg_op = 'UPDATE' then old.comment end, new.comment);
  return new;
end;
$$;
create trigger log_note_comment after insert or update or delete on taste.note_comments for each row execute function taste.log_note_comment();

-- A note's comment as the cards carry it, or null.
create function taste.note_comment_card(p_source text, p_note_id text) returns jsonb
language sql stable set search_path = taste as $$
  select jsonb_build_object('text', c.comment, 'updatedAt', c.updated_at)
    from note_comments c
   where c.source = p_source and c.note_id = p_note_id
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
    'ai', ai_review_card('x', n.note_id),
    'comment', note_comment_card('x', n.note_id))
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
    'ai', ai_review_card('commonnotes', n.id::text),
    'comment', note_comment_card('commonnotes', n.id::text))
    from cn_notes n
    join cn_claims c on c.id = n.claim_id
    join cn_items i on i.id = c.item_id
    left join cn_projects pr on pr.id = i.project_id
    left join verdicts v on v.source = 'commonnotes' and v.note_id = n.id::text
   where n.id::text = any (p_ids)
$$;
